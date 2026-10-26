/**
 * Convert LaTeX source into readable prose while keeping a map from every
 * output character back to its source offset. The prose is what gets sent to
 * AI detection and what the "prose" diff mode shows; the map lets us project
 * detector windows back onto the editor.
 */

export type ProseResult = {
  text: string;
  /** map[i] = index in the source of the character that produced text[i] */
  map: Int32Array;
};

const DROP_ENVS = new Set([
  "figure", "figure*", "table", "table*", "tabular", "tabular*", "tabularx", "longtable",
  "equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*",
  "multline", "multline*", "eqnarray", "eqnarray*", "displaymath", "math",
  "algorithm", "algorithm*", "algorithmic", "algorithm2e", "lstlisting", "verbatim", "verbatim*",
  "minted", "tikzpicture", "thebibliography", "comment", "filecontents", "filecontents*",
  "subfigure", "wrapfigure", "sidewaystable", "sidewaysfigure", "listing", "lstlisting*",
]);

/** Commands whose arguments (optional and braced) are removed entirely. */
const DROP_CMDS = new Set([
  "cite", "citep", "citet", "citeauthor", "citeyear", "citealp", "citealt", "parencite", "textcite", "autocite", "footcite", "nocite",
  "ref", "eqref", "autoref", "cref", "Cref", "pageref", "nameref", "vref", "label",
  "includegraphics", "url", "input", "include", "bibliography", "bibliographystyle", "addbibresource",
  "usepackage", "documentclass", "newcommand", "renewcommand", "providecommand", "newenvironment", "DeclareMathOperator",
  "setlength", "addtolength", "pagestyle", "thispagestyle", "footnote", "footnotemark", "footnotetext",
  "index", "glossary", "todo", "marginpar", "vspace", "hspace", "vspace*", "hspace*", "rule", "hyphenation",
  "definecolor", "graphicspath", "setcounter", "addtocounter", "newtheorem", "theoremstyle", "acmConference", "acmYear",
  "affiliation", "email", "orcid", "keywords", "ccsdesc", "institution", "city", "country", "state", "postcode",
  "IEEEauthorblockA", "IEEEoverridecommandlockouts", "author", "date", "thanks", "and", "maketitle", "tableofcontents",
  "bibitem", "newblock", "lstset", "lstinputlisting", "verb",
]);

/** Commands whose FIRST braced argument is dropped, the rest kept. */
const SKIP_FIRST_ARG = new Set(["href", "textcolor", "colorbox", "hyperref", "hypertarget", "hyperlink"]);

/** Sectioning commands: argument kept and set on its own paragraph. */
const SECTION_CMDS = new Set(["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph", "title", "caption"]);

const WORD_CMDS: Record<string, string> = {
  ldots: "...", dots: "...", cdots: "...", textellipsis: "...",
  LaTeX: "LaTeX", TeX: "TeX", LaTeXe: "LaTeX2e", BibTeX: "BibTeX",
  textendash: "–", textemdash: "—", textquoteleft: "‘", textquoteright: "’",
  textquotedblleft: "“", textquotedblright: "”", copyright: "©", textregistered: "®", texttrademark: "™",
  textbackslash: "\\", textasciitilde: "~", textasciicircum: "^", textbar: "|", textless: "<", textgreater: ">",
  slash: "/", S: "§", P: "¶", dag: "†", ddag: "‡", pounds: "£", euro: "€",
  ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", o: "ø", O: "Ø", aa: "å", AA: "Å", l: "ł", L: "Ł", i: "ı", j: "ȷ",
};

const SPACE_CMDS = new Set(["quad", "qquad", "enspace", "thinspace", "negthinspace", "linebreak", "newline", "par", "newpage", "clearpage", "cleardoublepage", "pagebreak", "noindent", "indent", "centering", "raggedright", "raggedleft", "hfill", "vfill", "smallskip", "medskip", "bigskip", "hline", "toprule", "midrule", "bottomrule", "relax", "frontmatter", "mainmatter", "backmatter", "appendix", "newline", "break", "allowbreak", "sloppy", "fussy", "onecolumn", "twocolumn", "selectfont", "normalfont", "normalsize", "tiny", "scriptsize", "footnotesize", "small", "large", "Large", "LARGE", "huge", "Huge", "bfseries", "itshape", "ttfamily", "rmfamily", "sffamily", "scshape", "upshape", "mdseries", "em", "bf", "it", "tt", "rm", "sf", "sc", "sl", "boldmath", "unboldmath", "displaystyle", "textstyle", "protect", "ignorespaces", "unskip", "nobreak", "nolinebreak", "nopagebreak"]);

