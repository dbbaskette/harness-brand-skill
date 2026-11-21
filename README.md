# Harness Brand

Use your organization's branding with Claude Code, Codex, and compatible studios.
Harness Brand reads local **brand packs** to supply colors, fonts, templates, icons
and writing guidance for slides, blogs and infographics. It also rebrands existing
Google Slides and Docs while preserving their business content.

The public project contains the tools. **You provide the brands** in a separate
folder, which can stay private. No Broadcom account, private repository or Marketing
Studio installation is required.

## Install

You need Node.js 20 or newer and Git. Harness Brand is installed from the `main` branch
of this repository: there are no release tags to choose between, and `main` is always the
version to use. Clone it and run the installer inside the clone:

```sh
git clone --branch main https://github.com/dbbaskette/harness-brand-skill.git
cd harness-brand-skill
node scripts/install-mac.mjs
```

To update, pull `main` and install again. The installer checks the new copy before
anything uses it:

```sh
git pull
node scripts/install-mac.mjs --yes
```

The installer confirms installation for Claude Code and Codex, then asks for your
brands folder if one is not already configured. Paste the **parent folder containing
all your brands**, or press Enter to configure it later. Upgrades keep the configured
folder. Restart your agent session after installation.

To choose a folder explicitly, including during an unattended installation:

```sh
node scripts/install-mac.mjs --yes --data "$HOME/Projects/my-brands"
```

`--data` replaces the saved folder choice. `--yes` never prompts; with no configured
folder it installs the tool and explains how to add brands later. Add `--dry-run` to
preview without changing anything.

When the folder includes rebranding profiles, the installer also sets up one private
Python 3.11+ environment and verified local asset snapshots. Use `--rebrand skip`
for authoring-only setup. No Google login is started by installation.

Harness Slides is installed separately, from the `main` branch of
[its own repository](https://github.com/dbbaskette/harness-slides-skill), and is currently
required for contract export (including blog contracts), look samples and slide guidance.
Harness Brand uses whichever one is installed, provided it is 0.15.1 or newer. Brand
listing, pack preparation and validation do not require it.

### One installed copy, one address

The installer keeps Harness Brand in `~/Library/Application Support/Harness Brand` on a
Mac (`~/.local/share/harness-brand` on Linux): one copy in a folder under `versions/`, and
`current`, a link to it. The skills folders of Claude Code, Codex and `~/.agents` link to
`current`, and so does every brand shortcut.

Each install replaces the copy before it. Once `current` points at the new copy, every
other folder in `versions/` is removed, and any skill link that led into one is moved onto
`current`. A link or folder in a skills folder that is not Harness Brand's is left as it
is and named in what the installer prints, as is a folder it could not remove.

Nothing names a version folder. The commands in an exported contract, the commands and
paths `guidance` returns, `doctor` and `rebrand status` all give
`…/Harness Brand/current/…`, so they keep working after an update and run the new code.
Work saved before an update carries on after it: a contract still checks against its
brand pack, a look sampled earlier can still be chosen, and a deck's guidance task
resumes on whatever is installed. When Harness Slides was updated since a deck was
started, `guidance resume` passes on the one-line `notice` it gives.

Rebranding's Python environment, brand snapshots and shortcuts belong to the installed
copy, so each install sets them up again. If one did not (`--rebrand skip`, or no network
for Python packages), the rebranding commands refuse and name the one command to run:
`node "…/Harness Brand/current/scripts/harness-brand.mjs" rebrand setup`.

## Your brands folder

The folder can be anywhere on your computer. It does not need to be a Git repository.
Each brand has its own prepared pack; icon libraries can be shared:

```text
my-brands/
├── company/
│   ├── pack/                 Brand settings, rules, templates and assets
│   │   ├── brand.json
│   │   └── ...
│   └── sources/              Original brand materials (optional at runtime)
├── product/
│   └── pack/
└── icon-libraries/
    └── company-icons/        Shared library, when referenced by a pack
```

A folder of logos or templates alone is not a ready-to-use pack. Ask the agent to
prepare a brand pack from your source materials using
[the pack-building guide](references/building-a-pack.md). The
[brand-pack format](docs/brand-pack-format.md) and
[icon-library format](docs/icon-library-format.md) describe the required files.
The installer checks that the selected folder contains at least one usable pack.

**Broadcom example:** if you have authorized access to a local `broadcom-brands`
checkout, select that checkout's root. Its Tanzu, VMware, Broadcom and TrueSource
folders follow the same structure; they are not built into Harness Brand.

```sh
node scripts/install-mac.mjs --data "$HOME/Projects/broadcom-brands"
```

The installer remembers a path; it does not copy, publish, fetch or change your
brand assets. If your folder is a Git checkout, you manage updates with Git.
Changes to that folder become available to subsequent commands; previously exported
contracts should be checked before reuse.

## Use it

Tell your agent, for example: “Use Harness Brand and our Company brand to create a
presentation.” It uses the selected pack and Harness Slides for deck creation.
Choose the brand explicitly, or let the agent ask when the choice is missing.

Run these commands from the skill folder:

| Command | Purpose |
|---|---|
| `node scripts/harness-brand.mjs brands` | List usable brands and variants |
| `node scripts/harness-brand.mjs data` | Show the active brands folder |
| `node scripts/harness-brand.mjs data --set "/path/to/my-brands"` | Change the saved folder |
| `node scripts/harness-brand.mjs doctor` | Check available tools and brand packs |
| `node scripts/harness-brand.mjs --help` | List all commands |

Folder selection, in order: command `--data`, `HARNESS_BRAND_DATA`, the saved folder,
then the default local brands folder. An environment variable overrides the saved
choice; unset it when you want to use that choice. Marketing Studio can supply its
selected folder through this variable.

For a managed copy instead of a pointer, `data --install FOLDER` copies brands into
`~/Library/Application Support/Harness Brand/brands` on macOS. It does not override
another configured folder. Linux uses `~/.local/share/harness-brand/brands`.

## Document templates

A pack can also hold Word templates for documents such as a solution brief or a white
paper, listed under `documents` in `brand.json` and stored in `templates/documents/`:

```sh
node scripts/harness-brand.mjs documents --brand company
```

It prints each template, what it is for and the file to start from. Harness Brand does
not write the document: open the template in Word, or hand its path to the tool that will.

## Existing decks and documents

One shared worker handles content-preserving rebranding. The selected brand supplies
its rules, template and review criteria through a `rebrand/` profile next to `pack/`.
See [the workflow](references/rebranding.md) and [profile format](docs/rebranding-profile-format.md).

```sh
node scripts/harness-brand.mjs rebrand run 'GOOGLE_FILE_URL' --brand company --review
node scripts/harness-brand.mjs rebrand status --brand company
```

To put a document into one of the brand's document templates (a white paper, a
solution brief) instead of restyling it in place, name the template. The source can be a
Google Doc or a local `.docx`; ask for a Word file, a Google Doc, or both:

