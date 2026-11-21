# Rebrand an existing Google file

Use this mode to preserve business content while replacing template identity. New
narrative content and major redesign belong to Harness Slides or another authoring
workflow. The engine uses gcloud and Drive export/import and returns a separate
native Google Slides or Docs copy. It never edits the source or changes sharing.

## Select and inspect

Choose a brand explicitly. Run `node scripts/harness-brand.mjs rebrand status --brand ID`
to locate its installed rulebook, brand-specific workflow and template guidance.
Read those selected references, then inspect every source slide/page. Preserve
wording, names, notes, links, QR codes, data, meaningful grouping and content images.
A first slide is not automatically a cover. Inspect old logos and functional symbols
before requesting their removal or replacement. Image-only slides are refused.

Profiles may require a private `--template-plan FILE` identifying inspected shape
roles. Follow that profile's alignment mode; do not infer roles from font size alone.
Keep exact planned type sizes. Report fitting conflicts instead of shortening copy,
splitting slides or silently shrinking planned typography.

## Run

From the Harness Brand folder:

```sh
node scripts/harness-brand.mjs rebrand run 'SOURCE_URL' --brand ID --review
```

`--review` uses the calling harness's existing login: Codex/OpenAI or Claude
Code/Anthropic. Obtain missing authorization to send these pages and extracted text
to that provider; existing authorization persists. An undetected terminal must name
`--reviewer codex|claude`. Review is read-only, with at most two model calls and one
bounded repair batch. It does not change harness settings or rewrite content.

Use `--dry-run --preview /tmp/deck.pptx` (or `.docx`) for local preview only. Do not
routinely repeat preview and creation. Without model review, render and visually
inspect every page yourself, including Google's native export. Content hashes,
font counts and palette checks do not establish visual acceptance.

Options include `--account`, `--folder`, `--name`, `--template-plan`, `--icon-map`,
`--remove-brand-shape`, and `--run-dir`; `rebrand run --help` describes them.
Default output name is `<original>-branded`. Icon search and inspected replacement
use `rebrand icons --brand ID ...`; read the selected profile's icon reference.

## Review and report

Read `report.md` and `result.json` in the reported private run folder. Compare
source and branded renders, verify business content, and inspect the returned
native Google file or its PDF export. Return the native URL, report link,
slide-by-slide changes and unresolved findings. `branded_with_exceptions` is a
qualified result, not full compliance. An output without completed visual review
must be described as awaiting visual acceptance.

If a copy was created before verification failed, retain its URL and diagnose that
copy. Do not blindly rerun creation. `--verify-copy URL` rechecks content read-only;
it does not replace visual review. Google conversion may alter unsupported native
features, wrapping and pagination; no lossless-fidelity promise is made.

## Setup and updates

The installer sets up the private Python 3.11+ runtime when selected data contains
rebranding profiles. To install or deliberately refresh profiles:

```sh
node scripts/harness-brand.mjs rebrand setup --data /path/to/brands
```

This verifies sealed files and records a local snapshot for each supported brand.
Runtime checks those snapshots and never fetches or silently updates brand data.
A profile may provide a small named skill shortcut; all shortcuts use this same
worker and Python environment, and are linked through Harness Brand's installed
address (`…/Harness Brand/current/brand-skills/<name>`), so an update leaves the
links as they are.

The Python environment, the snapshots and the shortcuts belong to the installed copy
of Harness Brand. Installing an update sets them up again; when it did not, `rebrand
run` and `rebrand status` refuse and name the command above in full. Nothing a run
saved is tied to the version that made it: reports record the worker version and
asset identity for information only. A run given no `--run-dir` keeps its report and
files in `rebrand-runs/` beside the installed copy, where an update leaves them.
`rebrand status` gives the rulebook and references through the installed address.

Use the existing intended Google login. If Drive authorization is missing:
`gcloud auth login --enable-gdrive-access --force`. No Cloud project or gws is needed.
Local preview requires LibreOffice and Poppler; do not install system applications
without authorization. Rebranding does not require Harness Slides.

## A document in a brand template

When the person wants a document put into the brand's white paper, solution brief or
other document template (not just restyled), use the template mode. `harness-brand
documents --brand B` lists the templates; when the person has not said which, ask, do not
guess between a brief and a paper.

```sh
python3 scripts/brand.py 'GOOGLE_DOC_URL_OR_FILE.docx' --document white-paper-tech --output both
```

`--output` is `word`, `google` or `both` (the default): produce the one(s) asked for. The
source is read, never edited. The result is named
`<source>-<brand>-branded`. The template keeps its cover, running head, footers, back
page and styles; the source's words replace the sample copy. Bold, italic, underline,
strike and super/subscript are kept, code keeps a fixed-width face, and every other source
format is dropped. The run refuses to write anything if text, a link, a picture or a
footnote would be lost, and checks the Google copy again after import.

### Sidebars, an icon row and page breaks

A template's main column takes the source's words. Its other slots take a layout file:

```sh
python3 scripts/brand.py FILE.docx --document solution-brief --layout layout.json --output word
```

```json
{"closing_from": "Why us",
 "page_break_before": ["The platform"],
 "figure": {},
 "icon_row": {"before": "The risks", "items": [{"icon": "functional-icons.database", "label": "AI-ready data", "detail": "Governed data products"}]},
 "sidebars": [{"page_of": null, "blocks": [{"type": "heading", "text": "At a glance"}, {"type": "bullet", "text": "**Reach** – where it runs"}]},
              {"page_of": "The platform", "blocks": [{"type": "stat", "text": "76 percent …", "attribution": "A survey, 2026"}]}]}
```

Each heading named must match exactly one level-1 or level-2 heading of the source; otherwise
nothing is written. `page_of: null` is the opening page. Block types are `heading`, `body`,
`bullet`, `stat` and `quote`; a `stat` or `quote` needs its `attribution`, and a `quote` is only
for words a source attributes to a named person. `**bold**` is the only inline markup. An icon
row takes one to four icons from the brand's library (`rebrand icons --brand B search …`).
`closing_from` names the section that opens the final page; without it the last level-1 section
does. `figure: {}` keeps a picture on one page with the paragraph after it.

The source may be a `.md` file instead of a `.docx`: `# ` is the title, a whole line in
_italics_ under it the subtitle, `## ` and `### ` level-1 and level-2 headings, with `- ` bullets,
`1. ` numbered items, `**bold**`, `*italic*` and `![alt](file)` pictures read from beside the file.

With LibreOffice and poppler present the result is rendered and `result.json` gains `layout`:
the page count, the page each heading, sidebar and figure is on, whether the subtitle fits one
line, and any page where two sidebars would overlap. Tell the person those findings. Word may
break pages a line or two differently, so look at the pages before calling it done. Without
those tools the layout is reported as unchecked.

Read the report's "Document template" section and tell the person:

- the title and subtitle used, and whether they were guessed (a source with no Title
  style gives its first heading as the title and a short line under it as the subtitle);
- anything listed as not carried;
- that the Word file is the faithful output: its table of contents fills in page numbers
  when Word updates the field, and the Google copy can lose page furniture (a footer
  logo) and keeps a contents list without page numbers;
- any warning that the template is not an official one for the brand.

Look at the rendered pages before calling it done: a long subtitle can run into cover
artwork, and wide pictures are scaled to the text column. `--review`, `--template-plan`,
`--verify-copy` and `--dry-run` do not apply to this mode.

