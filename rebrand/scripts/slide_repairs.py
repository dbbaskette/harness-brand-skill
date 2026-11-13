"""Keep what the brand pass would otherwise damage.

Applying the identity changes more than colours and fonts: shadows go, corners are squared and
the title and subtitle move to the brand's positions. Three of those steps can break a slide
that was fine, so they are repaired here, as part of branding and not as an optional clean-up:

  round badges   a fully rounded square (a circle in effect) stays round when corners are squared
  outlines       a shape that matched its ground and relied on its shadow gets a hairline outline
  subtitle       an explicit subtitle stays directly under the title, left edges together

Each repair is recorded so the report can list it. General tidying of a deck (text fit,
alignment, spacing) is not done here: that is Harness Slides' review-and-repair workflow.
"""
from __future__ import annotations
import math,re,sys
from pathlib import Path
from lxml import etree
sys.path.insert(0,str(Path(__file__).resolve().parent/'vendor'))
import identity_engine as E
import slide_compliance as C
from brand_config import BRAND,RULES

PT=12700


def _note(log,slide,el,change,detail,applied=True):
    log.append({'slide':slide,'shape_id':C.sid(el) if el is not None else None,'change':change,
                'detail':detail,'status':'applied' if applied else 'unresolved'})


def _chrome(el):
    return E.shape_name(el).startswith(E.CHROME_PREFIX)


def _overlap(a,b):
    return a[0]<b[0]+b[2] and b[0]<a[0]+a[2] and a[1]<b[1]+b[3] and b[1]<a[1]+a[3]


def _rotated(el):
    xf=el.find(E.P+'spPr/'+E.A+'xfrm')
    return xf is not None and int(xf.get('rot','0'))%21600000!=0


# ------------------------------------------------------------------ round badges
def is_round_badge(el):
    """A square rounded rectangle with a full corner radius: drawn as a circle."""
    geom=el.find(E.P+'spPr/'+E.A+'prstGeom');b=E.xfrm_box(el)
    if geom is None or geom.get('prst')!='roundRect' or not b or not b[2] or not b[3]:return False
    adj=next((g.get('fmla','') for g in geom.iter(E.A+'gd') if g.get('name')=='adj'),'val 16667')
    m=re.fullmatch(r'val (\d+)',adj)
    return bool(m) and int(m.group(1))>=45000 and abs(b[2]-b[3])<=.08*max(b[2],b[3])


def keep_round_badges(prs,stats,log):
    """Before corners are squared: make circle-shaped rounded squares true circles, which the
    brand allows (step and letter markers). Pills and rounded cards are still squared."""
    for n,slide in enumerate(prs.slides,1):
        for el in slide.shapes._spTree.iter(E.P+'sp'):
            if _chrome(el) or not is_round_badge(el):continue
            geom=el.find(E.P+'spPr/'+E.A+'prstGeom');geom.set('prst','ellipse')
            for child in list(geom):geom.remove(child)
            etree.SubElement(geom,E.A+'avLst')
            stats['round_badges_kept']+=1
            _note(log,n,el,'round badge kept','A circular badge stays a circle instead of becoming a square.')


# ------------------------------------------------------------------ outlines
def _behind(flat,k,ground,scheme,under):
    """Colour under a shape (not its own fill): the filled shape below its centre, else the ground.
    None when that is a picture, whose colour cannot be measured."""
    el,b=flat[k];cx,cy=b[0]+b[2]/2,b[1]+b[3]/2
    below=list(reversed(flat[:k]))+[(e,q) for e,q in reversed(list(under)) if not (e.tag==E.P+'sp' and E.ph_type(e) is not None)]
    for other,q in below:
        if q is None or not (q[0]<=cx<=q[0]+q[2] and q[1]<=cy<=q[1]+q[3]):continue
        if other.tag==E.P+'pic':
            if _chrome(other):continue
            return None
        kind,colour=E.fill_of(other,scheme,(cx,cy),q)
        if kind=='color':return colour
        if kind=='unknown':return None
    return ground


def line_colour(el,scheme):
    """Visible outline colour of a shape, or None."""
    ln=el.find(E.P+'spPr/'+E.A+'ln')
    if ln is not None:
        if ln.find(E.A+'noFill') is not None or ln.get('w')=='0':return None
        fill=ln.find(E.A+'solidFill')
        if fill is not None and len(fill):
            colour,alpha=E.resolve_color(fill[0],scheme)
            return colour if colour and alpha>=.5 else None
    ref=el.find(E.P+'style/'+E.A+'lnRef')
    if ref is not None and ref.get('idx','0')!='0' and len(ref):
        colour,alpha=E.resolve_color(ref[0],scheme)
        return colour if colour and alpha>=.5 else None
    return None


def _set_line(el,colour,width=9525):
    sp=el.find(E.P+'spPr');ln=sp.find(E.A+'ln')
    if ln is None:
        ln=etree.Element(E.A+'ln')
        later=next((i for i,c in enumerate(sp) if etree.QName(c).localname in ('effectLst','effectDag','scene3d','sp3d','extLst')),len(sp))
        sp.insert(later,ln)
    for child in list(ln):
        if etree.QName(child).localname in ('noFill','solidFill','gradFill','pattFill'):ln.remove(child)
    fill=etree.Element(E.A+'solidFill');etree.SubElement(fill,E.A+'srgbClr',val=colour.lstrip('#').upper())
    ln.insert(0,fill);ln.set('w',str(max(width,int(ln.get('w') or 0))))


