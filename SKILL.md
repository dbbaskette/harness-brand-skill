---
name: harness-brand
description: Use local brand packs to supply visual and writing guidance, templates and icons for branded slides, blogs and infographics. Build and validate packs, export brand contracts audit finished PowerPoint decks, and rebrand existing Google Slides or Docs with a selected local profile.
---

# Harness Brand

Harness Brand reads user-supplied **brand packs** from a configured local folder: `brands/<id>/pack/` for each brand, `brands/icon-libraries/` for the icon
libraries they share. It never changes a brand it reads; only the `pack` commands write, and
only into the pack or library folder they are given.

Run every command from this skill's folder:

```sh
node scripts/harness-brand.mjs <command> [options]
```

The brand commands find the brands folder from `--data FOLDER`, else `HARNESS_BRAND_DATA`,
else the folder recorded with `node scripts/harness-brand.mjs data --set FOLDER`, else the
local brands folder that `data --install FOLDER` copies brands into
(`~/Library/Application Support/Harness Brand/brands` on a Mac).
`brands` lists the usable brands and variants; `doctor` says what is missing.
No company or private repository is required. If the folder is missing, ask for the
parent folder containing the user's brand packs; see [setup](README.md#your-brands-folder).
Honor an explicitly chosen brand. Otherwise retain a settled project choice or ask
once before drafting. Do not infer identity from product names in the content.
Load only the selected brand's guidance and the references needed for this task.

## Slides

Read [references/harness-slides.md](references/harness-slides.md) before building a deck. In short:

1. `guidance start --skill slides --project DIR --brand BRAND` starts Harness Slides' public
   guidance with the brand's own steps, commands and worker guidance.
2. After the person approves the draft, `look samples` draws one slide in each of the brand's
   deck directions; `look choose` records their pick in their words.
3. `contract export --medium slides --brand BRAND --delivery live|reading --output NEW_DIR`
   gives Harness Slides the brand: colours, type, template, icon deck and deck direction.
4. `icons --query "<concept>"` finds an icon to place by its id.
5. `presentation --brand BRAND --file deck.pptx` audits the finished deck; then follow
   [references/slide-review.md](references/slide-review.md).

## Blogs and infographics

`contract export --medium blog --brand BRAND --output NEW_DIR [--voice-profile FILE]` gives
the writer the brand's colours, type, rules and voice and naming, with the author's voice
kept apart.

## Making or changing a brand pack

A pack is made from the brand's own files with the `pack` commands and finished by a person
or an assistant: see [docs/brand-pack-format.md](docs/brand-pack-format.md) and
[references/building-a-pack.md](references/building-a-pack.md). Icon libraries are described
in [docs/icon-library-format.md](docs/icon-library-format.md).

## Rebranding an existing Google file

For content-preserving branding of an existing deck or document, read
[the rebranding workflow](references/rebranding.md). Use `rebrand status --brand ID`
to locate only that brand's installed rules and template guidance, then
`rebrand run SOURCE --brand ID`. Keep business content and return a new native copy.
Visual acceptance requires every rendered page and the native output; content checks
alone do not establish it. Never substitute generation or another brand for an
unsupported profile. Brand-specific shortcuts call the same shared worker.
