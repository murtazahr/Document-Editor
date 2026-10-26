# Rewrite Studio

A web-based LaTeX editor for turning AI-generated drafts into your own writing.
It is built around three things:

1. **Edit and compile LaTeX** in the browser (CodeMirror editor, PDF preview, error list).
2. **A readable diff against a baseline.** You snapshot the original (AI-generated) text as a
   baseline, rewrite, and see paragraph-aligned, word-level changes — inline or side by side,
   on the raw source or on the extracted prose — with unchanged "verbatim runs" flagged so you
   can see what you have not rewritten yet.
3. **Pangram AI detection inside the editor.** The prose of the current file (LaTeX markup,
   math, floats and references stripped) is sent to Pangram's text API; the per-window labels
   are shown in a panel and tinted directly in the editor.

Everything is stored on the local filesystem (no database). Single user, self-hosted.

## Quick start

Requirements: Node 22+, pnpm (`corepack enable`), and a LaTeX engine on your PATH
(`latexmk` from TeX Live / MacTeX, or [Tectonic](https://tectonic-typesetting.github.io)).
Without an engine everything except "Compile" still works.

```bash
pnpm install
cp .env.example .env.local      # optional: PANGRAM_API_KEY, DATA_DIR, LATEX_ENGINE
pnpm dev                        # http://localhost:3000
```

Click **Sample paper** on the home page to get a short AI-style paper with its baseline already
set, then rewrite a paragraph and watch the **Diff** tab.

### Docker (bundles TeX Live)

```bash
docker compose up --build       # or: docker build -t rewrite-studio . && docker run -p 3000:3000 -v $PWD/data:/data rewrite-studio
```

The image installs `latexmk` plus the common TeX Live collections. Add packages to the
`apt-get install` line in the `Dockerfile` if your documents need more.

## Configuration

| Variable | Meaning |
| --- | --- |
| `PANGRAM_API_KEY` | Pangram API key. Overrides a key saved in the Settings dialog. |
| `PANGRAM_MOCK=1` | Return locally generated fake detection results (no credits). Results are labelled **mock** everywhere. |
| `DATA_DIR` | Storage directory (default `./data`). Holds projects, baselines, build output and `settings.json`. |
| `LATEX_ENGINE` | `auto` (default), `latexmk`, `tectonic` or `pdflatex`. `auto` picks the first one found on PATH in that order. |
| `LATEX_TIMEOUT_MS` | Compile timeout, default 180000. |

A key entered in **Settings** is written in plain text to `DATA_DIR/settings.json`. Prefer the
environment variable on shared machines.

## How the pieces work

### Storage layout

```
data/
  settings.json
  projects/<id>/
    project.json            name, main file
    main.tex, refs.bib, …   your files (sub-folders allowed; images are uploaded as binaries)
    .editor/baselines/<file>   the baseline text per file
    .editor/pangram/<file>.json  last detection result per file
    .build/                 compiler output (output.pdf, last.log)
```

### Compilation

`POST /api/projects/:id/compile` runs, inside the project folder:

- `latexmk -pdf -interaction=nonstopmode -halt-on-error -file-line-error -outdir=.build main.tex`, or
- `tectonic -X compile --outdir .build --keep-logs main.tex`, or
- `pdflatex` twice.

The log is parsed for `file:line: message` errors, `! …` errors with `l.N` lines, LaTeX/package
warnings and over/underfull boxes; clicking a diagnostic jumps the editor to the line.
The PDF is served from `/api/projects/:id/pdf` and shown in an `<iframe>` using the browser's PDF
viewer. `⌘S` / `Ctrl+S` saves and compiles.

### Diff

`src/lib/diff/engine.ts`:

1. Split both texts into paragraphs on blank lines.
2. Align paragraphs with an LCS diff; inside each run of removed/added paragraphs, pair the
   ones whose word-overlap (Dice coefficient) is ≥ 0.3 as *modified*, the rest as pure
   added/removed.
3. Diff modified pairs at token level (words, whitespace, punctuation, and LaTeX commands as
   single tokens), then absorb tiny unchanged islands between two edits into one replacement so
   the result reads as "this phrase became that phrase" rather than confetti.
4. Flag unchanged runs of ≥ N words (default 8, adjustable) as *verbatim*.

The header shows the share of the current text that is unchanged / inside verbatim runs, word
counts added and removed, and paragraph counts. `j`/`k` (or the arrows) step through changes,
`Enter` or a click jumps the editor to that paragraph. "Prose" mode runs both texts through the
LaTeX stripper first so markup-only edits do not show up; "Source" mode diffs the raw `.tex`.

### Prose extraction

`src/lib/latex-prose.ts` converts LaTeX to plain text while recording, for every output
character, the source offset it came from. It drops the preamble, comments, `figure`/`table`/
`equation`/`algorithm`/`lstlisting`/`tikzpicture`/bibliography environments, citations, refs,
labels, footnotes and `\includegraphics`; keeps the text of sectioning and formatting commands;
turns short inline math into its bare symbols (`$x_i$` → `xi`) and drops longer math; converts
quotes, dashes, accents and escaped characters. The offset map is what lets detector windows be
highlighted in the editor.

It is a heuristic, not a TeX parser: custom macros that hide prose in unusual argument positions
will be handled as "drop the command name, keep the braced text".

### Pangram integration

Implemented against the documented async task API
(https://docs.pangram.com/api-reference/ai-detection):

- `GET  https://text.external-api.pangram.com/models` — model selectors available to the key
  (shown in Settings and in the detection panel; the list is not hard-coded).
- `POST https://text.external-api.pangram.com/task` with `{ text, model, public_dashboard_link }`,
  header `x-api-key`, returns `task_id`.
- `GET  …/task/{task_id}` polled server-side every second until `stage` is `STAGE_SUCCESS` or
  `STAGE_FAILED`.

The result (`headline`, `prediction_short`, `fraction_ai` / `fraction_ai_assisted` /
`fraction_human`, and `windows[]` with `label`, `ai_assistance_score`, `confidence`,
`is_humanized`, `humanizer_score`, `start_index`, `end_index`) is cached per file. Each window is
located in the current prose (by offsets when the text is unchanged, otherwise by a
whitespace-tolerant search) and mapped back to source ranges, which the editor tints:
red = AI-Generated, amber = AI-Assisted, green = Human Written, wavy underline = humanized.
The panel marks a result **stale** once the text differs from what was analysed. Each run is a
billable Pangram request; nothing is sent automatically.

The API key never reaches the browser; all Pangram calls go through `/api/projects/:id/detect`
and `/api/pangram/models` on the server.

## Scripts

```bash
pnpm dev        # dev server
pnpm build      # production build (standalone output)
pnpm start      # run the production build
pnpm test       # unit tests for the diff engine and LaTeX stripper (vitest)
pnpm lint
pnpm typecheck
```

## Known limitations

- No authentication and no multi-user collaboration; run it for yourself.
- The PDF preview uses the browser's built-in viewer, so there is no click-to-source (SyncTeX).
- Compilation was not exercised in the environment this was developed in (no TeX engine was
  available there); the latexmk/tectonic/pdflatex invocations follow their documented CLIs,
  but if your setup produces an unexpected log format, the "Full log" toggle shows the raw output.
- The Pangram integration was built from Pangram's published API reference and tested against the
  built-in mock; it has not been run against a live key here.
