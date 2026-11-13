# Brand pack format

A brand pack is everything Harness Brand knows about one brand: its colours and type, its
PowerPoint template and what each layout is for, its rules and voice, the deck directions it
offers, and the limits its brand check holds a deck to. When a deck or a page uses a pack,
Harness Brand only reads it; only the `pack` commands below write to a pack, and only when
you run them. A pack is made from the brand's own source files: the exact parts by
`harness-brand pack` commands, the rest by a person or an assistant, following this
document. Anyone can make one by hand.

Icons are kept apart, in icon libraries that any brand may use: see
[icon-library-format.md](icon-library-format.md).

## Where a pack lives

```
brands/
  <id>/
    sources/            what the pack was made from, kept by you as received
    pack/               the pack: the files below
  icon-libraries/       reserved by Harness Brand, never a brand id
```

`<id>` is lower-case letters, digits and hyphens, starting with a letter or digit, such as `tanzu`
or `vmware`. `brands/` sits at the root of the team's repository, or in the studios' local
folder when they keep their work locally.

## The files

| File | Required | What it holds | Made by |
|---|---|---|---|
| `brand.json` | yes | who the brand is, its variants, which colour does which job, its slide geometry and type, its icons and language | a person or an assistant |
| `tokens.json` | yes | every colour with its light and dark value, the type styles, spacing and radius | `pack tokens`, or by hand |
| `templates/<variant>.pptx` | for slides | the brand's PowerPoint template, as received | `pack measure` copies it |
| `layouts.json` | for slides | each template layout as measured, and what each is for | `pack measure`, then a person or an assistant |
| `previews/<variant>/<layout>.png` | no | a picture of each layout | `pack previews` |
| `guide.md` | yes | the brand's rules, voice and naming, in plain words | a person or an assistant |
| `directions.json` | for slides | the deck directions the brand offers | a person or an assistant |
| `audit.json` | for slides | the limits the brand check holds a deck to | a person or an assistant |
| `assets/` | yes | the logos, and any art `brand.json` names | copied from the sources |
| `compositions/` | no | authored example slides | a person or an assistant |

A brand without templates is a brand for blogs and other writing only: it has no `slides`
in `brand.json`, no `layouts.json`, no `directions.json` and no `audit.json`.

Every path a pack file gives is inside the pack, written with `/`, such as
`templates/light.pptx`.

## brand.json

