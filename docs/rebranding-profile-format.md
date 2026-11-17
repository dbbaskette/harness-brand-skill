# Rebranding profiles

Authoring packs and preservation-focused rebranding are separate capabilities.
A brand can provide either or both. Rebranding profiles are local data; the engine
never imports code from a brands folder.

```text
brands/<id>/rebrand/
  manifest.json       schema 1, brand ID, destination → source path and SHA-256
  brand.json          identity, font, palette, color/table roles and runtime settings
  visual-review.md    concise brand-specific visual acceptance criteria
  entry.json          optional {schema: 1, skill: "company-brand", name: "Company"}
  SKILL.md            optional small shortcut instructions
  references/        brand workflow, template plan, provenance and icon guidance
```

A manifest maps snapshot paths under `assets/` or `references/` to paths relative
to the brands folder. Every file has a SHA-256. Paths must stay within their roots,
including symlink resolution. Required destinations are `assets/brand.json`,
`assets/<id>/brand.json` (identity profile), `assets/<id>/template.pptx`,
`assets/<id>/rules.md`, `assets/icons/library.zip` and `references/visual-review.md`.
The identity config's `id` must match the folder ID and its `profile` must be
`assets/<id>`. Do not put credentials, customer decks or runtime code in a profile.

The identity profile describes the canvas, light variant, theme, palette, roles,
artwork and chrome. Runtime settings name native layouts, title/subtitle boxes,
typography, content bounds, Docs identity and icon treatment. These values come
from measured, approved templates and rulebooks; adding a folder alone does not
qualify a new brand for rebranding.

`alignment_mode` selects `preserve` (bounded fitting), `columns` (explicit template
roles/column samples), or `text-roles` (mapped paragraphs and card roles).
Template-specific parameters live in `runtime.template_contract`. Optional
`allowed_slide_roles`, `footer_surface`, `font_files`, `dark_backdrop`,
`light_backdrop` and shape names must be supplied by the brand, not inferred from
its name. The current focused worker supports light profiles; authoring may support
additional variants. Unsupported profiles must not silently fall back to another brand.

Optional shortcuts require sealed `references/entry.json` and `references/SKILL.md`
manifest entries. The installer generates its own launcher and points the shortcut
at the shared worker. Existing unrelated skill directories are never overwritten;
`--replace-brand-shortcuts` permits replacing prior shortcut symlinks only.

Setup takes a verified local snapshot and records its manifest hash and source
revision when available. Branding then works without the original checkout and
refuses tampered snapshots. Updating profiles is explicit setup, not a runtime fetch.
Keep brand-specific regression suites with their data repository and run them against
the shared engine before publishing a profile update.

## Document templates

A profile may offer Word document templates to `rebrand run --document ID`. List them in the
profile's `brand.json` and seal each file in `manifest.json` under
`assets/<brand>/documents/`:

```json
"documents": {
  "white-paper-tech": { "file": "white-paper-tech-us-letter.docx", "name": "Technical white paper", "official": false }
}
```

`official: false` adds a warning to every run that the template was derived and is not the
brand's own. A template needs two sections (the last carries the back page or legal
footer), paragraph styles the filler looks for (`vmwbodycopy`, `vmwHeadline`, `vmwSubhead`,
`vmwHeadlinepage2onwards`, `vmwbullet1`, `vmwbullet2`, `vmwnumbered`, `vmwtableheadingtop`,
`vmwtablebodycopy`, `Heading1` to `Heading3`; a missing one falls back to body copy), and
may have a cover and a table of contents before its first page break.