```sh
node scripts/harness-brand.mjs rebrand run 'GOOGLE_DOC_URL' --brand company --document white-paper-tech --output both
```

The source is only read. The result is named `<source>-<brand>-branded`. Its words go into the template's styles behind the template's
cover, headers, footers and back page. The Word file is the faithful output; Google Docs
keeps the words, styles, tables and pictures but can drop page furniture such as a footer logo.

Use your existing gcloud login with Drive access. If needed, run
`gcloud auth login --enable-gdrive-access --force`. No Cloud project or gws setup
is required. Local visual review needs LibreOffice and Poppler. Material Icons conversion on
macOS also needs FriBiDi (`brew install fribidi`); setup reports when it is missing. The reviewer uses
the calling Codex or Claude Code login with authorization for that document.

Brand-specific shortcuts can be installed from a profile. They all call the same
worker: no separate brand repositories or formatting engines are needed. To replace
old brand-skill symlinks during migration:

```sh
node scripts/install-mac.mjs --yes --data "$HOME/Projects/broadcom-brands" --replace-brand-shortcuts
```

The example data currently provides focused rebranding for Tanzu, Broadcom and
TrueSource. VMware remains available for authoring; its focused rebranding profile
has not been validated. The older `apply-brand` implementation remains in the private archived history;
it is not part of this public project.

Rebranding works from a verified snapshot of each brand profile, taken by
`rebrand setup` (which each install runs). After reviewing changes in your brands folder,
run `rebrand setup` to adopt them. Jobs never silently fetch new branding. A run given no
`--run-dir` keeps its report and files in `rebrand-runs/` beside `current`, where an
update leaves them.

## Development

[SKILL.md](SKILL.md) contains the agent instructions. Run `npm test` and `python3 -m unittest discover -s rebrand/tests -v` for the public
suites (the second with the Python that has the worker's packages, such as
`rebrand/.venv/bin/python3` after `rebrand setup`). Changes are merged to `main`, which is
what people install; raise `version` in `package.json` with each change others rely on, so
a floor such as "1.4.0 or newer" can be checked. `node scripts/package.mjs` writes the
checkout as one ZIP with its checksum, for a computer that cannot clone the repository.
