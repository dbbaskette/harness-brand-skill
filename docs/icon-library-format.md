# Icon library format

An icon library is a set of icons kept once, in the brands folder, for any brand to use.
Harness Brand reads it. It can be made with `harness-brand pack icons`, by hand, or with
any tool that writes the files below.

## Where a library lives

```
brands/
  icon-libraries/            reserved by Harness Brand, never a brand id
    <id>/
      sources/               what the library was made from, kept by you as received (optional)
      library.zip            the library
      contact-sheet.svg      every icon on one page, for review (optional)
```

`<id>` is lower-case letters, digits and hyphens, starting with a letter or digit, and is
the same as the `id` inside the library.

## library.zip

A ZIP archive holding:

| Path | Required | What it is |
|---|---|---|
| `library.json` | yes | what the library is |
| `icons.json` | yes | every icon |
| `svg/<folder>/<file>.svg` | for pictures | the drawings |

Both JSON files are JSON objects.

### library.json

```json
{
  "schema": 1,
  "id": "functional-icons",
  "name": "VMware by Broadcom functional icons",
  "version": "2025-07",
  "kind": "glyph",
  "source": "VMware by Broadcom Functional Icons library, July 2025",
  "usage": "Colour only with the brand's icon colours. Never outline, shadow, distort or mix sizes in a row."
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | `1` |
| `id` | yes | the folder's name |
| `name` | yes | the library's name, for people, not empty |
| `version` | yes | text in quotes, not empty, in any scheme, such as `"2025-07"` or `"1.2"` |
| `kind` | yes | `"glyph"` or `"picture"` (below) |
| `source` | no | where the icons came from |
| `usage` | no | the library's rules, in plain words, shown wherever its icons are chosen |

**glyph**: every icon is a single-colour shape. A brand colours it with one of its own
colours, and slides place it as a native, editable shape.

**picture**: every icon is a drawing kept in its own colours, such as a product logo or a
partner's architecture icon. It is placed as a picture and never recoloured.

### icons.json

`icons.json` holds `"schema": 1` and an `icons` list with at least one icon. A glyph
library's icons look like this:

```json
{
  "schema": 1,
  "icons": [
    {
      "slug": "cloud-1",
      "name": "Cloud 1",
      "category": "Cloud",
      "keywords": ["hybrid", "multi-cloud"],
      "bounds": [12.5, 22, 87.5, 78],
      "paths": ["M12.5 50 L50 22 L87.5 50 L50 78 Z"]
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `slug` | yes | the icon's id: lower-case letters, digits and hyphens, starting with a letter or digit, used by no other icon in the library |
| `name` | yes | the icon's name, for people, not empty |
| `category` | yes | its group, not empty, such as `Cloud` or `Business Tools / Objects` |
| `keywords` | no | a list of more words to find it by |
| `bounds` | glyphs | `[x0, y0, x1, y1]`: the box around the shape, four numbers each from -1 to 101, with x0 smaller than x1 and y0 smaller than y1 |
| `paths` | glyphs | the shape: a list of one or more outlines, each written as SVG path data in a box from 0 to 100 |
| `file` | pictures | where the drawing is in the archive (below) |

How a glyph's paths are painted: each path is one outline, filled "even-odd", which means
an outline drawn inside another cuts a hole in it (the middle of a ring, the window of a
building). All of a glyph's paths are filled in the same colour, so where two paths
overlap they add up rather than cut holes in each other. A path holds no colour and no
background circle.

A picture library's icons give `file` in place of `bounds` and `paths`:

```json
{
  "schema": 1,
  "icons": [
    { "slug": "spring", "name": "Spring", "category": "Logos", "file": "svg/logos/spring.svg" }
  ]
}
```

with a `library.json` that says so:

```json
{ "schema": 1, "id": "product-logos", "name": "Product logos", "version": "1", "kind": "picture" }
```

`file` is `svg/`, then a folder, then `/`, then a file name ending `.svg`. The folder and
the file name use lower-case letters, digits and hyphens, and the file name starts with a
letter or digit. They need not match the icon's category or slug, though `pack icons`
names them that way. The file must be in the archive. A drawing is refused if it holds a
`<script>` or `<foreignObject>` element, an event attribute such as `onclick=`, or the
text `javascript:`.

## Making a library with Harness Brand

```bash
harness-brand pack icons <source>... --library ID --name NAME --into brands/icon-libraries/ID \
  [--kind glyph|picture] [--fill F] [--fill-for SOURCE=F]... [--version V] [--usage TEXT] [--source TEXT] \
  [--replace] [--json]
```

`--library`, `--name` and `--into` are required, and the `--into` folder must be named for
the library. `--kind` is `glyph` unless given, `--version` is `1`, and `--fill` is 1. If the
folder already has a library.zip, the command refuses unless `--replace` is given. `--json`
prints the result as JSON. `--source` and `--usage` fill in those fields of library.json;
without them, `source` lists the sources' names and `usage` takes an index's `note`. A build that is refused writes nothing and leaves an existing
library as it was. The command also writes `contact-sheet.svg` beside the library.

### Sources

A source is a Claude Design export ZIP, a folder or ZIP of SVG files, a single SVG file, or
a file named `icons.json` (on its own, or in a folder or ZIP). Hidden files, macOS
`__MACOSX` folders and links are left out. A PowerPoint or other Office file is not a source.

- **An icons.json.** The shallowest `icons.json` whose icons have `paths` (or one `d`
  each, as Broadcom's export writes them, which is read as a list of one path) is the
  source's index, and its SVG files are then not read. If it gives a `viewBox`, that must be
  `0 0 100 100`, otherwise the build is refused. Its `note`, if any, becomes the library's `usage` unless `--usage` is
  given. A picture library does not take an index.
- **SVG files.** In a source with folders named `Functional ...` or `Icons ...`, only those
  folders' SVGs are read. An icon's category is its own folder's name, without a leading
  `Functional ` or `Icons ` (`General` for a file in no folder). Its name comes from its
  row in that folder's `README.md`, a table row such as `| cloud-1.svg | Cloud 1 |`, else
  from its file name. Its slug comes from its file name.

With several sources, the first one's icons win where slugs meet, and later sources add the
icons the first lacks. Their categories are matched to the first source's where they
plainly mean the same, so `Apps` joins `Apps & Software`. Ligatures and similar forms are
written out in names and slugs, so the slug `certi-ed` from the name "certiﬁed" becomes
`certified`. Within one source, a slug used twice for two different drawings is kept for
the first, and the second gets a slug from its name (in an index) or a number (`-2`, `-3`,
for SVG files).

### How an SVG becomes a glyph

- Each `path`, `rect`, `circle`, `ellipse`, `polygon` and `polyline` is taken, with its
  transforms, as one path of the glyph. An exact repeat is dropped.
- Shapes that are hidden, or filled with no colour or a fully transparent one, are left
  out. A drawing made only of lines, with no filled shapes, cannot be a glyph.
- A shape drawn through a mask takes the mask's shapes as the glyph. A mask that cuts holes
  with black shapes cannot be held, and the icon is left out.
- A shape at least 95% of the view box wide and high, in a colour no other shape uses, is
  a container (such as a background circle) and is dropped, as long as something else is
  left to draw.
- A drawing that uses `<use>`, a clip path, a style sheet or a drawing inside another, that
  has no view box or size in pixels, or that cannot be read, is left out rather than drawn
  wrongly.
- The view box is scaled to fill `F` of the 0 to 100 box, centred: 1 unless `--fill` or
  `--fill-for` says otherwise. Use the share the library's own notes give: if they say the
  icons fill 88% of their circle, give 0.88. `--fill-for` gives a share for one source,
  named by its file or folder name, and a name that matches no source is refused. Two sources may not have the same name. An
  index is already in the 0 to 100 box and is not scaled.

Every icon left out is listed with why, and one icon that cannot be used, such as a
picture with a script in it, never stops the build. A build that finds no icons at all is
refused whole.

## Checking a library

```bash
harness-brand pack check brands/icon-libraries/ID [--json]
```

checks a library against this format and lists each problem in a sentence.