const ACCENTS: Record<string, string> = {
  "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇",
  u: "̆", v: "̌", H: "̋", c: "̧", k: "̨", d: "̣", b: "̱", r: "̊", t: "͡",
};

class Builder {
  chars: string[] = [];
  map: number[] = [];
  private pendingSpace = false;
  private pendingPara = false;
  private pendingSrc = 0;

  space(src: number) {
    if (!this.pendingSpace && !this.pendingPara) this.pendingSrc = src;
    this.pendingSpace = true;
  }
  para(src: number) {
    if (!this.pendingPara) this.pendingSrc = src;
    this.pendingPara = true;
  }
  private flush() {
    if (this.chars.length === 0) {
      this.pendingSpace = this.pendingPara = false;
      return;
    }
    if (this.pendingPara) {
      this.chars.push("\n", "\n");
      this.map.push(this.pendingSrc, this.pendingSrc);
    } else if (this.pendingSpace) {
      this.chars.push(" ");
      this.map.push(this.pendingSrc);
    }
    this.pendingSpace = this.pendingPara = false;
  }
  push(s: string, src: number) {
    if (!s) return;
    this.flush();
    for (const ch of s) {
      this.chars.push(ch);
      this.map.push(src);
    }
  }
  result(): ProseResult {
    return { text: this.chars.join(""), map: Int32Array.from(this.map) };
  }
}

function matchBrace(src: string, open: number, openCh = "{", closeCh = "}"): number {
  // src[open] === openCh; returns index of matching close, or -1
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }
    if (c === "%") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function skipGroups(src: string, i: number, opts: { optional?: boolean; braced?: number } = {}): number {
  // skip whitespace-separated [..] and {..} groups directly following a command
  const optional = opts.optional ?? true;
  let braced = opts.braced ?? Infinity;
  for (;;) {
    let j = i;
    while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
    if (optional && src[j] === "[") {
      const e = matchBrace(src, j, "[", "]");
      if (e < 0) return src.length;
      i = e + 1;
      continue;
    }
    if (braced > 0 && src[j] === "{") {
      const e = matchBrace(src, j);
      if (e < 0) return src.length;
      i = e + 1;
      braced--;
      continue;
    }
    return i;
  }
}

function mathToText(inner: string): string | null {
  const t = inner.trim();
  if (t.length > 40 || /\\(frac|sum|prod|int|begin|left|right|mathbb|mathcal|hat|bar|tilde|vec|sqrt|cdot|times|leq|geq|neq|approx|forall|exists|partial|nabla|infty|to|rightarrow|Rightarrow|mapsto|in|subset|cup|cap|prime|alpha|beta|gamma|delta|epsilon|lambda|mu|sigma|theta|phi|pi|omega|Delta|Sigma|Theta|Omega|Lambda|Gamma|Phi)\b/.test(t)) {
    return null;
  }
  const s = t.replace(/\\[a-zA-Z]+/g, "").replace(/[{}^_$\\]/g, "");
  return s.trim() ? s : null;
}

