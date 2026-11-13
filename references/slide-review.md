# Reviewing a branded deck

Harness Slides owns per-slide inspection, editability checks and final review; follow its
review guidance. This adds what the brand checks.

## The brand audit

```sh
node <Harness Brand>/scripts/harness-brand.mjs presentation --brand BRAND --variant VARIANT --file deck.pptx --json
```

(`guidance start` gives this command in full, with the brands folder, as `brand.commands.audit`.)

It reads every slide against the brand pack's `audit.json` and prints `PASS`, `WARN` or
`BLOCKED`, each finding with its slide number:

- `UNRESOLVED_PLACEHOLDER` (blocks): template text such as "Click to add text" left on a slide.
- `SMALL_TEXT`: text below the brand's smallest size; captions (a source, caveat, edge label
  or state badge Harness Slides placed, or a shape named `caption…`) may go down to the
  brand's caption size. Footers, dates and slide numbers are not judged.
- `HIGH_TEXT_DENSITY`: more words on a slide than the brand allows.
- `TEXT_LED_SLIDE`: many words and no picture, chart, table or diagram.
- `FONT_NOT_IN_BRAND`: text set in a font the brand does not use.
- `OUT_OF_BOUNDS`: a shape past the slide's edge.
- `BRAND_LAYOUT_UNKNOWN`: a slide on a layout that is not in the brand's template.

Exit 0 means pass or warnings, 2 blockers; `--strict` also exits 1 on warnings. Colour
contrast, inherited text sizes and artwork are not judged by the audit: look at the
rendered slides for them.

## Looking at every slide

For each rendered slide ask:

- Does it use the template's own cover, section and closing layouts, and the content layout
  for everything else, with the master's artwork untouched?
- Is every colour a brand role, used for the job the deck's direction gives it, and named in
  words as well as colour?
- Is text readable on its fill, and no smaller than the brand allows?
- Is every icon from the brand's library, one per concrete idea, in a brand colour?
- Does the main construction fill the content area, with no large empty boxes?
- Are figures sourced and qualified, and nothing claimed that the sources do not support?

Record what you found against the slides you actually looked at. Deliver only when the
audit has no blockers and every slide has been seen rendered; otherwise call the deck an
unreviewed draft.
