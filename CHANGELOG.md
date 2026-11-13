# Changelog

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
