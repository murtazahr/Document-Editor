import { describe, it, expect } from "vitest";
import { latexToProse, proseRangeToSource, findLoose, countWords } from "@/lib/latex-prose";

import { readFileSync } from "node:fs";
import path from "node:path";
const DOC = readFileSync(path.join(__dirname, "fixtures/sample.tex"), "utf8");

describe("latexToProse", () => {
  const { text, map } = latexToProse(DOC);

  it("drops preamble, comments, floats, citations, footnotes and math environments", () => {
    expect(text).not.toContain("documentclass");
    expect(text).not.toContain("a comment");
    expect(text).not.toContain("Dropped");
    expect(text).not.toContain("brown2020");
    expect(text).not.toContain("Not this");
    expect(text).not.toContain("mc^2");
    expect(text).not.toContain("Trailing garbage");
  });

  it("keeps prose, section titles, and formatted text", () => {
    expect(text).toContain("Introduction");
    expect(text).toContain("Large language models have changed how we write.");
    expect(text).toContain("We show that xi matters, see Figure.");
    expect(text).toContain("Second paragraph — with “quotes” and emphasis.");
    expect(text).toContain("Final sentence ... done.");
  });

  it("separates paragraphs with blank lines", () => {
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(4);
  });

  it("maps prose offsets back to source offsets", () => {
    const i = text.indexOf("changed");
    const r = proseRangeToSource(map, i, i + "changed".length)!;
    expect(DOC.slice(r.from, r.to)).toBe("changed");
    const j = text.indexOf("emphasis");
    const r2 = proseRangeToSource(map, j, j + 8)!;
    expect(DOC.slice(r2.from, r2.to)).toBe("emphasis");
  });

  it("handles documents without \\begin{document}", () => {
    expect(latexToProse("Hello \\textit{world}.").text).toBe("Hello world.");
  });

  it("handles accents, escapes and href", () => {
    const t = latexToProse(String.raw`Caf\'e costs 5\% \& more, see \href{http://x}{this link}.`).text;
    expect(t).toBe("Café costs 5% & more, see this link.");
  });

  it("drops nested figures and keeps itemize text", () => {
    const t = latexToProse(String.raw`\begin{itemize}\item First point\item Second \textbf{point}\end{itemize}After`).text;
    expect(t).toBe("First point\n\nSecond point\n\nAfter");
  });
});

describe("findLoose", () => {
  it("finds text ignoring whitespace differences", () => {
    const hay = "alpha beta\n\ngamma   delta";
    const r = findLoose(hay, "beta gamma delta")!;
    expect(hay.slice(r.start, r.end)).toBe("beta\n\ngamma   delta");
  });
});

describe("countWords", () => {
  it("counts words", () => {
    expect(countWords("It's a well-known fact: 3 words? no.")).toBe(7);
  });
});
