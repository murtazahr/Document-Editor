export const SAMPLE_MAIN = String.raw`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath}
\usepackage{hyperref}
\usepackage{graphicx}

\title{Rewriting Machine-Generated Drafts: A Worked Example}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Large language models are increasingly utilized to generate initial drafts of academic manuscripts. However, text produced in this manner frequently exhibits characteristic stylistic patterns that are readily identifiable by automated detection systems. In this paper, we present a comprehensive framework for systematically rewriting machine-generated drafts in order to restore an authentic authorial voice while preserving technical accuracy.
\end{abstract}

\section{Introduction}
The proliferation of large language models (LLMs) has fundamentally transformed the landscape of scientific writing~\cite{brown2020}. Researchers now routinely leverage these powerful tools to accelerate the drafting process, thereby significantly reducing the time required to produce publication-ready manuscripts. Nevertheless, it is crucial to acknowledge that the resulting text often lacks the nuanced perspective and individual voice that characterize expert human writing.

In this work, we make the following contributions. First, we introduce a paragraph-aligned diff representation that highlights which spans of a draft remain verbatim. Second, we integrate an AI-detection signal directly into the editing loop so that authors receive feedback as they revise. Third, we demonstrate the approach on a small corpus of drafts.

\section{Method}
Our approach consists of three stages. In the first stage, the original draft $D_0$ is stored as an immutable baseline. In the second stage, the author iteratively produces revisions $D_1, D_2, \dots, D_n$, each of which is compared against $D_0$ at the granularity of paragraphs and words. In the third stage, the prose of the current revision is submitted to a detector, which returns a per-window likelihood
\begin{equation}
  p_w = f_\theta(x_w), \qquad w = 1, \dots, W,
\end{equation}
where $x_w$ denotes the $w$-th window of text.

\subsection{Diff representation}
It is important to note that a naive character-level diff is difficult to read when sentences have been substantially restructured. Consequently, we first align paragraphs using a similarity threshold and only then compute a word-level diff within each aligned pair. Small unchanged islands between two edits are merged into a single replacement, which considerably improves readability.

\section{Results}
Table~\ref{tab:results} summarises detection scores before and after rewriting.
\begin{table}[h]
  \centering
  \begin{tabular}{lcc}
    \hline
    Draft & Before & After \\
    \hline
    A & 0.97 & 0.12 \\
    B & 0.91 & 0.08 \\
    \hline
  \end{tabular}
  \caption{Detector scores (fraction AI).}
  \label{tab:results}
\end{table}

\section{Conclusion}
In conclusion, we have presented a practical workflow for transforming machine-generated drafts into authentic scholarly prose. Future work will explore extending the framework to multilingual settings and to collaborative editing scenarios.

\bibliographystyle{plain}
\begin{thebibliography}{9}
\bibitem{brown2020} T. Brown et al. Language models are few-shot learners. \emph{NeurIPS}, 2020.
\end{thebibliography}

\end{document}
`;

export const SAMPLE_FILES: Record<string, string> = { "main.tex": SAMPLE_MAIN };

export const BLANK_MAIN = String.raw`\documentclass{article}
\title{Untitled}
\author{}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}
Start writing here.

\end{document}
`;
