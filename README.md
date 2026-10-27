# Rewrite Studio

A web-based LaTeX editor for turning AI-generated drafts into your own writing.
It is built around three things:

1. **Edit and compile LaTeX** in the browser (CodeMirror editor, PDF preview, error list).
2. **A readable diff against a baseline.** You snapshot the original (AI-generated) text as a
   baseline, rewrite, and see paragraph-aligned, word-level changes — inline or side by side,
   on the raw source or on the extracted prose — with unchanged "verbatim runs" flagged so you
   can see what you have not rewritten yet.
3. **A grammar checker backed by Claude.** Select a passage (or the whole file) and get minimal
   edits back as a reviewable list, each shown as a word-level redline; accept them one by one or
   all at once directly in the editor. LaTeX commands, math and citations are left untouched.
4. **Pangram AI detection inside the editor.** The prose of the current file (LaTeX markup,
   math, floats and references stripped) is sent to Pangram's text API; the per-window labels
   are shown in a panel and tinted directly in the editor.

Projects can be linked to GitHub: connect your account once and every new project gets its own
(private) repository, each project folder is a real git repository, and edits are committed and
pushed automatically. Existing repositories can be imported.

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

## GitHub sync

Open **Settings → GitHub** and connect in one of two ways:

- **Connect with GitHub** (OAuth). Register an OAuth app once at
  GitHub → Settings → Developer settings → OAuth Apps → *New OAuth App* with
  Homepage `http://localhost:3000` and callback `http://localhost:3000/api/github/callback`
  (use your real host when deployed), then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
  The app asks for the `repo` scope so it can create and push to private repositories.
- **Personal access token.** Paste a token instead. Classic tokens need the `repo` scope;
  fine-grained tokens need *Administration: read & write* (to create repositories) and
  *Contents: read & write*.

Once connected (defaults, all changeable in Settings):

- Creating a project also creates a repository named after it under your account (private),
  makes the initial commit and pushes it. The project's **Git** tab shows the link.
- **Auto-sync** commits and pushes about 90 seconds after you stop editing
  (`GITHUB_AUTOSYNC_DELAY_MS` to change). Commit messages name the changed files; type your own
  in the Git tab before pressing **Sync** for a deliberate commit.
- **Sync** = commit local changes → `git pull --rebase` → push. If the remote has conflicting
  changes, the rebase is aborted, your files are left untouched, and the error is shown; resolve
  it with git on the command line. The project list and the top bar flag failed syncs.
- The Git tab lists history; hovering a commit offers *Open on GitHub* and *use this version
  of the current file as the diff baseline*, which is a convenient way to compare against any
  earlier draft.
- **Import** on the home page clones one of your repositories (or any https clone URL) as a new
  project; the main file is read from `.editor/config.json` if the repo was created by this
  app, otherwise guessed from `\documentclass`.
- Projects created before connecting get a **Create GitHub repository** button in the Git
  tab; you can also link an existing remote URL there.

What is versioned: your sources, `.editor/baselines/` (so baselines follow you across
machines), `.editor/pangram/` results and `.editor/config.json`. `.build/` output and the
local `project.json` are ignored via a generated `.gitignore`.

The token is used only server-side, passed to git as an HTTP header per command (never written
into `.git/config`), and stored in plain text in `DATA_DIR/settings.json`. The app itself has no
login, so anyone who can reach the server can use the connected account.

## Deployment

This is a server application, not a static site, so **it cannot run on GitHub Pages** (Pages
only serves static files). It needs a Node.js process with a writable disk and `git` and a TeX
engine installed, because the server stores projects on disk, shells out to git and latexmk, and
keeps the Pangram and GitHub tokens server-side. The same applies to serverless hosts such as
Vercel or Netlify: the API routes would deploy, but the filesystem is ephemeral there and LaTeX
is not available.

Good fits:

- **Your own machine** (`pnpm build && pnpm start`), which is the simplest for a single user.
- **Any Docker host**: a small VPS (Hetzner, DigitalOcean, Lightsail), Fly.io, Railway, or Render
  using the provided `Dockerfile`; mount a persistent volume at `/data`. The image is large
  (TeX Live) but needs little CPU or memory.

`deploy/vm-setup.sh` does all of this on a fresh Ubuntu VM in one go (Docker install, clone,
build, start, optional basic-auth proxy on port 80):

```bash
ssh ubuntu@<vm-ip> 'APP_USER=me APP_PASSWORD=choose-one BRANCH=main bash -s' < deploy/vm-setup.sh
```

The script also installs a systemd timer (`rewrite-studio-update.timer`) that checks the deployed
branch every 5 minutes and redeploys automatically when it has new commits, so after the first
run a `git push` is all it takes. `AUTO_UPDATE=0` skips the timer; `UPDATE_INTERVAL=2min` changes
the cadence. On the VM: `systemctl list-timers rewrite-studio-update.timer` and
`journalctl -u rewrite-studio-update -n 50` show its state and logs. GitHub cannot push to a VM
that is only reachable inside a private network, which is why deployment is pull-based; the
GitHub Actions workflow in `.github/workflows/ci.yml` runs lint, tests and the build on every
push so you see failures before the VM picks a commit up.

If the password contains `$` or quotes, pass it base64-encoded so neither shell touches it:

```bash
PW=$(printf '%s' 'my$pass$word' | base64)
ssh ubuntu@<vm-ip> "APP_USER=me APP_PASSWORD_B64=$PW BRANCH=main bash -s" < deploy/vm-setup.sh
```

