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
worker and Python environment. Updating a checkout does not change rebranding until
setup is run again. Reports record the worker version and asset identity.

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

