# Building a brand pack

This guide is for whoever finishes a brand pack: a person, or an assistant such as Claude or
Codex asked to do it. The pack's format is in
[docs/brand-pack-format.md](../docs/brand-pack-format.md); read it first. Commands make the
exact parts of a pack. This guide covers the parts that need judgement: which colour does
which job, where content goes on a slide, what each layout is for, the brand's rules and
the deck directions it offers.

## What you start from

The brand's own files, kept as received in `brands/<id>/sources/`:

- a design-system export (a Claude Design ZIP archive, or a `tokens.json`);
- one PowerPoint template for each variant, such as light and dark;
- the brand book, or whatever written rules the brand has;
- the logos, as SVG or PNG, for light and for dark grounds;
- example decks, when there are any.

A brand may use a parent organization's template when its approved rules allow it:
keep the template with its sources, alongside its own tokens and rules.

## Steps

1. Make the exact parts:

   ```bash
   harness-brand pack tokens brands/<id>/sources/<export> --into brands/<id>/pack
   harness-brand pack measure brands/<id>/sources/<template>.pptx --variant light --into brands/<id>/pack
   harness-brand pack previews brands/<id>/pack --variant light
   ```

   Measure and draw each variant. Read what `pack measure` prints: it names the masters it
   left out. If the master it chose is not the brand's current one, measure again with
   `--master`.

2. Draft the rest:

   ```bash
   harness-brand pack scaffold brands/<id>/pack --icons functional-icons
   ```

   The draft is a starting point. Its `draft` list in `brand.json` says what is left.

3. Review and finish the draft, as below. Keep every change traceable to a source. Copy the
   logos into the pack's `assets/` folder and name them in `brand.json`. Each icon library
   the brand names must already be in `brands/icon-libraries/`; see
   [docs/icon-library-format.md](../docs/icon-library-format.md) to add one.
   Replace every line the draft starts with `Review:`.

4. Remove `draft` from `brand.json`, then check until it passes:

   ```bash
   harness-brand pack check brands/<id>/pack
   ```

5. Seal it, and have a person look at the previews and the diff before it is committed:

   ```bash
   harness-brand pack seal brands/<id>/pack
   ```

## Colour roles

Open `tokens.json` beside the brand book. For each role in the format document, find the
colour the brand book gives that job. Prefer the design system's role colours (`surface`,
`ink`, `ink-title`, `on-accent`) over raw hues, since they carry the right value for each
theme. Never invent a colour or adjust one to pass a contrast check: if the brand's colour
fails, say so and choose another colour the brand allows for that job.

`accentAqua` is the brand's main supporting accent, whatever its hue: Harness Slides gives
it that name. A dark variant takes `theme: "dark"`, so each role takes its colour's dark
value.

## Slides

Look at the previews. Choose the layout new content slides are built on: usually
`Title Only`. Take `titleBox` from its title placeholder and `contentBox` from the body of
the brand's usual content layout, rounded to whole points. `reservedBottom` is the top of
the footer: the slide number, the legal line or the logo, whichever is highest.

Take the type sizes from the template's placeholders and the brand book's type ramp. `body`
is for a deck that will be presented and `bodyReference` for one that will be read: when
the brand book gives one size for read-ahead decks, that is `bodyReference`.

## What each layout is for

In `layouts.json`, add to each layout what a slide builder needs to choose it, using the
fields the format document lists: its `relationship` (what kind of content it holds, such
as a comparison or a sequence), its `contentRange` (how much it takes), its `components`,
`searchTerms`, `delivery`, and `notes`. Mark layouts the brand keeps for itself, or that
are broken, `searchable` false. Judge from the preview and the placeholders, not the
name alone.

## guide.md

Write the brand's rules in plain sentences under the three headings. Each rule says where
it comes from: "Titles are sentence case (brand book, page 12)". Quote short rules exactly.
Leave out what the brand does not say, and leave out any author's own voice: a pack holds
only how the brand writes and names things.

## Directions and audit

Each variant offers at least one direction: which role leads (`focal`), which fills the
supporting cards (`neutral`), and which colours stand for one thing in a deck (`meanings`).
Take them from the brand book's guidance on colour use and from the example decks: a brand
that gives each chapter its own colour has one meaning per chapter colour. The `layouts` of
a direction are the cover, section and closing layouts it uses, by name.

`audit.json` can stay as the draft has it unless the brand book sets other limits, such as
a smallest text size or a word count per slide.

## When the sources disagree

The newer source wins. List each disagreement for the person reviewing the pack: what each
source says, and which was taken.