def restore_outlines(prs,roles,shadowless,scheme,spec,stats,log):
    """Brand rules remove shadows. A shape the same colour as its ground then disappears unless
    it has an outline that shows; give those a hairline in the brand's light neutral."""
    lost={id(e) for e in shadowless}
    palette=BRAND.get('palette',{})
    for n,slide in enumerate(prs.slides,1):
        tree=slide.shapes._spTree;flat=E.flat_shapes(tree);under=E.template_under(slide)
        ground=E.bg_color((spec['slides'].get(roles[n]) or spec['slides']['content'])['background']).lower()
        for k,(el,b) in enumerate(flat):
            if id(el) not in lost or el.tag!=E.P+'sp' or not b or _chrome(el):continue
            kind,fill=E.fill_of(el,scheme)
            if kind!='color':continue
            behind=_behind(flat,k,ground,scheme,under)
            if behind is None or E.contrast(fill,behind)>=1.15:continue
            line=line_colour(el,scheme)
            if line and E.contrast(line,behind)>=1.3:continue
            colour=palette.get('gray-200','#d1d2d7') if E.luminance(behind)>=.18 else palette.get('gray-400','#a4a5af')
            _set_line(el,colour);stats['outlines_restored']+=1
            _note(log,n,el,'outline restored','Its shadow was removed and it matched the background; a hairline outline keeps it visible.')


# ------------------------------------------------------------------ subtitle under title
def stack_subtitles(prs,roles,title_ids,subtitle_ids,stats,log):
    """An explicit source subtitle belongs directly under the title, left edges together. When
    content already sits in the brand's subtitle slot, the title and subtitle move up together
    (as the source had them) instead of the subtitle jumping sideways. Subtitles lower on the
    slide are body content and are left alone. Returns {slide: {shape ids}} it placed."""
    placed={}
    tb,sb=RULES['title_boxes']['content'],RULES['subtitle_boxes']['content']
    gap=max(2,sb[1]-tb[1]-tb[3])*PT;size=RULES['subtitle_size']
    for n,slide in enumerate(prs.slides,1):
        if roles[n]!='content':continue
        tree=slide.shapes._spTree
        if any(E.shape_name(e)=='source-layout:sidebar' for e in tree):continue
        head=C.shape_with(tree,title_ids.get(n))
        sub=C.shape_with(tree,(subtitle_ids or {}).get(n))
        if head is None or sub is None or not E.text_of(sub).strip() or _rotated(head) or _rotated(sub):continue
        h,s=C.shape_box(head),C.shape_box(sub)
        if not h or not s:continue
        # The template intentionally offsets subtitle x by about 1 pt and overlaps
        # the header boxes slightly; preserve those inspected native slots.
        if RULES.get('alignment_mode')=='text-roles' and all(abs(actual-target*PT)<=PT for actual,target in zip(h[:2],tb[:2])) and all(abs(actual-target*PT)<=PT for actual,target in zip(s[:2],sb[:2])):
            placed.setdefault(n,set()).add(C.sid(sub))
            continue
        if s[1]>h[1]+h[3]+60*PT or s[1]+s[3]<h[1]:continue
        if abs(s[0]-h[0])<=PT and -2*PT<=s[1]-(h[1]+h[3])<=12*PT:continue
        text=E.text_of(sub).strip()
        lines=max(1,math.ceil(C.text_width(text,size)*1.02/max(1,h[2]/PT)))
        height=max(sb[3]*PT,lines*size*1.2*PT)
        others=[b for e in tree if e is not head and e is not sub and not _chrome(e) and C.is_obstacle(e) and (b:=C.shape_box(e))]
        title=h;want=(h[0],h[1]+h[3]+gap,h[2],height)
        blockers=[b for b in others if _overlap(want,b)]
        if blockers:
            top=min(b[1] for b in blockers)-2*PT-height
            title=(h[0],top-gap-h[3],h[2],h[3]);want=(h[0],top,h[2],height)
            if title[1]<8*PT or any(_overlap(want,b) or _overlap(title,b) for b in others):
                _note(log,n,sub,'subtitle not restacked','No clear room under the title without moving content.',False);continue
        C.set_box(sub,want);C.style_text(sub,size,'#000000',False)
        body=sub.find(E.P+'txBody/'+E.A+'bodyPr')
        if body is not None:
            body.set('anchor','t')
            for key in ('lIns','rIns','tIns','bIns'):body.set(key,'0')
        if title is not h:C.set_box(head,title)
        placed.setdefault(n,set()).add(C.sid(sub));stats['subtitles_restacked']+=1
        _note(log,n,sub,'subtitle restacked','Placed directly under the title'+(' (title and subtitle moved up together to clear content).' if title is not h else '.'))
    return placed
