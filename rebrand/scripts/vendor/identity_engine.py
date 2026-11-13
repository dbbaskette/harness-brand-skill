#!/usr/bin/env python3
"""Shared OOXML identity primitives. Use the Harness Brand rebrand command, not this module as a standalone CLI."""
import argparse, colorsys, copy, hashlib, io, json, math, os, re, sys, uuid
from collections import Counter, defaultdict

from lxml import etree
from pptx import Presentation
from pptx.util import Emu, Pt

HERE = os.path.dirname(os.path.abspath(__file__))

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
}
A = "{%s}" % NS["a"]
P = "{%s}" % NS["p"]
R = "{%s}" % NS["r"]
CT = {
    "slide": "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
    "layout": "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
    "master": "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
    "theme": "application/vnd.openxmlformats-officedocument.theme+xml",
    "chart": "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    "dgmData": "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml",
    "dgmDrawing": "application/vnd.ms-office.drawingml.diagramDrawing+xml",
    "notes": "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
}
CHROME_PREFIX = "brand:"
MONO = re.compile(r"mono|consolas|courier|menlo|monaco|code|inconsolata|fira|jetbrains|lucida console|andale|hack|cascadia", re.I)
SYMBOL = re.compile(r"wingdings|webdings|symbol|marlett|segoe ui (emoji|symbol)|apple color emoji|noto color emoji|font awesome|material", re.I)
CJK = re.compile(r"gothic|mincho|sim|ming|malgun|batang|gulim|dotum|meiryo|yu |hei|song|kai|pmingliu|mangal|nirmala|leelawadee|[^\x00-\x7f]", re.I)
ROUNDED = {"roundRect", "round1Rect", "round2SameRect", "round2DiagRect", "snipRoundRect", "flowChartAlternateProcess"}
FOOTER_PH = {"dt", "ftr", "sldNum"}
TITLE_PH = {"title", "ctrTitle"}
PRST = {"black": "000000", "white": "ffffff", "red": "ff0000", "green": "008000", "blue": "0000ff", "yellow": "ffff00",
        "gray": "808080", "grey": "808080", "orange": "ffa500", "purple": "800080", "navy": "000080", "darkBlue": "00008b",
        "darkGray": "a9a9a9", "lightGray": "d3d3d3", "silver": "c0c0c0", "teal": "008080", "maroon": "800000"}

# ----------------------------------------------------------------- colour maths
def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

def rgb2hex(c):
    return "%02X%02X%02X" % tuple(max(0, min(255, round(v * 255))) for v in c)

