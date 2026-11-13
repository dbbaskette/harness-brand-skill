#!/usr/bin/env python3
"""Render decks to PNGs for visual review (LibreOffice + pdftoppm).

  render.py DECK.pptx [--out DIR]                 one PNG per slide + contact sheet
  render.py BEFORE.pptx AFTER.pptx [--out DIR]    side-by-side before/after sheets

Prints JSON with the files written. Needs LibreOffice (soffice) and poppler (pdftoppm);
Pillow is used for the sheets when available.
"""
import glob, json, os, shutil, subprocess, sys, tempfile

from pathlib import Path
venv=Path(__file__).resolve().parents[1]/".venv/bin/python3"
if venv.exists() and Path(sys.prefix).resolve()!=venv.parent.parent.resolve():
    os.execv(str(venv),[str(venv),__file__,*sys.argv[1:]])

def find(cmd, extra=()):
    p = shutil.which(cmd)
    if p:
        return p
    for e in extra:
        if os.path.exists(e):
            return e
    return None

SOFFICE = find("soffice", ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/lib/libreoffice/program/soffice",
                            "C:/Program Files/LibreOffice/program/soffice.exe"])
PDFTOPPM = find("pdftoppm", ["/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"])

def unhide(deck, tmp):
    """LibreOffice skips hidden slides, which would shift before/after numbering and leave them
    unreviewed: render a copy with every slide shown (same file name, so PNG names match)."""
    if not str(deck).lower().endswith(".pptx"):
        return deck
    try:
        from pptx import Presentation
    except ImportError:
        return deck
    prs = Presentation(deck)
    hidden = [s for s in prs.slides if s._element.get("show") == "0"]
    if not hidden:
        return deck
    for s in hidden:
        del s._element.attrib["show"]
    os.makedirs(os.path.join(tmp, "src"), exist_ok=True)
    copy = os.path.join(tmp, "src", os.path.basename(deck))
    prs.save(copy)
    print(f"note: rendered {len(hidden)} hidden slide(s) of {os.path.basename(deck)} too", file=sys.stderr)
    return copy

def render(deck, out, width=1280, pages=None):
    if not SOFFICE:
        sys.exit("LibreOffice not found (brew install --cask libreoffice). Without it, open the output in PowerPoint and review by eye.")
    os.makedirs(out, exist_ok=True)
    stem = os.path.splitext(os.path.basename(deck))[0]
    with tempfile.TemporaryDirectory() as tmp:
        deck = unhide(deck, tmp)
        prof = "file://" + os.path.join(tmp, "profile")
        r = subprocess.run([SOFFICE, f"-env:UserInstallation={prof}", "--headless", "--convert-to", "pdf", "--outdir", tmp, deck],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=300)
        pdf = os.path.join(tmp, stem + ".pdf")
        if r.returncode != 0 or not os.path.exists(pdf):
            log = "\n".join(l for l in (r.stdout or "").splitlines() if "Fontconfig" not in l).strip()
            sys.exit(f"LibreOffice could not convert {deck} (exit {r.returncode}).\n{log}\n"
                     "If this runs inside an agent sandbox (Claude Code or Codex on macOS), LibreOffice cannot "
                     "start there: re-run this render command outside the sandbox.")
        if PDFTOPPM:
            ranges=[[]] if not pages else [["-f",str(n),"-l",str(n)] for n in sorted(set(pages))]
            for selection in ranges:
                subprocess.run([PDFTOPPM, *selection, "-png", "-scale-to-x", str(width), "-scale-to-y", "-1", pdf, os.path.join(out, stem)], check=True, stderr=subprocess.DEVNULL)
        else:
            try:
                import fitz  # PyMuPDF fallback
            except ImportError:
                sys.exit("Need pdftoppm (brew install poppler) or PyMuPDF to rasterise slides")
            doc = fitz.open(pdf)
            for i, pg in enumerate(doc, 1):
                if pages and i not in pages:continue
                pg.get_pixmap(matrix=fitz.Matrix(width / pg.rect.width, width / pg.rect.width)).save(os.path.join(out, f"{stem}-{i:02d}.png"))
    return sorted(glob.glob(os.path.join(out, stem + "-*.png")))

def sheet(images, path, cols=3, labels=None):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return None
    ims = [Image.open(p).convert("RGB") for p in images]
    w = 480
    th = [im.resize((w, int(im.height * w / im.width))) for im in ims]
    h = max(t.height for t in th) + 22
    rows = (len(th) + cols - 1) // cols
    S = Image.new("RGB", (cols * (w + 10) + 10, rows * (h + 10) + 10), "#9a9a9a")
    d = ImageDraw.Draw(S)
    for i, t in enumerate(th):
        x, y = 10 + (i % cols) * (w + 10), 10 + (i // cols) * (h + 10)
        S.paste(t, (x, y + 22))
        d.text((x + 2, y + 4), labels[i] if labels else os.path.basename(images[i]), fill="black")
    S.save(path)
    return path

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "renders"
    if out in args:
        args.remove(out)
    if len(args) == 1:
        pngs = render(args[0], out)
        sh = sheet(pngs, os.path.join(out, "sheet.png"), 3)
        print(json.dumps({"slides": pngs, "sheet": sh}, indent=1))
    elif len(args) == 2:
        a = render(args[0], os.path.join(out, "before"))
        b = render(args[1], os.path.join(out, "after"))
        pairs, sheets = [], []
        for i in range(max(len(a), len(b))):
            pairs += [a[i] if i < len(a) else a[-1], b[i] if i < len(b) else b[-1]]
        for k in range(0, len(pairs), 8):
            chunk = pairs[k:k + 8]
            labels = [f"slide {k // 2 + j // 2 + 1} {'before' if j % 2 == 0 else 'after'}" for j in range(len(chunk))]
            sheets.append(sheet(chunk, os.path.join(out, f"compare-{k // 8 + 1}.png"), 2, labels))
        print(json.dumps({"before": a, "after": b, "compare_sheets": sheets}, indent=1))
    else:
        sys.exit(__doc__)

if __name__ == "__main__":
    main()