```json
{
  "schema": 1,
  "id": "example",
  "name": "Example Co",
  "aliases": ["example", "example co", "exco"],
  "defaultVariant": "light",
  "fonts": { "sans": "Arial", "mono": "Courier New" },
  "variants": {
    "light": {
      "theme": "light",
      "colors": {
        "canvasPrimary": "white", "canvasSecondary": "mist", "inkPrimary": "black", "inkDeep": "black",
        "inkSecondary": "dark-gray", "headingPrimary": "blue", "accentAqua": "aqua", "onAccent": "white",
        "statusCritical": "red"
      },
      "slides": {
        "template": "templates/light.pptx",
        "layout": "Title Only",
        "canvas": { "width": 960, "height": 540 },
        "titleBox": { "x": 48, "y": 36, "width": 864, "height": 60 },
        "contentBox": { "x": 48, "y": 120, "width": 864, "height": 360 },
        "reservedBottom": 492,
        "spacing": { "inset": 16, "column": 28 },
        "typography": {
          "title": { "size": 28, "bold": false, "colorRole": "headingPrimary" },
          "section": { "size": 40, "bold": false, "colorRole": "headingPrimary" },
          "body": { "size": 24, "bold": false, "colorRole": "inkDeep" },
          "bodyReference": { "size": 20, "bold": false, "colorRole": "inkDeep" },
          "label": { "size": 20, "bold": true, "colorRole": "inkDeep" },
          "caption": { "size": 14, "bold": false, "colorRole": "inkSecondary" },
          "metric": { "size": 60, "bold": false, "colorRole": "accentAqua" },
          "quote": { "size": 30, "bold": false, "colorRole": "inkDeep" }
        },
        "chart": { "seriesRoles": ["headingPrimary", "accentAqua"], "axisFontPt": 14 },
        "table": { "headerFillRole": "headingPrimary", "headerTextRole": "onAccent", "fontPt": 16, "paddingPt": 6 },
        "icon": { "size": 48, "colorRole": "headingPrimary" },
        "image": { "frameRole": "canvasSecondary", "frameWidthPt": 1, "calloutRole": "accentAqua", "calloutFontPt": 20, "fit": "contain" },
        "fills": { "tints": false }
      }
    }
  },
  "icons": [{ "library": "functional-icons", "default": true, "roles": ["headingPrimary", "accentAqua", "inkDeep"] }],
  "logos": { "onLight": "assets/logo-on-light.svg", "onDark": "assets/logo-on-dark.svg" },
  "language": {
    "headlineCase": "sentence",
    "preserveProductNamesAndAcronyms": true,
    "names": ["Write Example Co in full, never ExCo.", "Example Platform is a product: keep its capitals."]
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | `1` |
| `id` | yes | the brand's folder name |
| `name` | yes | the brand's name, for people |
| `aliases` | yes | the words a request may use for the brand, in lower case |
| `defaultVariant` | yes | the variant used when a request names none |
| `fonts` | yes | `sans`: the font every slide and page is set in, one font name as installed, such as `Arial` (not a list of fonts); `mono`: the font for code, likewise (Courier New if not given) |
| `variants` | yes | one entry per variant, such as `light` and `dark` (below) |
| `icons` | no | the icon libraries the brand uses: `library` (the id of a library in `brands/icon-libraries/`), `default` (searched first), `roles` (for a glyph library, the colour roles a glyph may be drawn in) |
| `logos` | yes | `onLight` and `onDark`: the logo files in `assets/` for light and dark grounds, such as `assets/logo-on-light.svg` |
| `language` | no | `headlineCase` (`sentence` or `title`), `preserveProductNamesAndAcronyms` (true or false), `names` (a list of naming rules, each a sentence) |
| `visual` | no | anything more the brand's contract should carry, as it is: `geometry`, `imagery`, `accessibility`, `colorPolicy`, `emphasis`, and `infographicTypography` (`body_pt`, `source_pt`, `body_px`, `source_px`: the smallest text sizes for infographics) |
| `draft` | no | what is left to review, as sentences, written by `pack scaffold`; `pack check` refuses a pack that has it, so remove it once the pack is reviewed |
| `files`, `sources`, `brandSha256` | no | written by `pack seal`, never by hand: each pack file (its path in the pack) and each file in `sources/` (its path there), with its SHA-256 in hex (`brand.json` and `previews/` are left out of `files`), and the SHA-256 of `brand.json`'s own fields |

An author's own voice belongs to the writer, not to a brand pack: a pack holds only how the
brand writes and names things.

### A variant

A variant is one look of the brand, such as light or dark, with its own template and
colours. Its name is lower-case letters, digits and hyphens, starting with a letter.

| Field | Required | Meaning |
|---|---|---|
| `theme` | yes | which values of `tokens.json` the variant takes: `light` or `dark` |
| `colors` | yes | each colour role (below) and the `tokens.json` colour that plays it |
| `slides` | for slides | the variant's slides (below) |

### Colour roles

A role names a job, and the variant says which colour does it. Every role must name a
colour in `tokens.json` whose value for the variant's theme is a plain `#rrggbb` colour.

| Role | Required | Its job |
|---|---|---|
| `canvasPrimary` | yes | the slide or page ground |
| `canvasSecondary` | yes | a quieter ground, for panels and supporting cards |
| `inkPrimary` | yes | body text on `canvasPrimary` |
| `inkDeep` | yes | the strongest text colour |
| `headingPrimary` | yes | titles and headings |
| `accentAqua` | yes | the brand's main supporting accent, whatever its hue (Harness Slides calls it so) |
| `inkSecondary` | no | captions and quieter text |
| `onAccent` | no | text on an accent fill |
| `statusCritical`, `statusAttention` | no | warnings and alerts |
| any name starting `accent` | no | further accents, offered as supporting fills |

Any other role name may be added and used in `slides`, `icons` and `directions.json`.
`inkPrimary`, `inkDeep`, `headingPrimary` and `inkSecondary` must reach a contrast of 4.5
to 1 against `canvasPrimary`, and so must the colour of each type style in `slides` but
`section` (whose ground is its section layout's), except that large text (18 points, or 14
points bold) needs only 3 to 1.

### A variant's slides