def _lin(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

def luminance(h):
    r, g, b = (_lin(v) for v in hex2rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a, b):
    x, y = sorted((luminance(a), luminance(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)

def lab(h):
    r, g, b = (_lin(v) for v in hex2rgb(h))
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)

def chroma(h):
    _, a, b = lab(h)
    return math.hypot(a, b)

class ColorMapper:
    """Map any colour to the nearest brand colour, keeping neutrals neutral."""
    def __init__(self, palette):
        self.pal = {k: v.lower().lstrip("#") for k, v in palette.items()}
        self.labs = {k: lab(v) for k, v in self.pal.items()}
        self.cache = {}

    def nearest(self, h, names=None):
        h = h.lower().lstrip("#")
        key = (h, tuple(names) if names else None)
        if key in self.cache:
            return self.cache[key]
        cands = [n for n in (names or self.pal) if n in self.pal]
        L, a, b = lab(h)
        neutral = math.hypot(a, b) < 10
        best, bd = None, 1e9
        for n in cands:
            l2, a2, b2 = self.labs[n]
            c2 = math.hypot(a2, b2)
            if neutral and c2 >= 12:
                continue          # never turn a grey into a hue
            if not neutral and c2 < 12 and math.hypot(a, b) > 22:
                continue          # never turn a clear hue into a grey
            d = math.sqrt(0.6 * (L - l2) ** 2 + (a - a2) ** 2 + (b - b2) ** 2)
            if not neutral and c2 >= 12:
                # keep the hue family: Lab alone can rate navy as close to purple as to blue
                dh = abs(colorsys.rgb_to_hsv(*hex2rgb(h))[0] - colorsys.rgb_to_hsv(*hex2rgb(self.pal[n]))[0]) * 360
                d += 0.8 * min(dh, 360 - dh)
            if d < bd:
                best, bd = n, d
        if best is None:
            best = min(cands, key=lambda n: sum((p - q) ** 2 for p, q in zip(lab(h), self.labs[n])))
        self.cache[key] = (best, self.pal[best])
        return self.cache[key]

# ----------------------------------------------------------------- brand loading
# ----------------------------------------------------------------- xml helpers
def parts(prs):
    for part in prs.part.package.iter_parts():
        yield part

def xml_of(part):
    """Return (root, writer) for any XML part, XmlPart or blob part."""
    if hasattr(part, "_element"):
        return part._element, (lambda: None)
    root = etree.fromstring(part.blob)
    def write():
        part._blob = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    return root, write

def kind_of(part):
    for k, v in CT.items():
        if part.content_type == v:
            return k
    return None

def ph_type(sp):
    ph = sp.find(f"{P}nvSpPr/{P}nvPr/{P}ph")
    if ph is None:
        ph = sp.find(f".//{P}nvPr/{P}ph")
    if ph is None:
        return None
    return ph.get("type", "body")

def shape_name(el):
    c = el.find(f".//{P}cNvPr")
    return c.get("name", "") if c is not None else ""

def text_of(el):
    """Shape text: runs joined as written, paragraphs separated by a space."""
    paras = ["".join(t.text or "" for t in p.iter(f"{A}t")) for p in el.iter(f"{A}p")]
    return " ".join(x.strip() for x in paras if x.strip()).strip()

def run_props(body):
    """Yield the rPr of every text run and field in a txBody, creating it when missing."""
    for r_ in list(body.iter(f"{A}r", f"{A}fld")):
        t = r_.find(f"{A}t")
        if t is None or not (t.text or "").strip():
            continue
        rpr = r_.find(f"{A}rPr")
        if rpr is None:
            rpr = etree.Element(f"{A}rPr", lang="en-US")
            r_.insert(0, rpr)
        yield rpr

FILL_TAGS = ("noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill")

def set_fill(parent, hex_, before=()):
    for t in FILL_TAGS:
        for f in parent.findall(f"{A}{t}"):
            parent.remove(f)
    sf = solid(hex_)
    for i, c in enumerate(parent):
        if etree.QName(c).localname in before:
            parent.insert(i, sf)
            return sf
    parent.append(sf)
    return sf

def solid(hex_):
    sf = etree.Element(f"{A}solidFill")
    etree.SubElement(sf, f"{A}srgbClr", val=hex_.lstrip("#").upper())
    return sf

def grad_xml(g):
    gf = etree.Element(f"{A}gradFill", rotWithShape="1")
    gl = etree.SubElement(gf, f"{A}gsLst")
    for pos, col in g["stops"]:
        gs = etree.SubElement(gl, f"{A}gs", pos=str(int(round(pos * 100000))))
        etree.SubElement(gs, f"{A}srgbClr", val=col.lstrip("#").upper())
    etree.SubElement(gf, f"{A}lin", ang=str(int(round(g.get("angle", 0) % 360 * 60000))), scaled="0")
    return gf

def avg_color(g):
    cs = [hex2rgb(c) for _, c in g["stops"]]
    return rgb2hex(tuple(sum(v) / len(cs) for v in zip(*cs)))

def bg_color(bg):
    if "solid" in bg:
        return bg["solid"].lstrip("#")
    if "gradient" in bg:
        return avg_color(bg["gradient"])
    return "FFFFFF"

# ----------------------------------------------------------------- inspection
def xfrm_box(el):
    """(x, y, w, h) from a shape's own transform, or None when it inherits its position.
    Never searches descendants: a:ext also names extension-list entries, which have no size."""
    for path in (f"{P}spPr/{A}xfrm", f"{P}grpSpPr/{A}xfrm", f"{P}xfrm"):
        x = el.find(path)
        if x is not None:
            off, ext = x.find(f"{A}off"), x.find(f"{A}ext")
            if off is not None and ext is not None and ext.get("cx") is not None:
                bx, by, bw, bh = int(off.get("x")), int(off.get("y")), int(ext.get("cx")), int(ext.get("cy"))
                rot = (int(x.get("rot", "0")) / 60000) % 180
                if 45 < rot < 135:  # turned on its side: it covers a box h wide and w tall, same centre
                    cx, cy = bx + bw / 2, by + bh / 2
                    bx, by, bw, bh = int(cx - bh / 2), int(cy - bw / 2), bh, bw
                return bx, by, bw, bh
            return None
    return None

LEGAL = re.compile(r"©|\(c\)|copyright|confidential|proprietary|rights reserved|internal use|do not distribute", re.I)

def scheme_of(spec):
    """Theme colour names (incl. tx1/bg1/tx2/bg2 through the clrMap) -> hex for a brand variant."""
    th = spec["theme"]
    dark = spec.get("dark")
    s = {k: v.lower() for k, v in th.items()}
    s.update({"tx1": th["lt1" if dark else "dk1"].lower(), "bg1": th["dk1" if dark else "lt1"].lower(),
              "tx2": th["lt2" if dark else "dk2"].lower(), "bg2": th["dk2" if dark else "lt2"].lower(),
              "phClr": th["dk1"].lower()})
    return s

def resolve_color(c, scheme):
    """(hex, alpha) for a DrawingML colour element, applying lumMod/lumOff/tint/shade/alpha."""
    tag = etree.QName(c).localname
    if tag == "srgbClr":
        h = c.get("val")
    elif tag == "schemeClr":
        h = scheme.get(c.get("val"))
    elif tag == "prstClr":
        h = PRST.get(c.get("val"))
    elif tag == "sysClr":
        h = c.get("lastClr")
    elif tag == "scrgbClr":
        h = rgb2hex(tuple(int(c.get(k, "0")) / 100000 for k in ("r", "g", "b")))
    else:
        h = None
    if not h:
        return None, 1.0
    rgb, alpha = list(hex2rgb(h)), 1.0
    for m in c:
        n, v = etree.QName(m).localname, int(m.get("val", "100000")) / 100000
        if n in ("lumMod", "lumOff"):
            hh, l, s = colorsys.rgb_to_hls(*rgb)
            l = min(1, max(0, l * v if n == "lumMod" else l + v))
            rgb = list(colorsys.hls_to_rgb(hh, l, s))
        elif n == "shade":
            rgb = [x * v for x in rgb]
        elif n == "tint":
            rgb = [1 - (1 - x) * v for x in rgb]
        elif n == "alpha":
            alpha = v
    return rgb2hex(tuple(rgb)).lower(), alpha

def grad_at(f, scheme, at=None, box=None):
    """Colour of a gradFill at point `at` inside `box` (linear gradients), else the stop average."""
    stops = []
    for gs in f.iter(f"{A}gs"):
        if len(gs):
            h, a = resolve_color(gs[0], scheme)
            if h and a >= 0.5:
                stops.append((int(gs.get("pos", "0")) / 100000, h))
    if not stops:
        return None
    lin = f.find(f"{A}lin")
    if at is None or box is None or lin is None or len(stops) == 1 or not box[2] or not box[3]:
        return avg_color({"stops": [[0, "#" + h] for _, h in stops]}).lower()
    ang = math.radians(int(lin.get("ang", "0")) / 60000)
    dx, dy = math.cos(ang), math.sin(ang)
    span = abs(box[2] * dx) + abs(box[3] * dy) or 1
    t = ((at[0] - (box[0] + box[2] / 2)) * dx + (at[1] - (box[1] + box[3] / 2)) * dy) / span + 0.5
    t = min(1, max(0, t))
    stops.sort()
    if t <= stops[0][0]:
        return stops[0][1]
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if p0 <= t <= p1:
            k = (t - p0) / (p1 - p0) if p1 > p0 else 0
            return rgb2hex(tuple(x + (y - x) * k for x, y in zip(hex2rgb(c0), hex2rgb(c1)))).lower()
    return stops[-1][1]

def fill_of(el, scheme, at=None, box=None):
    """('color', hex) | ('unknown', None) for picture/pattern fills | ('none', None) if see-through.
    For gradients, the colour at point `at` when the shape's `box` is given."""
    if el.tag == f"{P}pic":
        return "unknown", None
    if el.tag != f"{P}sp":
        return "none", None  # lines, tables, charts: not a backdrop
    spPr = el.find(f"{P}spPr")
    f = None
    if spPr is not None:
        f = next((c for c in spPr if etree.QName(c).localname in FILL_TAGS), None)
    if f is None:  # no explicit fill: the shape style's fill, if any
        ref = el.find(f"{P}style/{A}fillRef")
        if ref is not None and ref.get("idx", "0") != "0" and len(ref):
            h, a = resolve_color(ref[0], scheme)
            return ("color", h) if h and a >= 0.5 else ("none", None)
        return "none", None
    n = etree.QName(f).localname
    if n == "solidFill" and len(f):
        h, a = resolve_color(f[0], scheme)
        return ("color", h) if h and a >= 0.5 else ("none", None)
    if n == "gradFill":
        h = grad_at(f, scheme, at, box)
        return ("color", h) if h else ("none", None)
    if n in ("blipFill", "pattFill"):
        return "unknown", None
    return "none", None

def flat_shapes(sptree):
    """[(element, (x, y, w, h) in slide EMU or None)] for every leaf shape in z-order, groups resolved."""
    out = []
    def walk(parent, tf):
        for el in parent:
            if el.tag == f"{P}grpSp":
                x = el.find(f"{P}grpSpPr/{A}xfrm")
                ntf = tf
                if x is not None:
                    off, ext, co, ce = (x.find(f"{A}{t}") for t in ("off", "ext", "chOff", "chExt"))
                    if None not in (off, ext, co, ce) and int(ce.get("cx", 0)) and int(ce.get("cy", 0)):
                        sx, sy = int(ext.get("cx")) / int(ce.get("cx")), int(ext.get("cy")) / int(ce.get("cy"))
                        itx, ity = int(off.get("x")) - int(co.get("x")) * sx, int(off.get("y")) - int(co.get("y")) * sy
                        ntf = (tf[0] + itx * tf[2], tf[1] + ity * tf[3], sx * tf[2], sy * tf[3])
                walk(el, ntf)
            elif el.tag in (f"{P}sp", f"{P}pic", f"{P}cxnSp", f"{P}graphicFrame"):
                b = xfrm_box(el)
                out.append((el, (tf[0] + b[0] * tf[2], tf[1] + b[1] * tf[3], b[2] * tf[2], b[3] * tf[3]) if b else None))
    walk(sptree, (0, 0, 1, 1))
    return out

def backdrop(flat, i, slide_bg, scheme, under=()):
    """Colour behind the text of flat[i]: its own fill, else the topmost filled shape under its
    centre (slide shapes, then `under`: the layout's and master's own shapes), else the slide
    background. None when that is a picture (contrast can't be measured)."""
    el, b = flat[i]
    centre = (b[0] + b[2] / 2, b[1] + b[3] / 2) if b else None
    kind, h = fill_of(el, scheme, centre, b)
    if kind == "color":
        return h
    if kind == "unknown":
        return None
    if b is None:
        return slide_bg
    cx, cy = centre
    behind = [(e, bb, False) for e, bb in reversed(flat[:i])] + [(e, bb, True) for e, bb in reversed(list(under))]
    for e2, b2, tpl in behind:
        if b2 is None or e2 is el or not (b2[0] <= cx <= b2[0] + b2[2] and b2[1] <= cy <= b2[1] + b2[3]):
            continue
        if tpl and shape_name(e2) == "brand:template-frame":
            continue  # approved hollow frame: its bounding box is not a solid background
        if tpl and ph_type(e2) is not None and e2.tag == f"{P}sp":
            continue  # template placeholders only lend position, not a visible fill
        if e2.tag == f"{P}pic" and shape_name(e2).startswith(CHROME_PREFIX):
            continue  # brand art is drawn around the text area: read the ground under it
        k2, h2 = fill_of(e2, scheme, centre, b2)
        if k2 == "color":
            return h2
        if k2 == "unknown":
            return None
    return slide_bg

def template_under(slide):
    """Leaf shapes the master and layout draw beneath a slide's own shapes, bottom first."""
    lay = slide.slide_layout
    out = []
    if lay._element.get("showMasterSp", "1") != "0":
        out += flat_shapes(lay.slide_master.shapes._spTree)
    return out + flat_shapes(lay.shapes._spTree)

def flat_box(leaves):
    """Bounding box of flattened leaves."""
    bs = [b for _, b in leaves if b]
    if not bs:
        return None
    x0, y0 = min(b[0] for b in bs), min(b[1] for b in bs)
    x1, y1 = max(b[0] + b[2] for b in bs), max(b[1] + b[3] for b in bs)
    return x0, y0, x1 - x0, y1 - y0

def is_slide_number_box(el):
    """A text box whose only content is a slide-number field (or a bare page number)."""
    t = text_of(el).strip()
    has_field = any(f.get("type") == "slidenum" for f in el.iter(f"{A}fld"))
    return (has_field and re.fullmatch(r"(‹#›|<#>|\d{1,3})", t) is not None)

def edges_touched(b, W, H, tol=0.015):
    """How many slide edges a box touches (within tol of the slide size)."""
    x, y, w, h = b
    return sum([x <= tol * W, y <= tol * H, x + w >= (1 - tol) * W, y + h >= (1 - tol) * H])

def has_alt_text(pic):
    """A picture someone described (not just a file name) is content, not brand art."""
    d = (pic.find(f".//{P}cNvPr").get("descr") or "").strip()
    return len(d.split()) >= 3 and not re.search(r"\.(png|jpe?g|gif|svg|emf|wmf|tiff?)\b", d, re.I)

def image_only(sptree, W, H):
    """True for a picture of a slide: one picture (or a group of only pictures) covers the whole
    slide and no placeholder holds text. A background photo under a real title is not one."""
    if any(ph_type(el) is not None and text_of(el) for el in sptree.iter(f"{P}sp")):
        return False
    for el in sptree:
        if shape_name(el).startswith(CHROME_PREFIX):
            continue
        if el.tag == f"{P}pic":
            b = xfrm_box(el)
            if b and b[2] * b[3] >= 0.85 * W * H:
                return True
        elif el.tag == f"{P}grpSp":
            leaves = [x for x in el.iter(f"{P}sp", f"{P}pic", f"{P}cxnSp", f"{P}graphicFrame")]
            b = xfrm_box(el)
            if leaves and all(x.tag == f"{P}pic" for x in leaves) and b and b[2] * b[3] >= 0.85 * W * H:
                return True
    return False

def renumber_chrome_ids(sptree):
    """Give brand chrome unique shape ids (python-pptx reuses one id when shapes are re-parented).
    Content shapes keep their ids, so animations that point at them still work."""
    ids = [e for e in sptree.iter(f"{P}cNvPr")]
    chrome = [e for e in ids if e.get("name", "").startswith(CHROME_PREFIX)]
    used = {e.get("id") for e in ids if e not in chrome}
    nxt = max([int(i) for i in used if i and i.isdigit()] + [1]) + 1
    for e in chrome:
        e.set("id", str(nxt)); nxt += 1

def picture_sig(slide, pic):
    blip = pic.find(f".//{A}blip")
    rid = blip.get(f"{R}embed") if blip is not None else None
    h = None
    if rid and rid in slide.part.rels:
        try:
            h = hashlib.sha1(slide.part.rels[rid].target_part.blob).hexdigest()[:12]
        except Exception:
            pass
    b = xfrm_box(pic)
    return h, list(b) if b else None

def layout_type(slide):
    return slide.slide_layout._element.get("type", "") or ""

# Layout names that are content even when the slide is sparse (never guessed as a divider)
CONTENT_LAYOUT = re.compile(r"content|column|comparison|chart|diagram|icon|numbered|agenda|statistic|bullet|table|"
                            r"\btext|list|\b(two|three|four|five)\b|customer success", re.I)

def classify(prs, overrides):
    slides = list(prs.slides)
    n = len(slides)
    roles = {}
    for i, s in enumerate(slides, 1):
        sp = s.shapes._spTree
        texts = [el for el in sp.iter(f"{P}sp") if text_of(el)]
        words = sum(len(text_of(el).split()) for el in texts)
        has_visual = any(True for _ in sp.iter(f"{P}pic")) or any(True for _ in sp.iter(f"{P}graphicFrame"))
        lt = layout_type(s)
        phs = {ph_type(el) for el in sp.iter(f"{P}sp")}
        title = " ".join(text_of(el) for el in texts if ph_type(el) in TITLE_PH)
        role = "content"
        lname = (s.slide_layout.name or "").lower()
        if re.search(r"closing|thank|\bend\b|^logo", lname):
            roles[i] = "closing"; continue
        if re.search(r"section|divider|breaker|chapter", lname):
            roles[i] = "section"; continue
        alltext = " ".join(text_of(e) for e in texts)
        if i == n and n > 1 and words <= 30 and (re.search(r"thank|questions|q\s*&\s*a|contact us|let.?s talk", alltext, re.I)
                                                 or re.search(r"statement|quote", lname)):
            roles[i] = "closing"; continue
        if re.search(r"^(title\s*\d|title slide|cover|title\s*-)", lname) and not re.search(r"only|content|subtitle|column", lname):
            roles[i] = "cover"; continue
        if i == 1 and (lt == "title" or "ctrTitle" in phs or words <= 40):
            role = "cover"
        elif i == n and n > 1 and (re.search(r"thank|questions|q\s*&\s*a|q&a|contact us|let.?s talk", " ".join(text_of(e) for e in texts), re.I) and words <= 30):
            role = "closing"
        elif lt == "secHead" or (1 < i < n and 1 <= words <= 14 and not CONTENT_LAYOUT.search(lname) and not has_visual and len(texts) <= 2 and (lt in ("title", "secHead", "titleOnly", "") or "ctrTitle" in phs)):
            role = "section"
        roles[i] = role
    for k, v in (overrides or {}).items():
        roles[k] = v
    return roles

def parse_roles(s):
    out = {}
    if not s:
        return out
    for part in s.split(","):
        k, v = part.split("=")
        if "-" in k:
            a, b = k.split("-")
            for j in range(int(a), int(b) + 1):
                out[j] = v.strip()
        else:
            out[int(k)] = v.strip()
    for v in out.values():
        if v not in ("cover", "section", "content", "closing"):
            sys.exit(f"Unknown role '{v}': use cover, section, content or closing")
    return out

def inspect_deck(path):
    prs = Presentation(path)
    roles = classify(prs, {})
    slides = list(prs.slides)
    pics = defaultdict(list)
    out = {"file": os.path.basename(path), "size_in": [round(prs.slide_width / 914400, 3), round(prs.slide_height / 914400, 3)],
           "slides": [], "fonts": Counter(), "colors": Counter()}
    for i, s in enumerate(slides, 1):
        sp = s.shapes._spTree
        title = " ".join(text_of(el) for el in sp.iter(f"{P}sp") if ph_type(el) in TITLE_PH)
        info = {"n": i, "role": roles[i], "layout": s.slide_layout.name, "layout_type": layout_type(s),
                "title": title[:90], "words": sum(len(text_of(el).split()) for el in sp.iter(f"{P}sp")),
                "pictures": [], "chrome": sum(1 for el in sp if shape_name(el).startswith(CHROME_PREFIX))}
        for pic in sp.iter(f"{P}pic"):
            h, box = picture_sig(s, pic)
            info["pictures"].append({"name": shape_name(pic), "hash": h})
            if h:
                pics[h].append((i, shape_name(pic), box))
        out["slides"].append(info)
        for el in sp.iter(f"{A}latin"):
            out["fonts"][el.get("typeface")] += 1
        for el in sp.iter(f"{A}srgbClr"):
            out["colors"]["#" + el.get("val").lower()] += 1
    thresh = max(3, int(0.4 * len(slides)))
    out["repeated_images"] = [{"hash": h, "slides": [x[0] for x in v], "names": sorted({x[1] for x in v})}
                              for h, v in pics.items() if len({x[0] for x in v}) >= thresh]
    out["fonts"] = dict(out["fonts"].most_common())
    out["colors"] = dict(out["colors"].most_common(25))
    masters = []
    for m in prs.slide_masters:
        deco = [shape_name(el) for el in m.shapes._spTree if el.tag in (f"{P}pic", f"{P}grpSp") or (el.tag == f"{P}sp" and ph_type(el) is None)]
        masters.append({"name": m.name if hasattr(m, "name") else "", "decorations": deco[:20]})
    out["masters"] = masters
    return out

# ----------------------------------------------------------------- the restyle
class Restyler:
    def __init__(self, prs, brand, variant, spec, bdir, opts):
        self.prs, self.brand, self.variant, self.spec, self.bdir, self.o = prs, brand, variant, spec, bdir, opts
        self.font = spec.get("font", "Arial")
        self.pal = ColorMapper(spec["palette"])
        self.text_names = list(spec.get("text_colors", spec["palette"]).keys()) + ["ink"]
        self.textmap = ColorMapper({**spec["palette"], **spec.get("text_colors", {}), "ink": spec["roles"]["ink"]})
        self.ondark = spec.get("on_dark_colors", {"white": "#ffffff"})
        self.roles_cfg = spec["slides"]
        self.report = Counter()
        self.notes = []
        self.image_only_slides = set()
        self._promoted = {}          # layout element -> its text boxes copied onto slides
        self._promoted_slides = set()
        self._raised = set()         # chrome moved on top of content: its text gets a contrast fix
        cw, ch = brand["canvas"]
        self.cw, self.ch = cw, ch
        self.sw, self.sh = prs.slide_width, prs.slide_height
        self.sx, self.sy = self.sw / cw, self.sh / ch
        self.s = min(self.sx, self.sy)
        self.scheme = scheme_of(spec)
        accents = spec.get("accents", {})
        a = (opts.get("accent") or spec.get("default_accent") or "")
        if accents and a not in accents:
            sys.exit(f"Accent '{a}' is not available for {brand['name']}: {', '.join(accents)}")
        self.accent = accents.get(a, a)

    # geometry ------------------------------------------------------------
    def place(self, box, ax=None, ay=None):
        x, y, w, h = box
        cw, ch = self.cw, self.ch
        ax = ax or ("l" if x + w / 2 <= cw / 2 else "r")
        ay = ay or ("t" if y + h / 2 <= ch / 2 else "b")
        if ax == "full":
            X, W = x * self.sx, w * self.sx
        elif ax == "l":
            X, W = x * self.s, w * self.s
        else:
            X, W = self.sw - (cw - x) * self.s, w * self.s
        if ay == "full":
            Y, H = y * self.sy, h * self.sy
        elif ay == "t":
            Y, H = y * self.s, h * self.s
        else:
            Y, H = self.sh - (ch - y) * self.s, h * self.s
        return int(X), int(Y), int(W), int(H)

    # 0 theme references -----------------------------------------------------
    PIN_SLOTS = {"accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "dk1", "lt1", "dk2", "lt2",
                 "hlink", "folHlink"}

    def materialize_footers(self):
        """Give kept slide footers (sources, notes) their inherited position before the templates'
        footer placeholders are removed, so they don't lose their place."""
        for s in self.prs.slides:
            for el in s.shapes._spTree.iter(f"{P}sp"):
                if ph_type(el) != "ftr" or not text_of(el) or LEGAL.search(text_of(el)):
                    continue
                spPr = el.find(f"{P}spPr")
                if spPr is None or spPr.find(f"{A}xfrm") is not None:
                    continue
                inh = self._inherited_xfrm(s, el)
                if inh is not None:
                    spPr.insert(0, copy.deepcopy(inh))

    def pin_theme_refs(self):
        """Replace accent/dk2/lt2/link theme references on masters, layouts and slides with the
        OLD theme's colour (tints and shades kept), before the theme is swapped. Brands order their
        accents differently (old accent3 blue can be the new brand's gold), so swapping slots would
        change hues; pinned colours are then mapped to the nearest brand colour like any other.
        dk1/lt1 (tx1/bg1) stay theme-linked, and so do charts, whose series follow the brand theme."""
        from pptx.opc.constants import RELATIONSHIP_TYPE as RT
        for m in self.prs.slide_masters:
            try:
                troot, _ = xml_of(m.part.part_related_by(RT.THEME))
            except KeyError:
                continue
            cs = troot.find(f".//{A}clrScheme")
            if cs is None:
                continue
            old = {}
            for slot in cs:
                c = slot.find(f"{A}srgbClr")
                if c is None:
                    c = slot.find(f"{A}sysClr")
                    val = c.get("lastClr") if c is not None else None
                else:
                    val = c.get("val")
                if val:
                    old[etree.QName(slot).localname] = val.upper()
            cmap = m._element.find(f"{P}clrMap")
            alias = {k: cmap.get(k) for k in ("tx2", "bg2")} if cmap is not None else {"tx2": "dk2", "bg2": "lt2"}
            master_layouts = set(id(l._element) for l in m.slide_layouts)
            roots = [m._element] + [l._element for l in m.slide_layouts]
            roots += [s._element for s in self.prs.slides if id(s.slide_layout._element) in master_layouts]
            for root in roots:
                for el in list(root.iter(f"{A}schemeClr")):
                    slot = alias.get(el.get("val"), el.get("val"))
                    if slot not in self.PIN_SLOTS or slot not in old or self._in_chrome(el):
                        continue
                    new = etree.Element(f"{A}srgbClr", val=old[slot])
                    for c in el:
                        new.append(c)
                    el.getparent().replace(el, new)
                    self.report["theme_refs_pinned"] += 1
            self._invert_ground_tints(m, old, cmap, roots)

    def _invert_ground_tints(self, master, old, cmap, roots):
        """Old dark deck -> light brand (or the reverse): a panel that was a subtle tint of the old
        ground would be pinned to a heavy block on the new one. Keep its distance from the ground
        instead (a little lighter on dark becomes a little darker on light), then snap to the palette."""
        osch = {k: v.lower() for k, v in old.items()}
        if cmap is not None:
            for k in ("bg1", "tx1", "bg2", "tx2"):
                if cmap.get(k) in old:
                    osch[k] = old[cmap.get(k)].lower()
        ground = None
        bg = master._element.find(f"{P}cSld/{P}bg")
        if bg is not None:
            c = bg.find(f"{P}bgPr/{A}solidFill/*")
            if c is None:
                c = bg.find(f"{P}bgRef/*")
            if c is not None:
                ground = resolve_color(c, osch)[0]
        ground = ground or osch.get("bg1") or osch.get("lt1")
        surface = bg_color(self.roles_cfg["content"]["background"]).lower()
        # Cards and panels close to the old ground become the brand's panel colour (roles.panel):
        # dark deck -> light brand always; light deck -> dark brand only when the brand defines a
        # dark panel in the selected palette, since white cards on a dark ground are its fallback.
        if not ground:
            return
        to_light = luminance(ground) < 0.18 <= luminance(surface)
        to_dark = luminance(surface) < 0.18 <= luminance(ground)
        if not (to_light or to_dark):
            return
        panel = self.spec["roles"].get("panel")
        cards = to_light or (to_dark and panel)
        panel = panel or (self.spec.get("table") or {}).get("band1") or surface
        gl = lab(ground)
        W, H = self.sw, self.sh
        def solid(f):
            return [c for c in f if etree.QName(c).localname != "alpha"]
        for root in roots:
            for f in list(root.iter(f"{A}solidFill")):
                if not len(f):
                    continue
                parent = etree.QName(f.getparent()).localname
                col, a = resolve_color(f[0], osch)
                if not col:
                    continue
                if parent == "ln":
                    # strokes that read on the old ground but vanish on the new one take the title colour
                    if contrast(col, surface) < 2.5 and contrast(col, ground) >= 3:
                        self._set_solid(f, self.spec["roles"]["title"])
                        self.report["strokes_flipped"] += 1
                    continue
                if not cards or parent != "spPr" or math.dist(lab(col), gl) > 16:
                    continue
                shape = next(f.iterancestors(f"{P}sp"), None)
                b = xfrm_box(shape) if shape is not None else None
                if b is None or not (0.02 * W * H <= b[2] * b[3] <= 0.6 * W * H):
                    continue  # card-sized panels only, not icon parts or full grounds
                self._set_solid(f, panel)
                self.report["ground_tints_inverted"] += 1

    def _set_solid(self, f, hex_):
        """Replace a solidFill's colour, keeping only its alpha."""
        keep = [c for c in f[0] if etree.QName(c).localname == "alpha"]
        f.remove(f[0])
        c = etree.SubElement(f, f"{A}srgbClr", val=hex_.lstrip("#").upper())
        for k in keep:
            c.append(k)

    # 1 theme ---------------------------------------------------------------
    def default_text(self):
        """presentation.xml's defaultTextStyle colours every text box that has no colour of its own.
        A deck made for a light ground hard-codes black there, invisible on a dark brand ground
        (and the reverse): switch any colour that fails on the brand ground to the brand ink."""
        dts = self.prs.part._element.find(f"{P}defaultTextStyle")
        if dts is None:
            return
        surface = bg_color(self.roles_cfg["content"]["background"])
        for f in dts.iter(f"{A}solidFill"):
            if not len(f):
                continue
            col, _ = resolve_color(f[0], self.scheme)
            if col and contrast(col, surface) < 3:
                self._set_solid(f, self.spec["roles"]["ink"])
                self.report["default_text_colours_fixed"] += 1

    def theme(self):
        for part in parts(self.prs):
            if kind_of(part) != "theme":
                continue
            root, write = xml_of(part)
            cs = root.find(f".//{A}clrScheme")
            if cs is not None:
                cs.set("name", self.brand["name"])
                for slot, val in self.spec["theme"].items():
                    el = cs.find(f"{A}{slot}")
                    if el is None:
                        continue
                    for c in list(el):
                        el.remove(c)
                    etree.SubElement(el, f"{A}srgbClr", val=val.upper())
            fs = root.find(f".//{A}fontScheme")
            if fs is not None:
                fs.set("name", self.brand["name"])
                for tag in ("majorFont", "minorFont"):
                    f = fs.find(f"{A}{tag}")
                    if f is None:
                        continue
                    lat = f.find(f"{A}latin")
                    if lat is not None:
                        lat.set("typeface", self.font)
            write()
            self.report["themes"] += 1

    # 2 masters / layouts -----------------------------------------------------
    def clean_templates(self, roles):
        # layouts behind cover/section/closing slides get the brand's own art, so their old art goes
        dressed = {id(s.slide_layout._element) for i, s in enumerate(self.prs.slides, 1)
                   if roles[i] != "content" and i not in self.image_only_slides}
        for m in self.prs.slide_masters:
            self._clean_tpl(m._element, master=True)
            if self.spec.get("dark"):
                cm = m._element.find(f"{P}clrMap")
                if cm is not None:
                    cm.set("bg1", "dk1"); cm.set("tx1", "lt1"); cm.set("bg2", "dk2"); cm.set("tx2", "lt2")
            self._master_text(m._element)
            for lay in m.slide_layouts:
                self._clean_tpl(lay._element, master=False, dressed=id(lay._element) in dressed)

    def _clean_tpl(self, el, master, dressed=False):
        sptree = el.find(f"{P}cSld/{P}spTree")
        if not self.o.get("keep_template_art"):
            for child in list(sptree):
                tag = child.tag
                if tag in (f"{P}nvGrpSpPr", f"{P}grpSpPr", f"{P}extLst"):
                    continue
                pt = ph_type(child) if tag == f"{P}sp" else None
                if tag == f"{P}sp" and pt is not None and pt not in FOOTER_PH:
                    self._clean_placeholder_fill(child, dressed or master)
                    continue
                # masters carry the old identity; layouts also carry structure (text, circles,
                # rules, numbered markers), so there only the old brand's art goes
                if master or pt in FOOTER_PH or self._layout_art(child, dressed):
                    sptree.remove(child)
                    self.report["template_decorations_removed"] += 1
                else:
                    self.report["template_shapes_kept"] += 1
        else:
            for child in list(sptree):
                if child.tag == f"{P}sp" and ph_type(child) in FOOTER_PH:
                    sptree.remove(child)
        csld = el.find(f"{P}cSld")
        bg = csld.find(f"{P}bg")
        if bg is not None:
            csld.remove(bg)
        if master:
            self._set_bg(csld, self.roles_cfg["content"]["background"])
        if not master:
            el.set("showMasterSp", "1")
        self._tpl_text(el)

    def _clean_placeholder_fill(self, sp, dressed):
        """Template placeholders can carry old art as their fill: a logo picture (blipFill), or a
        full-slide coloured ground on a photo layout. Empty slide placeholders inherit it."""
        spPr = sp.find(f"{P}spPr")
        if spPr is None:
            return
        f = next((c for c in spPr if etree.QName(c).localname in FILL_TAGS), None)
        if f is None:
            return
        n = etree.QName(f).localname
        b = xfrm_box(sp)
        big = b is not None and b[2] * b[3] >= 0.5 * self.sw * self.sh
        if n == "blipFill" or (dressed and big and n in ("solidFill", "gradFill", "pattFill")):
            spPr.replace(f, etree.Element(f"{A}noFill"))
            self.report["template_placeholder_fills_removed"] += 1

    def _layout_art(self, el, dressed=False):
        """Old-brand artwork on a layout: pictures (logos, photos), legal text, slide-number boxes,
        edge bars and bands, full-slide background shapes, freeform art touching an edge, logo-like
        vector groups in the header/footer band, and groups of these. On a `dressed` layout (behind
        cover/section/closing slides) every textless shape goes: the brand's own art replaces it."""
        W, H = self.sw, self.sh
        if el.tag == f"{P}pic":
            return True
        t = text_of(el)
        if t:
            return bool(LEGAL.search(t)) or is_slide_number_box(el)
        if dressed:
            return True
        if el.tag == f"{P}grpSp":
            leaves = flat_shapes([el])
            if any(k.tag == f"{P}pic" for k, _ in leaves):
                return True
            b = flat_box(leaves)
            if b and self._in_band(b) and any(k.find(f"{P}spPr/{A}custGeom") is not None for k, _ in leaves):
                return True  # vector logo (a wordmark drawn as freeforms) in the footer/header band
            if b and edges_touched(b, W, H) and all(k.find(f"{P}spPr/{A}custGeom") is not None for k, _ in leaves):
                return True  # freeform supergraphic group running off an edge
            return bool(leaves) and all(self._layout_art(k) for k, _ in leaves)
        if el.tag not in (f"{P}sp", f"{P}cxnSp"):
            return False
        b = xfrm_box(el)
        if b is None:
            return False
        if self._edge_deco(el) or b[2] * b[3] >= 0.5 * W * H:
            return True
        free = el.find(f"{P}spPr/{A}custGeom") is not None
        return free and (edges_touched(b, W, H) >= 1 or self._in_band(b))

    def _in_band(self, b):
        """Box lies in the footer band (bottom 15%) or header band (top 12%) and is logo-sized."""
        x, y, w, h = b
        return w <= 0.3 * self.sw and (y >= 0.85 * self.sh or y + h <= 0.12 * self.sh)

    def _tpl_text(self, el):
        """Inherited text colours in template placeholders must read on the brand surface."""
        surface = bg_color(self.roles_cfg["content"]["background"])
        sp_roots = [x for x in el.iter(f"{P}sp") if ph_type(x) is not None]
        tx = el.find(f"{P}txStyles")
        for root, is_title in [(x, ph_type(x) in TITLE_PH) for x in sp_roots] + ([(tx.find(f"{P}titleStyle"), True), (tx.find(f"{P}bodyStyle"), False), (tx.find(f"{P}otherStyle"), False)] if tx is not None else []):
            if root is None:
                continue
            for rpr in root.iter(f"{A}defRPr", f"{A}rPr", f"{A}endParaRPr"):
                sf = rpr.find(f"{A}solidFill")
                if sf is None or len(sf) == 0:
                    continue
                c = sf[0]
                col = c.get("val") if c.tag == f"{A}srgbClr" else self.scheme.get(c.get("val")) if c.tag == f"{A}schemeClr" else None
                if col is None:
                    continue
                if c.tag == f"{A}schemeClr" and len(c):
                    continue  # tinted theme colour
                if contrast(col, surface) < 3.0:
                    self._run_color(rpr, self.spec["roles"]["title"] if is_title else self.spec["roles"]["ink"])
                    self.report["template_text_colors_fixed"] += 1

    def _master_text(self, el):
        tx = el.find(f"{P}txStyles")
        if tx is None:
            return
        title = tx.find(f"{P}titleStyle")
        if title is not None:
            for lvl in title:
                d = lvl.find(f"{A}defRPr")
                if d is None:
                    continue
                for c in d.findall(f"{A}solidFill"):
                    d.remove(c)
                d.insert(0, solid(self.spec["roles"]["title"]))
                if self.spec.get("no_bold_titles"):
                    d.set("b", "0")
        body = tx.find(f"{P}bodyStyle")
        if body is not None:
            for lvl in body:
                if not lvl.tag.endswith("pPr"):
                    continue
                bc = lvl.find(f"{A}buClr")
                if bc is None:
                    bc = etree.Element(f"{A}buClr")
                    lvl.insert(0, bc)
                for c in list(bc):
                    bc.remove(c)
                etree.SubElement(bc, f"{A}srgbClr", val=self.spec["roles"]["bullet"].lstrip("#").upper())

    def _set_bg(self, csld, bg):
        old = csld.find(f"{P}bg")
        if old is not None:
            csld.remove(old)
        bgel = etree.Element(f"{P}bg")
        bgpr = etree.SubElement(bgel, f"{P}bgPr")
        if "gradient" in bg:
            bgpr.append(grad_xml(bg["gradient"]))
        else:
            bgpr.append(solid(bg.get("solid", "#ffffff")))
        etree.SubElement(bgpr, f"{A}effectLst")
        csld.insert(0, bgel)

    # 3 colours + fonts across every part -----------------------------------
    def recolor_and_fonts(self):
        skip = {id(s.part) for i, s in enumerate(self.prs.slides, 1) if i in self.image_only_slides}
        for part in parts(self.prs):
            k = kind_of(part)
            if k not in ("slide", "layout", "master", "chart", "dgmData", "dgmDrawing", "notes") or id(part) in skip:
                continue
            root, write = xml_of(part)
            self._fonts(root)
            if k != "notes":
                self._colors(root, k)
            write()

    def _fonts(self, root):
        for tag in ("latin", "ea", "cs"):
            for el in root.iter(f"{A}{tag}"):
                tf = el.get("typeface") or ""
                if not tf or tf.startswith("+") or MONO.search(tf) or SYMBOL.search(tf):
                    continue
                if tag != "latin" and CJK.search(tf):
                    continue
                if tf != self.font:
                    el.set("typeface", self.font)
                    self.report["fonts_replaced"] += 1
        for el in root.iter(f"{A}buFont"):
            tf = el.get("typeface") or ""
            if tf and not SYMBOL.search(tf) and not tf.startswith("+") and tf != self.font:
                el.set("typeface", self.font)

    def _colors(self, root, kind):
        for el in list(root.iter(f"{A}prstClr", f"{A}scrgbClr")):
            if el.tag == f"{A}prstClr":
                val = PRST.get(el.get("val"), None)
            else:
                val = rgb2hex(tuple(int(el.get(c, "0")) / 100000 for c in ("r", "g", "b")))
            if not val:
                continue
            new = etree.Element(f"{A}srgbClr", val=val.upper())
            for c in el:
                new.append(c)
            el.getparent().replace(el, new)
        for el in root.iter(f"{A}srgbClr"):
            if self._in_chrome(el):
                continue
            anc = [x.tag for x in el.iterancestors()]
            is_text = any(t in anc for t in (f"{A}rPr", f"{A}defRPr", f"{A}endParaRPr", f"{A}buClr"))
            if any(t in (f"{P}pic",) for t in anc) and not any(t == f"{A}ln" for t in anc):
                continue
            old = el.get("val").lower()
            remap = self.spec.get("remap") or {}
            if old in remap or "#" + old in remap:
                # the brand's own light accents switch to their dark-theme values (not nearest colour)
                new = (remap.get(old) or remap.get("#" + old)).lstrip("#").lower()
                if new != old:
                    el.set("val", new.upper())
                    self.report["accents_switched"] += 1
                continue
            if is_text and self.spec.get("dark") and luminance(old) < 0.04 and chroma(old) < 30:
                # near-black body text from a light deck is the deck's ink: white on a dark brand,
                # not the nearest bright hue
                name, new = "ink", self.spec["roles"]["ink"].lstrip("#").lower()
            else:
                name, new = (self.textmap.nearest(old, self.text_names + list(self.ondark)) if is_text
                             else self.pal.nearest(old))
            if new != old:
                el.set("val", new.upper())
                self.report["text_colors_mapped" if is_text else "shape_colors_mapped"] += 1

    def _in_chrome(self, el):
        for anc in el.iterancestors(f"{P}sp", f"{P}pic", f"{P}grpSp"):
            if shape_name(anc).startswith(CHROME_PREFIX):
                return True
        return False

    def corners(self):
        if not self.spec.get("square_corners"):
            return
        trees = [s.shapes._spTree for s in self.prs.slides]
        trees += [l.shapes._spTree for m in self.prs.slide_masters for l in m.slide_layouts]
        for tree in trees:
            for g in tree.iter(f"{A}prstGeom"):
                if g.get("prst") in ROUNDED:
                    g.set("prst", "rect")
                    av = g.find(f"{A}avLst")
                    if av is not None:
                        for c in list(av):
                            av.remove(c)
                    self.report["corners_squared"] += 1

    # 4 per-slide chrome --------------------------------------------------------
    def slides(self, roles):
        repeated = set()
        if self.o.get("strip_repeated_images"):
            info = inspect_deck(self.o["_src"])
            repeated = {r["hash"] for r in info["repeated_images"]}
        removals = defaultdict(set)
        for item in (self.o.get("remove") or "").split(","):
            if ":" in item:
                n, nm = item.split(":", 1)
                removals[int(n)].add(nm.strip())
        for i, slide in enumerate(self.prs.slides, 1):
            role = roles[i]
            cfg = self.roles_cfg.get(role) or self.roles_cfg["content"]
            sp = slide.shapes._spTree
            for el in list(sp):
                nm = shape_name(el)
                if nm.startswith(CHROME_PREFIX):
                    sp.remove(el)
                elif el.tag == f"{P}sp" and ph_type(el) in FOOTER_PH:
                    t = text_of(el)
                    if ph_type(el) == "ftr" and t and not LEGAL.search(t):
                        self.notes.append(f"slide {i}: kept footer text '{t[:40]}' (content, not legal)")
                        continue
                    sp.remove(el); self.report["old_footers_removed"] += 1
                elif nm in removals.get(i, ()):
                    sp.remove(el); self.report["shapes_removed_on_request"] += 1
                elif el.tag == f"{P}pic" and repeated and picture_sig(slide, el)[0] in repeated:
                    sp.remove(el); self.report["repeated_images_removed"] += 1
                elif self._old_page_number(el):
                    sp.remove(el); self.report["old_page_numbers_removed"] += 1
            if image_only(sp, self.sw, self.sh):
                # a picture of a slide: nothing to restyle, and chrome would sit behind it
                self.notes.append(f"slide {i}: full-slide picture, left as is (no chrome)")
                self.report["image_only_slides"] += 1
                continue
            if not self.o.get("keep_decorations"):
                for el in self._decorations(slide, role):
                    self.notes.append(f"slide {i}: removed old decoration '{shape_name(el)}'")
                    el.getparent().remove(el)
                    self.report["old_decorations_removed"] += 1
            csld = slide._element.find(f"{P}cSld")
            self._set_bg(csld, cfg["background"])
            if role != "content":
                self._promote_layout_text(slide, i)
            if not self.o.get("no_chrome"):
                self._chrome(slide, cfg, i)
                renumber_chrome_ids(sp)
                self._chrome_on_top(slide, i)
                self._lift_footer_text(slide, i)
            if role != "content" and cfg.get("safe"):
                self._fit_safe(slide, cfg["safe"], i)
            self.report[f"role_{role}"] += 1
        for lay_el, els in self._promoted.items():
            if all(id(s.slide_layout._element) != id(lay_el) or i in self._promoted_slides
                   for i, s in enumerate(self.prs.slides, 1)):
                for e in els:
                    if e.getparent() is not None:
                        e.getparent().remove(e)

    def _promote_layout_text(self, slide, n):
        """Text boxes kept on the layout ("Thank You") would sit under the slide's brand art: copy
        them onto the slide, above the art, and drop them from the layout once every slide has them."""
        lay = slide.slide_layout._element
        kept, seen = [], set()
        for el in lay.find(f"{P}cSld/{P}spTree"):
            if el.tag != f"{P}sp" or ph_type(el) is not None or not text_of(el):
                continue
            key = (text_of(el), xfrm_box(el))
            if key in seen:
                el.getparent().remove(el)  # the same text stacked twice on the layout
                continue
            seen.add(key)
            kept.append(el)
        if not kept:
            return
        sp = slide.shapes._spTree
        nxt = max([int(e.get("id")) for e in sp.iter(f"{P}cNvPr") if (e.get("id") or "").isdigit()] + [1]) + 1
        for el in kept:
            c = copy.deepcopy(el)
            for cn in c.iter(f"{P}cNvPr"):
                cn.set("id", str(nxt)); nxt += 1
            sp.append(c)
            self.report["layout_text_promoted"] += 1
        self._promoted.setdefault(lay, kept)
        self._promoted_slides.add(n)

    def _chrome_on_top(self, slide, n):
        """Brand marks (logo, legal, number, bars) hidden under a large content panel or picture are
        moved on top of it; smaller overlaps are noted for review."""
        sp = slide.shapes._spTree
        flat = flat_shapes(sp)
        content = [(e, b) for e, b in flat if b and not shape_name(e).startswith(CHROME_PREFIX)
                   and fill_of(e, self.scheme)[0] != "none"]
        W, H = self.sw, self.sh
        for el in list(sp):
            if not shape_name(el).startswith(CHROME_PREFIX) or id(el) in getattr(self, "_back", ()):
                continue  # art, frames and panels belong at the back
            b = xfrm_box(el)
            if not b or b[2] * b[3] >= 0.5 * W * H:
                continue  # full-slide frames and art stay at the back
            covers = [(e, cb) for e, cb in content if cb[0] < b[0] + b[2] and b[0] < cb[0] + cb[2]
                      and cb[1] < b[1] + b[3] and b[1] < cb[1] + cb[3]]
            if any(cb[2] * cb[3] >= 0.25 * W * H for _, cb in covers):
                sp.remove(el); sp.append(el)
                self._raised.add(id(el))
                self.report["chrome_raised"] += 1
            elif covers:
                self.notes.append(f"slide {n}: content overlaps brand '{shape_name(el)[len(CHROME_PREFIX):]}' (review)")

    def _lift_footer_text(self, slide, n):
        """Kept footer text (a source line) moves above the brand footer and gets an explicit colour."""
        sp = slide.shapes._spTree
        tops = [b[1] for el in sp if shape_name(el).startswith(CHROME_PREFIX) for b in [xfrm_box(el)]
                if b and b[1] >= 0.75 * self.sh and b[2] * b[3] < 0.5 * self.sw * self.sh]
        for el in sp:
            if el.tag != f"{P}sp" or ph_type(el) != "ftr" or not text_of(el):
                continue
            for rpr in run_props(el.find(f"{P}txBody")):
                if rpr.find(f"{A}solidFill") is None:
                    self._run_color(rpr, self.spec["roles"]["ink"])
            off = el.find(f"{P}spPr/{A}xfrm/{A}off")
            ext = el.find(f"{P}spPr/{A}xfrm/{A}ext")
            if off is None or ext is None or not tops:
                continue
            top = min(tops) - int(0.01 * self.sh)
            y, h = int(off.get("y")), int(ext.get("cy"))
            if y + h > top:
                off.set("y", str(max(0, top - h)))
                self.report["footer_text_lifted"] += 1

    def _old_page_number(self, el):
        """The old page number: a small unfilled text box near a side edge of the top or bottom band,
        holding only a number or a slide-number field. Numbered badges (filled, ellipses) are content."""
        if el.tag != f"{P}sp" or ph_type(el) is not None:
            return False
        if not (re.fullmatch(r"\d{1,3}", text_of(el)) or is_slide_number_box(el)):
            return False
        if fill_of(el, self.scheme)[0] != "none" or (el.find(f"{P}spPr/{A}prstGeom") is not None
                                                     and el.find(f"{P}spPr/{A}prstGeom").get("prst") != "rect"):
            return False
        b = xfrm_box(el)
        if not b:
            return False
        x, y, w, h = b
        W, H = self.sw, self.sh
        side = x <= 0.15 * W or x + w >= 0.85 * W
        return w <= 0.1 * W and h <= 0.1 * H and side and (y + h >= 0.86 * H or y <= 0.14 * H)

    def _chrome(self, slide, cfg, n):
        sp = slide.shapes._spTree
        back, front = [], []
        for e in cfg.get("elements", []):
            name = CHROME_PREFIX + e["name"]
            X, Y, W, H = self.place(e["box"], e.get("ax"), e.get("ay"))
            if e["type"] == "image":
                f = os.path.join(self.bdir, e["file"].replace("{accent}", self.accent))
                if not os.path.isfile(f) and "{accent}" in e["file"]:
                    dflt = self.spec.get("accents", {}).get(self.spec.get("default_accent"), "")
                    f = os.path.join(self.bdir, e["file"].replace("{accent}", dflt))
                if not os.path.isfile(f):
                    self.notes.append(f"missing asset {os.path.relpath(f, self.bdir)}")
                    continue
                if e.get("ax") == "r" and e.get("ay") == "b" and e["box"][2] == self.cw:
                    # full-slide overlay: keep its aspect, pin to bottom-right
                    W, H = int(self.cw * self.s), int(self.ch * self.s)
                    X, Y = self.sw - W, self.sh - H
                pic = slide.shapes.add_picture(f, X, Y, W, H)
                if e.get("crop"):
                    self._crop_fill(pic, W, H)
                pic._element.find(f".//{P}cNvPr").set("name", name)
                pic._element.find(f".//{P}cNvPr").set("descr", self.brand["name"] + " " + e["name"])
                el = pic._element
            elif e["type"] == "rect":
                shp = slide.shapes.add_shape(1, X, Y, W, H)
                el = shp._element
                spPr = el.find(f"{P}spPr")
                for c in list(spPr):
                    if c.tag not in (f"{A}xfrm", f"{A}prstGeom"):
                        spPr.remove(c)
                spPr.append(grad_xml(e["gradient"]) if "gradient" in e else solid(e["fill"]))
                ln = etree.SubElement(spPr, f"{A}ln"); etree.SubElement(ln, f"{A}noFill")
                st = el.find(f"{P}style")
                if st is not None:
                    el.remove(st)
                tb = el.find(f"{P}txBody")
                if tb is not None:
                    el.remove(tb)
                el.find(f".//{P}cNvPr").set("name", name)
            elif e["type"] in ("text", "slide_number"):
                tb = slide.shapes.add_textbox(X, Y, W, H)
                el = tb._element
                el.find(f".//{P}cNvPr").set("name", name)
                body = el.find(f"{P}txBody")
                bp = body.find(f"{A}bodyPr")
                for k, v in (("wrap", "square"), ("lIns", "0"), ("tIns", "0"), ("rIns", "0"), ("bIns", "0"), ("anchor", "t")):
                    bp.set(k, v)
                for p in body.findall(f"{A}p"):
                    body.remove(p)
                lines = e.get("lines") or [""]
                # sizes are points on the brand's 7.5 in tall template; scale with slide height
                sz = str(int(round(e.get("size", 8) * 100 * (self.sh / 914400) / 7.5)))
                for li in lines:
                    p = etree.SubElement(body, f"{A}p")
                    ppr = etree.SubElement(p, f"{A}pPr", algn=e.get("align", "l"))
                    etree.SubElement(ppr, f"{A}buNone")
                    rpr_attrs = {"lang": "en-US", "sz": sz, "dirty": "0"}
                    if e["type"] == "slide_number":
                        fld = etree.SubElement(p, f"{A}fld", id="{" + str(uuid.uuid4()).upper() + "}", type="slidenum")
                        rpr = etree.SubElement(fld, f"{A}rPr", **rpr_attrs)
                        rpr.append(solid(e["color"]))
                        etree.SubElement(rpr, f"{A}latin", typeface=self.font)
                        etree.SubElement(fld, f"{A}t").text = str(n)
                    else:
                        r_ = etree.SubElement(p, f"{A}r")
                        rpr = etree.SubElement(r_, f"{A}rPr", **rpr_attrs)
                        rpr.append(solid(e["color"]))
                        etree.SubElement(rpr, f"{A}latin", typeface=self.font)
                        etree.SubElement(r_, f"{A}t").text = li
            else:
                continue
            sp.remove(el)
            (back if e.get("back") else front).append(el)
        # backmost: art and frames, in declared order; others just above them
        base = 2
        self._back = {id(el) for el in back}
        for el in back:
            sp.insert(base, el); base += 1
        for el in front:
            sp.insert(base, el); base += 1
        self.report["chrome_elements"] += len(back) + len(front)

    def _inherited_xfrm(self, slide, el):
        ph = el.find(f".//{P}nvPr/{P}ph")
        t, idx = ph.get("type", "body"), ph.get("idx")
        alias = {"ctrTitle": "title", "subTitle": "body"}
        for tpl in (slide.slide_layout._element, slide.slide_layout.slide_master._element):
            for cand in tpl.iter(f"{P}sp"):
                cph = cand.find(f".//{P}nvPr/{P}ph")
                if cph is None:
                    continue
                ct = cph.get("type", "body")
                same = (idx is not None and cph.get("idx") == idx) or ct == t or alias.get(ct, ct) == alias.get(t, t)
                x = cand.find(f"{P}spPr/{A}xfrm")
                if same and x is not None and x.find(f"{A}off") is not None:
                    return x
        return None

    def _decorations(self, slide, role):
        """Old-identity artwork drawn on the slide: thin edge bars, textless gradient frames,
        full-bleed edge photos on cover/section/closing slides."""
        W, H = self.sw, self.sh
        found = []
        for el in list(slide.shapes._spTree):
            if shape_name(el).startswith(CHROME_PREFIX):
                continue
            if el.tag == f"{P}grpSp":
                # a group of thin textless strokes hugging an edge (old frame or bar set)
                leaves = flat_shapes([el])
                b = xfrm_box(el)
                m = min(W, H)
                if (leaves and b and not text_of(el) and edges_touched(b, W, H)
                        and all(k.tag in (f"{P}sp", f"{P}cxnSp") and kb and min(kb[2], kb[3]) <= 0.03 * m for k, kb in leaves)):
                    found.append(el)
            elif self._edge_deco(el):
                found.append(el)
            elif el.tag == f"{P}pic" and role in ("cover", "section", "closing") and not has_alt_text(el):
                b = xfrm_box(el)
                if b and edges_touched(b, W, H) >= 2 and b[2] * b[3] >= 0.12 * W * H:
                    found.append(el)
        return found

    def _edge_deco(self, el):
        """Textless thin bar along a slide edge, or a gradient band/frame touching two edges.
        Interior rules, dividers, data bars and panels are content and are kept."""
        if el.tag not in (f"{P}sp", f"{P}cxnSp") or text_of(el) or ph_type(el) is not None:
            return False
        b = xfrm_box(el)
        if b is None:
            return False
        W, H = self.sw, self.sh
        x, y, w, h = b
        touched = edges_touched(b, W, H)
        thin_h = h <= 0.03 * H and w >= 0.3 * W   # horizontal bar
        thin_v = w <= 0.03 * W and h >= 0.3 * H   # vertical bar
        if (thin_h or thin_v) and touched:
            return True
        m = min(W, H)
        corner = (min(x, W - x - w) <= 0.08 * W) and (min(y, H - y - h) <= 0.08 * H)
        if corner and min(w, h) <= 0.015 * m and 0.04 * m <= max(w, h) <= 0.25 * m:
            return True  # a stroke of a corner bracket/frame mark
        return el.find(f"{P}spPr/{A}gradFill") is not None and touched >= 2

    def _crop_fill(self, pic, W, H):
        iw, ih = pic.image.size
        ra, rb = W / H, iw / ih
        if rb > ra:
            c = (1 - ra / rb) / 2
            pic.crop_left = pic.crop_right = c
        else:
            c = (1 - rb / ra) / 2
            pic.crop_top = pic.crop_bottom = c

    def _fit_safe(self, slide, safe, n):
        X, Y, W, H = self.place(safe, "l", "t")
        right = X + W
        boxes = []
        for el in slide.shapes._spTree:
            if el.tag != f"{P}sp" or shape_name(el).startswith(CHROME_PREFIX) or not text_of(el):
                continue
            off = el.find(f"{P}spPr/{A}xfrm/{A}off"); ext = el.find(f"{P}spPr/{A}xfrm/{A}ext")
            if (off is None or ext is None) and ph_type(el) is not None:
                inh = self._inherited_xfrm(slide, el)
                if inh is not None:
                    spPr = el.find(f"{P}spPr")
                    old = spPr.find(f"{A}xfrm")
                    if old is not None:
                        spPr.remove(old)
                    spPr.insert(0, copy.deepcopy(inh))
                    off = el.find(f"{P}spPr/{A}xfrm/{A}off"); ext = el.find(f"{P}spPr/{A}xfrm/{A}ext")
            if off is not None and ext is not None:
                boxes.append((el, off, ext))
        # text on the art side (the old design had its art elsewhere) moves into the safe area as one
        # block, keeping its alignment; if it would land on other text, it stays and is narrowed
        geo = lambda o, e: (int(o.get("x")), int(o.get("y")), int(e.get("cx")), int(e.get("cy")))
        movers = [(el, o, e) for el, o, e in boxes if geo(o, e)[0] + geo(o, e)[2] / 2 > right and geo(o, e)[0] > X]
        if movers:
            dx = max(geo(o, e)[0] - max(X, right - geo(o, e)[2]) for _, o, e in movers)
            moved = {id(el): max(X, geo(o, e)[0] - dx) for el, o, e in movers}
            def hit(a, b):
                return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
            stay = [geo(o, e) for el, o, e in boxes if id(el) not in moved]
            if not any(hit((moved[id(el)],) + geo(o, e)[1:], s) for el, o, e in movers for s in stay):
                for el, o, e in movers:
                    o.set("x", str(int(moved[id(el)])))
                    self.report["text_boxes_moved"] += 1
            else:
                self.notes.append(f"slide {n}: text sits in the art area and can't move without overlapping; "
                                  f"consider --roles {n}=content")
        for el, off, ext in boxes:
            x, y, w, h = geo(off, ext)
            if x < right and x + w > right:
                neww = max(int(right - x), int(w * 0.35))
                ext.set("cx", str(neww))
                scale = max(0.72, math.sqrt(neww / w))
                if scale < 0.98:
                    # shrink once: scale explicit sizes, or let autofit scale inherited ones
                    explicit = [rp for rp in el.iter(f"{A}rPr", f"{A}endParaRPr") if rp.get("sz")]
                    for rp in explicit:
                        rp.set("sz", str(int(int(rp.get("sz")) * scale)))
                    bp = el.find(f"{P}txBody/{A}bodyPr")
                    if not explicit and bp is not None:
                        for c in list(bp):
                            if etree.QName(c).localname in ("noAutofit", "spAutoFit", "normAutofit"):
                                bp.remove(c)
                        pos = next((i + 1 for i, c in enumerate(bp) if etree.QName(c).localname == "prstTxWarp"), 0)
                        bp.insert(pos, etree.Element(f"{A}normAutofit", fontScale=str(int(scale * 100000))))
                self.report["text_boxes_narrowed"] += 1
            elif x >= right:
                self.notes.append(f"slide {n}: '{text_of(el)[:40]}' sits in the art area; move it by hand or choose another role")

    # 5 contrast ------------------------------------------------------------
    def contrast_pass(self, roles):
        for i, slide in enumerate(self.prs.slides, 1):
            cfg = self.roles_cfg.get(roles[i]) or self.roles_cfg["content"]
            slide_bg = cfg.get("text_bg", bg_color(cfg["background"])).lstrip("#")
            flat = flat_shapes(slide.shapes._spTree)
            under = template_under(slide)
            for k, (el, _) in enumerate(flat):
                if el.tag != f"{P}sp" or el.find(f"{P}txBody") is None:
                    continue
                if shape_name(el).startswith(CHROME_PREFIX) and id(el) not in self._raised:
                    continue
                bg = backdrop(flat, k, slide_bg, self.scheme, under)
                if bg is None:
                    continue
                self._fix_runs(el.find(f"{P}txBody"), bg, title=ph_type(el) in TITLE_PH, slide=i)
            # text kept on the layout (e.g. a "Thank You" box) shows on this slide's ground too
            for k, (el, _) in enumerate(under):
                if el.tag != f"{P}sp" or ph_type(el) is not None or not text_of(el):
                    continue
                bg = backdrop(under, k, slide_bg, self.scheme)
                if bg is not None:
                    self._fix_runs(el.find(f"{P}txBody"), bg, title=False, slide=i)
            for tc in slide.shapes._spTree.iter(f"{A}tc"):
                fill = tc.find(f"{A}tcPr/{A}solidFill/{A}srgbClr")
                bg = fill.get("val") if fill is not None else slide_bg
                tb = tc.find(f"{A}txBody")
                if tb is not None:
                    self._fix_runs(tb, bg, title=False, slide=i)

    def _fix_runs(self, body, bg, title, slide):
        dark_bg = luminance(bg) < 0.18
        default = self.spec["roles"]["title"] if title else self.spec["roles"]["ink"]
        if self.spec.get("dark"):
            default = self.spec["roles"]["title"] if title else self.spec["roles"]["ink"]
        for rpr in list(run_props(body)):
            if rpr.find(f"{A}hlinkClick") is not None and rpr.find(f"{A}solidFill") is None:
                continue  # link in the theme's hlink colour: the brand theme decides it
            sf = rpr.find(f"{A}solidFill")
            cur = None
            if sf is not None and len(sf):
                cur, alpha = resolve_color(sf[0], self.scheme)
                if cur is None or alpha < 0.5:
                    continue
            col = (cur or default.lstrip("#")).lower()
            sz = int(rpr.get("sz", "1800")) / 100
            need = 3.0 if (sz >= 18 or (sz >= 14 and rpr.get("b") == "1")) else 4.5
            if contrast(col, bg) >= need and not (title and dark_bg and col != self.spec["roles"].get("on_dark", "#ffffff").lstrip("#").lower()):
                continue
            pool = self.ondark if dark_bg else self.spec.get("text_colors", {})
            if not dark_bg and self.spec.get("dark"):
                # a light card on a dark brand: its text_colors are all light, so use dark ink
                pool = {"black": "#000000", "surface": self.spec["roles"]["surface"]}
            ok = {k: v for k, v in pool.items() if contrast(v, bg) >= need}
            if not ok:
                ok = {"white": "#ffffff"} if dark_bg else {"ink": "#000000"}
            if title and dark_bg:
                pick = self.spec["roles"].get("on_dark", "#ffffff")
            elif cur is None and not dark_bg:
                pick = self.spec["roles"]["ink"] if contrast(self.spec["roles"]["ink"], bg) >= need else next(iter(ok.values()))
            else:
                m = ColorMapper(ok)
                pick = m.nearest(col)[1]
                if dark_bg and contrast("#ffffff", bg) >= need and chroma(col) < 12:
                    pick = "ffffff"
                elif not dark_bg and chroma(col) < 12 and contrast(self.spec["roles"]["ink"], bg) >= need:
                    pick = self.spec["roles"]["ink"]  # neutral text stays neutral (white -> ink, not a hue)
            self._run_color(rpr, pick)
            self.report["contrast_fixes"] += 1

    def _run_color(self, rpr, hex_):
        set_fill(rpr, hex_, before=("effectLst", "effectDag", "highlight", "uLnTx", "uLn", "uFillTx", "uFill",
                                     "latin", "ea", "cs", "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst"))

    def tables(self):
        t = self.spec.get("table")
        if not t:
            return
        for slide in self.prs.slides:
            for tbl in slide.shapes._spTree.iter(f"{A}tbl"):
                pr = tbl.find(f"{A}tblPr")
                first = pr is not None and pr.get("firstRow") == "1"
                band = pr is not None and pr.get("bandRow") == "1"
                for ri, tr in enumerate(tbl.findall(f"{A}tr")):
                    head = first and ri == 0
                    fill = t["header_fill"] if head else (t["band1"] if (not band or (ri - (1 if first else 0)) % 2 == 0) else t["band2"])
                    for tc in tr.findall(f"{A}tc"):
                        tcpr = tc.find(f"{A}tcPr")
                        if tcpr is None:
                            tcpr = etree.SubElement(tc, f"{A}tcPr")
                        set_fill(tcpr, fill, before=("headers", "extLst"))
                        body = tc.find(f"{A}txBody")
                        if body is None:
                            continue
                        for rpr in run_props(body):
                            self._run_color(rpr, t["header_text"] if head else t["text"])
                            if head and t.get("header_bold"):
                                rpr.set("b", "1")
                    self.report["table_rows_styled"] += 1

    def titles(self, roles):
        title = self.spec["roles"]["title"]
        for i, slide in enumerate(self.prs.slides, 1):
            # A brand may set its cover title apart from content titles (for example, black on a light cover).
            colour = self.spec["roles"].get("cover_title", title) if roles.get(i) == "cover" else title
            for el in slide.shapes._spTree.iter(f"{P}sp"):
                if ph_type(el) not in TITLE_PH:
                    continue
                body = el.find(f"{P}txBody")
                if body is None:
                    continue
                for rpr in run_props(body):
                    self._run_color(rpr, colour)
                    if self.spec.get("no_bold_titles") and rpr.get("b") == "1":
                        rpr.set("b", "0")
                    self.report["title_runs_styled"] += 1

    def run(self, roles):
        self.image_only_slides = {i for i, s in enumerate(self.prs.slides, 1) if image_only(s.shapes._spTree, self.sw, self.sh)}
        self.materialize_footers()
        self.pin_theme_refs()
        self.theme()
        self.default_text()
        self.clean_templates(roles)
        self.recolor_and_fonts()
        self.corners()
        self.titles(roles)
        self.slides(roles)
        self.tables()
        self.contrast_pass(roles)

# ----------------------------------------------------------------- audit
def title_case_issues(text, mode):
    words = re.findall(r"[A-Za-z][A-Za-z'’\-]*", text)
    small = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "via", "with", "from", "into"}
    if not words:
        return False
    if mode == "title":
        return any(w[0].islower() and w.lower() not in small and not re.search(r"[A-Z]", w[1:]) for w in words[1:])
    if mode == "sentence":
        caps = [w for w in words[1:] if w[0].isupper() and w[1:].islower() and len(w) > 3]
        return len(caps) >= max(2, len(words) // 2)
    return False

def check_deck(path, brand, variant, spec, roles=None):
    """`roles` are the slide roles the formatter applied ({slide number: role}). Without them the
    roles are guessed again, which can disagree with what was applied (a title-only slide still
    to be filled in is content, not a divider) and judge a slide against the wrong background."""
    prs = Presentation(path)
    palette = {v.lower().lstrip("#") for v in spec["palette"].values()} | {v.lower().lstrip("#") for v in spec.get("on_dark_colors", {}).values()} | {v.lower().lstrip("#") for v in spec.get("text_colors", {}).values()}
    font = spec.get("font", "Arial")
    res = {"brand": brand["name"], "variant": variant, "slides": [], "summary": Counter()}
    scheme = scheme_of(spec)
    roles = {**classify(prs, {}), **(roles or {})}
    for i, s in enumerate(prs.slides, 1):
        sp = s.shapes._spTree
        issues = []
        if image_only(sp, prs.slide_width, prs.slide_height):
            # left as is on purpose: report it, don't grade it
            res["summary"]["image_only"] += 1
            res["slides"].append({"n": i, "role": roles[i], "issues": [
                {"type": "image_only", "detail": "full-slide picture: not rebrandable, left as is"}]})
            continue
        fonts = {el.get("typeface") for el in sp.iter(f"{A}latin")} - {font, None, ""}
        fonts = {f for f in fonts if not f.startswith("+") and not MONO.search(f) and not SYMBOL.search(f)}
        if fonts:
            issues.append({"type": "font", "detail": sorted(fonts)})
        off = sorted({el.get("val").lower() for el in sp.iter(f"{A}srgbClr") if el.get("val").lower() not in palette
                      and not any(a.tag == f"{P}pic" or shape_name(a).startswith(CHROME_PREFIX) for a in el.iterancestors(f"{P}pic", f"{P}sp", f"{P}grpSp"))})
        if off:
            issues.append({"type": "off_palette_color", "detail": ["#" + c for c in off[:8]]})
        if not any(shape_name(el).startswith(CHROME_PREFIX) for el in sp):
            issues.append({"type": "no_brand_chrome", "detail": "slide has no brand bar/logo/legal from apply-brand"})
        for el in sp.iter(f"{P}sp"):
            if ph_type(el) in TITLE_PH and title_case_issues(text_of(el), spec.get("title_case")):
                issues.append({"type": "title_case", "detail": f"{text_of(el)[:70]} (brand uses {spec.get('title_case')} case)"})
        bad = []
        cfg = spec["slides"].get(roles[i]) or spec["slides"]["content"]
        bg_hex = None
        bgel = s._element.find(f"{P}cSld/{P}bg//{A}srgbClr")
        bg_hex = bgel.get("val") if bgel is not None else bg_color(cfg["background"])
        if s._element.find(f"{P}cSld/{P}bg//{A}gradFill") is not None:
            bg_hex = avg_color({"stops": [[0, "#" + x.get("val")] for x in s._element.find(f"{P}cSld/{P}bg").iter(f"{A}srgbClr")]})
        if cfg.get("text_bg"):
            bg_hex = cfg["text_bg"].lstrip("#")
        flat = flat_shapes(sp)
        under = template_under(s)
        # slide text, then text the layout shows on this slide
        items = [(flat, k, under) for k in range(len(flat))]
        items += [(under, k, ()) for k, (e, _) in enumerate(under) if e.tag == f"{P}sp" and ph_type(e) is None]
        for lst, k, und in items:
            el = lst[k][0]
            if el.tag != f"{P}sp" or shape_name(el).startswith(CHROME_PREFIX):
                continue
            bgc = backdrop(lst, k, bg_hex, scheme, und)
            if bgc is None:
                continue
            for r_ in el.iter(f"{A}r"):
                sf = r_.find(f"{A}rPr/{A}solidFill")
                t = (r_.findtext(f"{A}t") or "").strip()
                if sf is None or not len(sf) or not t:
                    continue
                col, alpha = resolve_color(sf[0], scheme)
                if not col or alpha < 0.5:
                    continue
                if r_.find(f"{A}rPr/{A}hlinkClick") is not None and sf[0].tag == f"{A}schemeClr":
                    continue  # theme-coloured link: the brand's own hlink choice
                rp = r_.find(f"{A}rPr")
                sz = int(rp.get("sz", "1800")) / 100
                need = 3.0 if (sz >= 18 or (sz >= 14 and rp.get("b") == "1")) else 4.5
                cr = contrast(col, bgc)
                if cr < need:
                    bad.append(f"'{t[:30]}' #{col} on #{bgc.lower()} = {cr:.1f}:1 (needs {need})")
        if bad:
            issues.append({"type": "contrast", "detail": bad[:6]})
        for it in issues:
            res["summary"][it["type"]] += 1
        res["slides"].append({"n": i, "role": roles[i], "issues": issues})
    res["summary"] = dict(res["summary"])
    res["pass"] = not any(k in res["summary"] for k in ("font", "off_palette_color", "contrast"))
    return res
