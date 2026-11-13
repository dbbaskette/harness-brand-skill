# Vendored fonts

## MaterialIcons-Regular.ttf

- Family: Material Icons (Regular), by Google.
- Source: https://github.com/google/material-design-icons, `font/MaterialIcons-Regular.ttf`
  (downloaded 11 November 2026).
- Licence: Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0
- SHA-256: `ef149f08bdd2ff09a4e2c8573476b7b0f3fbb15b623954ade59899e7175bedda`

Used only by `rebrand/scripts/round_trip.py` to draw an icon that a source deck sets in this font, so
the icon can be uploaded as a picture. Google's importer does not keep icon fonts: it replaces
`Material Icons` with the text font `Mate`, and each icon would otherwise appear as its name in
serif text. The font is never embedded in a deck and is not brand data.

The Apache License 2.0 text is included in [LICENSE](LICENSE).