export function latexToProse(src: string): ProseResult {
  const b = new Builder();
  let start = 0;
  let end = src.length;
  const bd = src.indexOf("\\begin{document}");
  if (bd >= 0) start = bd + "\\begin{document}".length;
  const ed = src.indexOf("\\end{document}", start);
  if (ed >= 0) end = ed;

  const parse = (i: number, stopAtClose: boolean): number => {
    while (i < end) {
      const c = src[i];
      if (c === "}") {
        if (stopAtClose) return i + 1;
        i++;
        continue;
      }
      if (c === "{") {
        i = parse(i + 1, true);
        continue;
      }
      if (c === "%") {
        while (i < end && src[i] !== "\n") i++;
        i++; // the comment eats the newline too
        continue;
      }
      if (c === "\n") {
        let j = i;
        let nl = 0;
        while (j < end && /[ \t\r\n]/.test(src[j])) { if (src[j] === "\n") nl++; j++; }
        if (nl >= 2) b.para(i); else b.space(i);
        i = j;
        continue;
      }
      if (c === " " || c === "\t" || c === "\r" || c === "~") { b.space(i); i++; continue; }
      if (c === "$") {
        if (src[i + 1] === "$") {
          const close = src.indexOf("$$", i + 2);
          i = close < 0 ? end : close + 2;
          b.space(i);
          continue;
        }
        let j = i + 1;
        while (j < end && !(src[j] === "$" && src[j - 1] !== "\\")) j++;
        const txt = mathToText(src.slice(i + 1, j));
        if (txt) b.push(txt, i); else b.space(i);
        i = j + 1;
        continue;
      }
      if (c === "`") {
        if (src[i + 1] === "`") { b.push("“", i); i += 2; } else { b.push("‘", i); i++; }
        continue;
      }
      if (c === "'" && src[i + 1] === "'") { b.push("”", i); i += 2; continue; }
      if (c === "-" && src[i + 1] === "-") {
        if (src[i + 2] === "-") { b.push("—", i); i += 3; } else { b.push("–", i); i += 2; }
        continue;
      }
      if (c === "\\") {
        const n = src[i + 1];
        if (n === undefined) { i++; continue; }
        if (n === "\\") { b.space(i); i = skipGroups(src, i + 2, { braced: 0 }); continue; }
        if (n === "(") {
          const close = src.indexOf("\\)", i + 2);
          const txt = mathToText(src.slice(i + 2, close < 0 ? end : close));
          if (txt) b.push(txt, i); else b.space(i);
          i = close < 0 ? end : close + 2;
          continue;
        }
        if (n === "[") {
          const close = src.indexOf("\\]", i + 2);
          i = close < 0 ? end : close + 2;
          b.space(i);
          continue;
        }
        if ("%&$_#{}".includes(n)) { b.push(n, i); i += 2; continue; }
        if (n === " " || n === "," || n === ";" || n === ":" || n === "!" || n === "/" || n === "@") { if (n !== "!" && n !== "/" && n !== "@") b.space(i); i += 2; continue; }
        if (n === "-") { i += 2; continue; } // discretionary hyphen
        if (ACCENTS[n] && !/[a-zA-Z]/.test(n)) {
          // \'e or \'{e}
          const j = i + 2;
          if (src[j] === "{") { const e = matchBrace(src, j); const inner = src.slice(j + 1, e); b.push(inner + ACCENTS[n], i); i = e + 1; }
          else { b.push(src[j] + ACCENTS[n], i); i = j + 1; }
          continue;
        }
        if (!/[a-zA-Z@]/.test(n)) { b.push(n, i); i += 2; continue; }
        // control word
        let j = i + 1;
        while (j < end && /[a-zA-Z@]/.test(src[j])) j++;
        let name = src.slice(i + 1, j);
        if (src[j] === "*") { name += "*"; j++; }
        const bare = name.replace(/\*$/, "");

        if (bare === "begin") {
          const e = src[j] === "{" ? matchBrace(src, j) : -1;
          const env = e > 0 ? src.slice(j + 1, e) : "";
          j = e > 0 ? e + 1 : j;
          if (DROP_ENVS.has(env)) {
            // skip to matching \end{env}, honoring nesting of the same env
            let depth = 1;
            let k = j;
            const beginTok = `\\begin{${env}}`;
            const endTok = `\\end{${env}}`;
            while (k < end && depth > 0) {
              const nb = src.indexOf(beginTok, k);
              const ne = src.indexOf(endTok, k);
              if (ne < 0) { k = end; break; }
              if (nb >= 0 && nb < ne) { depth++; k = nb + beginTok.length; } else { depth--; k = ne + endTok.length; }
            }
            b.para(i);
            i = k;
            continue;
          }
          j = skipGroups(src, j, { braced: env === "tabular" || env === "minipage" ? 1 : 0 });
          b.para(i);
          i = j;
          continue;
        }
        if (bare === "end") {
          const e = src[j] === "{" ? matchBrace(src, j) : -1;
          j = e > 0 ? e + 1 : j;
          b.para(i);
          i = j;
          continue;
        }
        if (bare === "item") {
          j = skipGroups(src, j, { braced: 0 });
          b.para(i);
          i = j;
          continue;
        }
        if (bare === "verb") {
          const delim = src[j];
          const close = src.indexOf(delim, j + 1);
          if (close > 0) { b.push(src.slice(j + 1, close), i); i = close + 1; } else i = j + 1;
          continue;
        }
        if (SECTION_CMDS.has(bare)) {
          j = skipGroups(src, j, { braced: 0 });
          b.para(i);
          if (src[j] === "{") { i = parse(j + 1, true); } else i = j;
          b.para(i);
          continue;
        }
        if (DROP_CMDS.has(name) || DROP_CMDS.has(bare)) {
          const after = skipGroups(src, j);
          if (after === j && /[ \t]/.test(src[j] ?? "")) b.space(i);
          i = after;
          continue;
        }
        if (SKIP_FIRST_ARG.has(bare)) {
          j = skipGroups(src, j, { braced: 1 });
          i = j; // remaining braces parsed as normal groups
          continue;
        }
        if (WORD_CMDS[bare] !== undefined) {
          b.push(WORD_CMDS[bare], i);
          if (src[j] === "{" && src[j + 1] === "}") j += 2;
          i = j;
          continue;
        }
        if (SPACE_CMDS.has(bare)) {
          b.space(i);
          i = skipGroups(src, j, { braced: 0 });
          continue;
        }
        // Unknown command: drop optional args, keep braced argument text.
        j = skipGroups(src, j, { braced: 0 });
        if (src[j] !== "{" && /[ \t]/.test(src[j] ?? "")) b.space(i);
        i = j;
        continue;
      }
      b.push(c, i);
      i++;
    }
    return i;
  };

  parse(start, false);
  const r = b.result();
  // drop spaces left behind before punctuation (e.g. "writing~\\cite{x}." -> "writing.")
  const chars: string[] = [];
  const map: number[] = [];
  for (let k = 0; k < r.text.length; k++) {
    const ch = r.text[k];
    if (ch === " " && k + 1 < r.text.length && ".,;:!?)".includes(r.text[k + 1]) && r.text[k + 2] !== "." && chars.length && chars[chars.length - 1] !== " ") continue;
    chars.push(ch);
    map.push(r.map[k]);
  }
  // trim trailing whitespace (leading is already suppressed)
  let t = chars.length;
  while (t > 0 && /\s/.test(chars[t - 1])) t--;
  return { text: chars.slice(0, t).join(""), map: Int32Array.from(map.slice(0, t)) };
}

