# Branded slides with Harness Slides

Harness Brand owns the brand: its colours, type, template, icons, deck directions and the
brand audit, read from the brand's pack. [Harness Slides](https://github.com/dbbaskette/harness-slides-skill)
owns the slides: outlines, compositions, editable native output and review. Harness Brand
hands Harness Slides a brand contract; it never draws slides itself.

The commands below are given in full in the `commands` block of `guidance start`, as
`node <Harness Brand>/scripts/harness-brand.mjs …`, each naming the brands folder with `--data`.

## The steps of a new deck

0. **Intake.** Settle, once and before drafting, the brand, whether the deck is a talk
   presented live or a handout people read (default live for a presentation, and say so),
   and whether to research first. Put the delivery in the outline's `delivery`.
1. **Draft.** Write the outline and change it until the person approves what the deck says,
   reviewed as a whole.
2. **Look.** Run `look samples` on the approved outline: it draws one content slide in each
   of the brand's deck directions. Show the rendered samples and wait for the person's pick,
   then record it with `look choose`, in their words. The pick sets the outline's
   `direction`, `house` and `layouts`. Skip this only when the caller supplies an approved
   direction for this deck.
3. **Build.** Export the contract with `contract export --medium slides --delivery
   live|reading` and build with Harness Slides, giving every composer the `worker` text from
   `guidance` unchanged. Compose each slide from its content with the brand's colour and
   type roles; compile and preview each batch of up to three slides, inspect every changed
   image and revise before going on.
4. **Review.** Preview the whole deck, have it reviewed by someone who did not draw it, fix
   what is found, render it into the native template, then run the brand audit
   (`presentation`) and the [review](slide-review.md).

Open with the template's cover, break long decks into sections and close with its closing
slide, using the direction's `layouts`; never put a cover, section or closing on the
content layout. `layouts` lists every layout of the brand's template and what each is for.

## Icons

`icons --query "<concept>"` finds an icon in the brand's library. Place it by its id in a
composition (`{type: "icon", icon: "<id>"}`): the contract carries the brand's icon deck, so
Harness Slides copies it as native shapes and colours it in a brand role. One icon, one
meaning; never emoji or drawn substitutes.

## Checkpoints

- **Draft approval** is the content checkpoint: the draft is reviewed as a whole, and the
  person's words go into the outline's `approval`.
- **The look** is chosen from rendered samples.
- **Final acceptance** follows the brand audit and review of the rendered native deck.

A studio may host these checkpoints in its own interface; none is skipped. Per-slide
design helpers are for an explicit slide-by-slide walkthrough only.

## Previews

The samples, every build batch and the final deck are judged from rendered images:

1. Harness Slides' Google preview (`--preview google`) renders through the person's Google
   Drive; ask them once whether that is fine.
2. LibreOffice (`--preview local`) where it is already installed. Never install it yourself.
3. With neither, say that no previews are possible, choose the default direction with
   `look choose --unrendered`, and call the deck an unreviewed draft.
