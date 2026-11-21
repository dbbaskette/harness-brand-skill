# Changelog

## 1.3.0

- `rebrand run --document` takes `--layout FILE`: a JSON file that fills a document
  template's sidebars, sets a row of up to four library icons with captions, keeps a figure
  with its caption, adds page breaks, and names the section that opens the final page. Each
  is anchored to a heading; a heading that matches no section, or more than one, is refused.
- With a layout, the result is rendered and the report says how many pages it has, which page
  each heading, sidebar and figure is on, whether the subtitle fits one line, and where two
  sidebars would overlap. A PDF is saved beside the Word file.
- `rebrand run --document` also takes a local Markdown file: `# ` is the title, an italic line
  under it the subtitle, `## ` and `### ` the headings, with lists, bold, italic and pictures.

## 1.2.3

- `rebrand run --document`: a short line under the title is taken as the subtitle even
  when the title has the Title style and the line has no Subtitle style (set in italic,
  not a full sentence, or followed by a heading or a longer paragraph). The report says so.
- A title too long for the one-line running head on inside pages is shortened there to its
  part before a colon or dash, or cut at a word with an ellipsis. The cover keeps it whole.
- A long title is set smaller on the cover, with the subtitle, so both stay inside the
  cover's text box. The report gives the sizes used.

## 1.2.2

- `rebrand run --document`: a long subtitle (over 90 characters) is set at 85% of the
  template's size, and over 140 characters at 75%, so it keeps its place on the cover. The
  report says when it did so.

## 1.2.1

- `rebrand run --document`: a drawing wider than the template's text column is scaled to
  fit, and the words inside it (callouts, labels) now scale with it. They used to keep
  their size and outgrow their boxes.
- `rebrand run --document` names its result `<source>-<brand>-branded`, so copies of one
  source in several brands' templates can be told apart. `--name` still overrides it.

## 1.2.0

- A brand pack can carry Word document templates, such as a solution brief or a white
  paper. `brand.json` lists them under `documents` (`id`, `name`, `useWhen`, `file`,
  `page`, `notes`), the files live in `templates/documents/`, `pack check` validates the
  list and `pack seal` seals the files. `harness-brand documents --brand B` lists a
  brand's templates and where each file is. Packs without `documents` are unchanged.
- `rebrand run SOURCE --brand B --document ID` flows an existing Google Doc or local
  `.docx` into one of the brand's document templates. The template keeps its cover,
  headers, footers, back page and styles; the source's title, headings, paragraphs,
  lists, tables, pictures, links, footnotes and code replace the sample copy, each in the
  template's own style. `--output word|google|both` (default both) chooses a Word file, a
  new Google Doc, or both. Nothing is reworded, the source is never edited, and the run is
  refused if any text, link, picture or footnote is missing from the result. A rebranding
  profile lists its templates under `documents` in its `brand.json`.
- Google Docs larger than Drive's 10 MB export limit are exported through the file's own
  export link.

## 1.1.1

- `look samples` shows a look on the first slide that can be drawn in every direction. It
  used to pick one slide and refuse when that slide was too full for the brand's type, even
  when most of the deck's slides fit. A slide named with `--slide` is still used as given.

## 1.1.0

- One shared, generic rebranding worker for existing Google Slides and Docs, with
  explicit brand selection, sealed local snapshots, optional named shortcuts,
  preservation checks and Codex/Claude visual review. Brand-specific data and
  regression suites live with the externally configured brands folder.


- Public setup now uses any local brands folder, with no company-specific prerequisite.
  The interactive installer asks for a folder when none is configured; `--data FOLDER`
  validates and saves an explicit choice, and upgrades retain the current choice.
  Unattended installs can configure brands later. README and skill routing now explain
  user-provided packs and optional company integrations.

- `harness-brand data --install FOLDER` copies the brands in FOLDER (each brand folder and the
  icon libraries) into a local brands folder, `~/Library/Application Support/Harness
  Brand/brands` on a Mac. The brand commands read it when `--data`, `HARNESS_BRAND_DATA` and
  `data --set` name no folder.
- apply-brand no longer carries brands. It reads each brand's `apply-brand/` profile from the
  same brands folder as Harness Brand, found the same way; the four profiles moved to
  `<id>/apply-brand/` of the brands folder. `APPLY_BRAND_BRANDS` is gone.
- The brands folder is its own private repository, `dbbaskette/broadcom-brands` (its root is
  the brands folder), instead of `brands/` of `dbbaskette/tanzu-marketing-hub`.
- The shared icon library is `functional-icons` (it was `vmware-functional`): the same 894
  glyphs, in `icon-libraries/functional-icons/`, named in every pack's `icons`.

## 1.0.0 (3 November 2026)

Harness Brand is Marketing Studio's brand skill, in place of Tanzu Brand. It reads brands from
brand packs kept with the studios' storage instead of carrying them built in.

- Brand packs: a written format (`docs/brand-pack-format.md`) and commands that take a pack's
  exact parts from the brand's own files (`pack tokens`, `pack measure`, `pack previews`),
  draft the rest (`pack scaffold`), check it (`pack check`) and seal it (`pack seal`), with a
  guide for finishing a pack (`references/building-a-pack.md`).
- Icon libraries any brand may use (`docs/icon-library-format.md`, `pack icons`), drawn as a
  native PowerPoint icon deck for Harness Slides.
- Everything the studios call: `brands`, `contract export` and `contract check` (slides and
  blog, with author voice profiles), `icons`, `layouts`, `presentation` (the brand audit),
  `doctor`, `guidance`, and `look samples` / `choose` / `status`.
- The brands folder comes from `--data`, `HARNESS_BRAND_DATA`, or the folder recorded with
  `harness-brand data --set`.
- Installers for Marketing Studio (`install-mac.mjs --yes --research skip`,
  `install-skill.mjs --research skip`) and a Mac release archive with its checksum.
- The packs for Tanzu Division, VMware by Broadcom, Broadcom and TrueSource by Broadcom, and
  the VMware by Broadcom functional icon library, are in `brands/` of
  `dbbaskette/tanzu-marketing-hub`.

The apply-brand skill (restyling an existing deck) is unchanged and still installed on its own.