Put it behind HTTPS and some form of access control (a reverse proxy with basic auth, Tailscale,
or a VPN) if it is reachable from the internet, since the app has no login of its own.

## Configuration

| Variable | Meaning |
| --- | --- |
| `PANGRAM_API_KEY` | Pangram API key. Overrides a key saved in the Settings dialog. |
| `PANGRAM_MOCK=1` | Return locally generated fake detection results (no credits). Results are labelled **mock** everywhere. |
| `ANTHROPIC_API_KEY` | Anthropic API key for the grammar checker. Overrides a key saved in Settings. |
| `ANTHROPIC_MOCK=1` | Fake grammar suggestions without calling Anthropic. |
| `DATA_DIR` | Storage directory (default `./data`). Holds projects, baselines, build output and `settings.json`. |
| `LATEX_ENGINE` | `auto` (default), `latexmk`, `tectonic` or `pdflatex`. `auto` picks the first one found on PATH in that order. |
| `LATEX_TIMEOUT_MS` | Compile timeout, default 180000. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth app credentials for "Connect with GitHub". Optional; a personal access token works without them. |
| `GITHUB_AUTOSYNC_DELAY_MS` | Idle time before an automatic commit + push, default 90000. |

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

### Grammar checker (Claude)

Settings → *Grammar checker* takes an Anthropic API key (or set `ANTHROPIC_API_KEY`; the
environment variable wins) and a model; the default is `claude-sonnet-5-5`, with
`claude-opus-5-5` and `claude-haiku-5-5` selectable. The **Grammar** tab sends the LaTeX source of
the current selection or the whole file (long files are split at paragraph boundaries into
chunks of about 8,000 characters, checked three at a time) to the Messages API with a
structured-output schema: a list of `{original, replacement, reason, category}` edits where
`original` must be a verbatim substring of the input. The server resolves each edit to exact
offsets and drops any it cannot place (shown as "unplaced"). Two levels: *Grammar* fixes only
spelling, grammar, punctuation and misused words; *+ Clarity* also simplifies wordy phrasing. The
model runs at `low` effort, which is enough for copy-editing and keeps cost down; the tab shows
input and output tokens per check.

Accepting a suggestion replaces exactly the recorded span in the editor, after verifying the text
there still matches; if you edited in between, the suggestion is relocated when the original is
unique in the file and otherwise marked stale. Accepted edits flow into the normal autosave, the
baseline diff and git sync like any other edit. Set `ANTHROPIC_MOCK=1` to get fake suggestions
without an API key.

### Pangram integration

Implemented against the documented async task API
(https://docs.pangram.com/api-reference/ai-detection):

- `GET  https://text.external-api.pangram.com/models` — model selectors available to the key
  (shown in Settings and in the detection panel; the list is not hard-coded).
- `POST https://text.external-api.pangram.com/task` with `{ text, model, public_dashboard_link }`,
  header `x-api-key`, returns `task_id`.
- `GET  …/task/{task_id}` polled server-side every second until `stage` is `STAGE_SUCCESS` or
  `STAGE_FAILED`.

**Bulk by default.** Pangram's bulk endpoint is about 20% cheaper than the realtime task API, so
runs go through `POST /bulk` (one item per file), the job id is stored under
`.editor/pangram/jobs/`, and the browser polls `GET /bulk/{bulk_id}` through the server until the
job is `succeeded`, `failed` or `partial`; results are then paged from `GET /bulk/{bulk_id}/results`
and stored per file. Pending jobs survive a page reload. "All N files" submits every `.tex` file of
the project as one job. Bulk jobs have no completion-time guarantee; switch to **Realtime** in
Settings (or in the panel) when you want an answer within seconds or a shareable dashboard link.
Bulk requests are capped by Pangram at 1,000 billable units (100,000 words for Pangram 4).

**Only changed paragraphs.** Pangram bills per started 100-word block per item, so re-running a
whole file after a small edit wastes credits. When a previous result exists for the file, the
panel defaults to *Only changed paragraphs since the last run*: the previous prose and the current
prose are aligned with the same paragraph diff used by the Diff tab, windows from the previous
result that lie entirely inside unchanged paragraphs are kept (re-based to the new text), and only
modified or added paragraphs are sent, concatenated as a single item so partial blocks are not
billed several times. The panel shows the estimate before you click (for example
"1/13 paragraphs · 31 of 346 words · 1 of 4 units"); if nothing changed, nothing is sent. The merged
result is marked **incremental**, and its document-level percentages are computed locally from the
window word counts rather than returned by Pangram. Two caveats: a paragraph scored on its own can
receive a slightly different label than it would inside the whole document, and Pangram's own
document-level verdict is only available from a full run, so untick the box occasionally for one.

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
pnpm test       # unit tests: diff engine, LaTeX stripper, incremental detection, grammar edit resolution, git sync
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
- The grammar checker's request/response handling follows the Anthropic SDK's documented
  `messages.parse` + Zod structured-output path and was tested against the built-in mock; it has not
  been run with a live Anthropic key here.
- The git sync logic is unit-tested against a local bare repository. The GitHub-specific parts
  (OAuth exchange, repository creation, token-authenticated push) follow GitHub's documented REST
  and OAuth flows but were not exercised against GitHub from the development environment.
- Auto-sync timers live in the server process; if the server restarts within the delay window,
  the pending commit happens on the next edit or manual Sync instead.
- Requires `git` on the server (the Docker image includes it).