/** Map a [start, end) range in prose back to a source range. */
export function proseRangeToSource(map: Int32Array, start: number, endExclusive: number): { from: number; to: number } | null {
  if (map.length === 0) return null;
  const s = Math.max(0, Math.min(start, map.length - 1));
  const e = Math.max(s, Math.min(endExclusive - 1, map.length - 1));
  return { from: map[s], to: map[e] + 1 };
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

/**
 * Find `needle` inside `hay` tolerating whitespace differences. Returns the
 * [start, end) range in `hay`, searching forward from `from`.
 */
export function findLoose(hay: string, needle: string, from = 0): { start: number; end: number } | null {
  const n = needle.trim();
  if (!n) return null;
  const direct = hay.indexOf(n, from);
  if (direct >= 0) return { start: direct, end: direct + n.length };
  // whitespace-insensitive search
  const normHay: string[] = [];
  const idx: number[] = [];
  let lastSpace = true;
  for (let i = from; i < hay.length; i++) {
    const ch = hay[i];
    if (/\s/.test(ch)) { if (!lastSpace) { normHay.push(" "); idx.push(i); lastSpace = true; } }
    else { normHay.push(ch); idx.push(i); lastSpace = false; }
  }
  const normNeedle = n.replace(/\s+/g, " ");
  const hs = normHay.join("");
  let p = hs.indexOf(normNeedle);
  if (p < 0) {
    // fall back to the first 60 chars (window text may have been normalized by the detector)
    const head = normNeedle.slice(0, 60);
    if (head.length < 20) return null;
    p = hs.indexOf(head);
    if (p < 0) return null;
    const start = idx[p];
    const endApprox = idx[Math.min(p + normNeedle.length - 1, idx.length - 1)] + 1;
    return { start, end: endApprox };
  }
  return { start: idx[p], end: idx[p + normNeedle.length - 1] + 1 };
}