| Field | Required | Meaning |
|---|---|---|
| `template` | yes | the variant's template, `templates/<variant>.pptx` |
| `layout` | yes | the name (as `layouts.json` gives it) of the layout new content slides are built on |
| `canvas` | yes | `width` and `height` of the slide, in points |
| `titleBox`, `contentBox` | yes | `x`, `y`, `width`, `height` in points: where the title and the content go, inside the canvas |
| `reservedBottom` | no | the distance in points from the top of the slide below which content never goes (footers, logos); at least the content box's bottom |
| `spacing` | no | in points: `inset` (inside a card, 16 if not given), `column` (between columns, 28), and optionally `small`, `related` (between related items) and `group` (between groups) |
| `typography` | yes | `title`, `body`, `bodyReference`, `label`, `caption`, `metric`, `quote`, and optionally `section`: each `size` (points, 1 to 120), `bold` (true or false) and `colorRole` |
| `chart` | yes | `seriesRoles` (the colour roles of chart series, in order), and optionally `axisFontPt`, `dataLabelFontPt`, `gridRole` (the role of gridlines) and `barBaseline` |
| `table` | yes | `headerFillRole`, `headerTextRole`, and optionally `fontPt`, `paddingPt` and `rowHeightPt` |
| `icon` | yes | `size` in points and the `colorRole` icons are drawn in, and optionally `treatment` (as the icon library's usage names it) and `gapToLabel` in points |
| `image` | no | how pictures are framed: `frameRole`, `frameWidthPt`, `calloutRole`, `calloutFontPt`, and `fit` (`contain` or `cover`) |
| `fills` | no | `tints`: whether brand colours may be tinted for fills (false if not given) |

Take the title and content boxes from the title and body placeholders of that layout in
`layouts.json`, and the sizes from the brand's type styles. A template's measured size can
differ a little from a round one (959.76 points wide); give either, within a point of the
measured size.

`body` is the body text size for a deck that will be presented; `bodyReference` for one that
will be read.

## tokens.json

Written by `harness-brand pack tokens` from a Claude Design export, or by hand.

```json
{
  "schema": 1,
  "name": "Example Co",
  "themes": ["light", "dark"],
  "colors": [
    { "name": "white", "light": "#ffffff", "dark": "#1b1d36", "usage": "The slide background." },
    { "name": "mist", "light": "#e5eef3", "dark": "#074d73", "usage": "Panels and supporting cards." },
    { "name": "black", "light": "#000000", "dark": "#ffffff", "usage": "Body text." },
    { "name": "dark-gray", "light": "#53565a", "dark": "#bbbcbc", "usage": "Captions." },
    { "name": "blue", "light": "#005c8a", "dark": "#0088ef", "usage": "Titles and key marks." },
    { "name": "aqua", "light": "#007b8c", "dark": "#01b9c6", "usage": "The supporting accent." },
    { "name": "red", "light": "#c8102e", "usage": "Warnings." }
  ],
  "type": {
    "families": { "sans": "Arial, Helvetica, sans-serif" },
    "styles": [{ "name": "title", "group": "Titles", "fontSize": "36px", "lineHeight": "39px", "fontWeight": 400 }]
  },
  "spacing": [{ "name": "space-margin", "value": "48px" }],
  "radius": [{ "name": "radius-none", "value": "0" }]
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | `1` |
| `name` | yes | the design system's name |
| `themes` | yes | the themes it has, such as `light` and `dark` |
| `colors` | yes | each colour: `name`, `light` (its value in the light theme), `dark` (in the dark theme, when it differs), `usage` |
| `type` | no | `families` (font stacks by name) and `styles` (each with its `name`, `group` and values as the source gives them) |
| `spacing`, `radius` | no | each `name`, `value` and `usage` |
| `other` | no | any other groups of tokens, kept as the source gives them |
| `source` | no | where the tokens came from: the design system's `name` and `version`, and the `file` read |

A colour with no `dark` value has the same value in the dark theme; one with no `light`
value exists only in the dark theme. Values are `#rrggbb` wherever the source gives a plain
colour, else kept as given. Sizes in `tokens.json` are CSS pixels, as the source gives them;
sizes in `brand.json` are points. On a slide 960 pixels wide, one pixel is one point; on a
1280-pixel design, one pixel is 0.75 points.

## templates and layouts.json

`harness-brand pack measure` copies a template to `templates/<variant>.pptx` and writes what
it measures into `layouts.json`, under the variant. It measures the master the template's
visible slides use (or the one given with `--master`) and every layout of that master.
Sizes are in points.

```json
{
  "schema": 1,
  "variants": {
    "light": {
      "template": "templates/light.pptx",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "canvas": { "width": 960, "height": 540 },
      "master": "ppt/slideMasters/slideMaster1.xml",
      "chosenBy": "only",
      "masters": [{ "number": 1, "part": "ppt/slideMasters/slideMaster1.xml", "layouts": 2, "slides": 1 }],
      "theme": { "part": "ppt/theme/theme1.xml", "colors": { "dk1": "#000000", "lt1": "#ffffff" }, "fonts": { "major": "Arial", "minor": "Arial" } },
      "masterArtwork": [{ "id": "5", "kind": "sp", "bounds": [0, 0, 960, 6] }],
      "layouts": [
        {
          "id": "light-layout-001",
          "name": "Title Only",
          "part": "ppt/slideLayouts/slideLayout1.xml",
          "used": true,
          "slide": 1,
          "renderPage": 1,
          "placeholders": [{ "id": "2", "type": "title", "bounds": [48, 36, 864, 60], "size": 28, "bold": false, "font": "Arial", "color": { "scheme": "tx1", "hex": "#000000" } }],
          "artwork": [{ "id": "7", "kind": "pic", "bounds": [880, 500, 60, 24] }],
          "preview": "previews/light/light-layout-001.png",
          "relationship": "statement",
          "contentRange": { "maxWords": 35, "minItems": 1, "maxItems": 1 },
          "components": ["title", "body"],
          "searchTerms": ["one idea", "a key message"],
          "delivery": ["live", "reading"],
          "searchable": true
        }
      ],
      "slides": [{ "slide": 1, "hidden": false, "renderPage": 1, "layout": "light-layout-001" }]
    }
  }
}
```

What `pack measure` writes for a variant:

| Field | Meaning |
|---|---|
| `template`, `sha256` | the template file and its SHA-256 |
| `canvas` | the slide size |
| `master`, `chosenBy`, `masters` | the master measured; why it was chosen (`slides`: most visible slides use it, `only`: it is the only one, `first`: no visible slide decides, so the first, `option`: given with `--master`); and every master with its count of layouts and of visible slides |
| `theme` | the master's theme: its colours by name (`dk1`, `lt1`, `accent1` and so on) and its fonts |
| `masterArtwork` | the master's shapes that are not content placeholders |
| `layouts` | each layout of the master (below) |
| `slides` | each slide: its number, whether it is hidden, its page among the visible slides, its layout's id |

And for each layout:

| Field | Meaning |
|---|---|
| `id` | `<variant>-layout-<NNN>`, numbered in the master's order, and used to name its preview. Packs name layouts by `name`, which stays the same when a template is measured again |
| `name`, `rawName` | the layout's name tidied, and as written when that differs |
| `part`, `type` | where it is in the template, and its PowerPoint layout type when it has one |
| `used`, `slide`, `renderPage` | whether a visible slide uses it, and the first such slide and its page (`null` when none does) |
| `showsMasterArtwork` | `false` when the layout hides the master's shapes |
| `placeholders` | each content placeholder: `id`, `type`, `idx`, `bounds` (`[x, y, width, height]`), `rotation`, `flipH`, `flipV`, `inherited` (its frame comes from the master), and the text it shows: `size`, `bold`, `font`, `color` (its theme colour `scheme` if it has one, its `hex`, and `adjusted` when it is lightened, darkened or made see-through from that) |
| `artwork` | every other shape, including slide numbers, dates and footers: `id`, `kind`, `placeholder` (for those), `bounds`, `rotation`, `flipH`, `flipV` |
| `preview` | written by `pack previews`: the layout's picture |

What a person or an assistant adds to a layout, kept when the template is measured again:

| Field | Meaning |
|---|---|
| `relationship` | what the layout shows, in a word or two, such as `opening`, `statement`, `agenda`, `section`, `comparison`, `sequence`, `list`, `grid`, `metric`, `quote`, `image`, `chart`, `table`, `closing`, `thanks` |
| `contentRange` | `maxWords`, `minItems`, `maxItems`: how much the layout holds comfortably |
| `components` | the parts it is built from, such as `title`, `body`, `metric`, `icon`, `image` |
| `searchTerms` | phrases a request might use that this layout answers |
| `delivery` | `live`, `reading` or both: the decks it suits |
| `searchable` | `false` to keep the layout out of searches (it can still be named) |
| `notes` | anything more a slide builder should know |

## guide.md

The brand's rules in plain words, read by people and by the assistant that builds slides.
It has these sections, each a level-two heading:

- `## Brand rules`: what the brand always and never does, from its brand book.
- `## Voice and naming`: how the brand writes, and how its organisation and products are named.
- `## Slides` (for slides): how the brand's slides are built: recipes, and what to avoid.

Each rule says where it comes from (the brand book, a template, a guide), quoted where it
can be.

## directions.json

The deck directions a brand offers: ready-made choices of which colour leads and what
colours mean, from which a deck's look is picked.

```json
{
  "schema": 1,
  "house": ["Fill cards: a supporting card is a solid neutral box.", "Use one approved icon for each concrete idea."],
  "variants": {
    "light": {
      "default": "example-clear",
      "closing": {
        "withWords": { "layout": "Title Only", "title": true, "subtitles": 0, "use": "A closing whose words matter." }
      },
      "directions": [
        {
          "id": "example-clear",
          "name": "Clear",
          "useWhen": "Most decks: one product explained.",
          "direction": {
            "focal": "headingPrimary",
            "neutral": "canvasSecondary",
            "meanings": { "accentAqua": "Example Platform: the product this deck is about" },
            "motif": "A strip on each card says what it is about."
          },
          "layouts": { "cover": "Title Only", "section": "Title Only", "closing": "Title Only" }
        }
      ]
    }
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | `1` |
| `house` | yes | rules every deck follows, each a sentence |
| `variants` | yes | for each variant with slides: its directions (below) |

For each variant:

| Field | Required | Meaning |
|---|---|---|
| `default` | yes | the id of the direction used when none is chosen |
| `directions` | yes | the directions (below), at least one |
| `closing` | yes | `withWords` (a closing slide with a message) and optionally `thanks` (one that only thanks): each `layout` (a layout name from `layouts.json`), `title` (true or false), `subtitles` (how many), `use` |
| `reservedRoles` | no | colour roles a direction may not use as its focal colour or a meaning |
| `stripOnly` | no | `roles` that may only be used as a thin strip, and `why` |

For each direction:

| Field | Required | Meaning |
|---|---|---|
| `id`, `name` | yes | its id (unique in the pack) and its name, for people |
| `useWhen` | yes | when to choose it, in a sentence |
| `direction` | yes | `focal` (the role that leads), `neutral` (the role for supporting fills), `meanings` (roles that stand for one thing in a deck, each with what it stands for) and `motif` (the deck's recurring device, at most 1,000 characters) |
| `layouts` | yes | the layout names for `cover`, `section` and `closing`, and optionally `thanks`; a direction's `closing` and `thanks` take the place of the variant's `closing` layouts |
| `cues` | no | for a meaning's role, a list of words that mark a point as standing for that meaning; a role with cues must have a meaning |
| `keys` | no | for a meaning's role, the short name shown in a key (the words before the colon in the meaning, if not given) |

A layout is named by its `name` in `layouts.json`, which must be the name of exactly one
layout of the variant; if two layouts of a template share a name, rename one in the template.
In a contract, Harness Brand gives the layout's name as the template
writes it (its `rawName`, where that differs). A house rule may say `{brand}` for the
brand's name.

A direction's roles must be the variant's colour roles. `focal` and `neutral` differ,
`neutral` is not `canvasPrimary`, and `neutral` reaches 4.5 to 1 against `inkDeep`. A
meaning's role is neither the focal nor the neutral one, no two meanings share a colour, and
text on a focal or meaning colour can reach 4.5 to 1 in `onAccent`, `canvasPrimary` or
`inkDeep`.

## audit.json

The limits the brand check holds a deck to. Any field left out takes the value shown.

```json
{
  "schema": 1,
  "minTextPt": 18,
  "maxWords": 60,
  "textLedWords": 45,
  "overlapRatio": 0.1,
  "outOfBoundsInches": 0.02,
  "contrast": { "normal": 4.5, "large": 3 },
  "tolerances": { "titlePositionPt": 5, "fontPt": 1, "iconSizePt": 4 },
  "consistency": { "minimumSlides": 3, "majorityFraction": 0.6 },
  "starterText": ["click to add", "click to edit", "lorem ipsum"]
}
```

| Field | Meaning |
|---|---|
| `schema` | `1` (required) |
| `minTextPt` | the smallest size for main text; captions may go down to the caption size in `brand.json` |
| `maxWords` | the most words on a slide |
| `textLedWords` | words beyond which a slide with no picture, chart, table or diagram is flagged |
| `overlapRatio` | how much two text boxes may overlap, as a share of the smaller |
| `outOfBoundsInches` | how far a shape may stray past the slide's edge |
| `contrast` | the least contrast for `normal` text and for `large` text (18 points, or 14 bold) |
| `tolerances` | how far titles, text sizes and icon sizes may drift between slides before it is flagged |
| `consistency` | `minimumSlides` (how many slides of a kind before drift is checked) and `majorityFraction` (the share that sets what is normal) |
| `fonts` | the fonts allowed (the `sans` and `mono` fonts of `brand.json` if not given) |
| `starterText` | words that, left on a slide, block it: template text never replaced |

Every field but `schema` may be left out.

## assets, previews and compositions

`assets/` holds the logos `brand.json` names and any art the brand's rules call for,
copied from the sources. `previews/` is written by `pack previews`. `compositions/` holds
authored example slides when a brand has them: `compositions.pptx`, and
`compositions.json` in the shape of a variant in `layouts.json`.

## Making a pack

A pack is made in five steps, each a command but the review:

```bash
harness-brand pack tokens <export> --into brands/<id>/pack [--replace] [--json]
harness-brand pack measure <template.pptx> --variant V --into brands/<id>/pack [--master N] [--replace] [--json]
harness-brand pack previews brands/<id>/pack --variant V [--soffice PATH] [--pdftoppm PATH] [--pdfinfo PATH] [--json]
harness-brand pack scaffold brands/<id>/pack [--id ID] [--name NAME] [--icons ID,...] [--replace] [--json]
harness-brand pack check brands/<id>/pack [--json]
harness-brand pack seal brands/<id>/pack [--json]
```

- `pack tokens` reads a Claude Design export (a ZIP archive or a folder holding
  `tokens.json`, with the values `tokens.css` beside it gives each theme), or a
  `tokens.json` on its own, and writes the pack's `tokens.json`.
  Colours `tokens.css` names that `tokens.json` does not, such as `surface`, are added.
- `pack measure` copies the template and measures it into `layouts.json`. It measures the
  master most visible slides use and names the others it left out; `--master` chooses
  another by number or part. Measuring again keeps what was added to each layout (found by
  its name, which PowerPoint keeps when it renumbers layouts on saving, or by its part when
  two layouts share a name), and its preview while the template is unchanged. A layout that
  had something added and is no longer found is named, with what is lost.
- `pack previews` draws each layout that a visible slide uses, with LibreOffice (`soffice`)
  and Poppler (`pdftoppm`, and `pdfinfo` to check the pages). A layout no visible slide uses
  has no preview.
- `pack scaffold` drafts `brand.json`, `guide.md` and, for a pack with templates,
  `directions.json` and `audit.json`. It guesses each colour role from the colours' names
  (`surface`, `ink`, `title`, `on-accent`...), the slide boxes and type from the template's
  `Title Only` layout, and a variant's theme from its name (`dark` in it means dark). `--id`
  is the folder above the pack and `--name` the name `tokens.json` gives, unless given;
  `--icons` names the icon libraries the brand uses. The draft carries `draft` in
  `brand.json`, saying what is left to review.
- Then a person or an assistant reviews and finishes the draft against the brand's sources,
  following [references/building-a-pack.md](../references/building-a-pack.md), and removes
  `draft`.
- `pack check` names every problem with the pack, each in a sentence, and fails on any: a
  missing role or file, a colour that is not plain, too little contrast, a layout name that
  is not exactly one layout of the template, a template changed since it was measured, an
  icon library that is missing or does not pass, text `pack scaffold` left to be written (a
  line starting `Review:`), and anything changed, gone or added since the pack was sealed.
  Given an icon library's folder instead, it checks the library.
- `pack seal` writes `files`, `sources` and `brandSha256` into `brand.json` once `pack check`
  passes but for them, so that a later check sees anything changed, gone or added since.

Each refuses to replace what is there unless given `--replace` (`pack previews` always
draws afresh, and `pack seal` always seals afresh), and a command that is refused writes
nothing.
