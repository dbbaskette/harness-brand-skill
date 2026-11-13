"""Keep what the Drive export/import round trip would lose.

Google access is Drive only: a deck is exported as .pptx, formatted, and imported as a new
native deck. Two things do not survive that import, however the file is styled:

  icon fonts   Google's importer replaces an icon font with a text font (`Material Icons`
               becomes `Mate`), so every icon shows as its name in serif text, spilling over
               whatever is next to it. Each such icon is uploaded as a picture of the same
               glyph instead: same place, same size, same colour.
  numbering    A numbered list with blank spacer lines between its items is one list in
               Google, but the exported file restarts it at 1 after each blank line. The
               items get explicit numbers.

Both run on the formatted file, after branding, so each picture has the size and colour the
formatter gave the icon (scaled to the brand canvas, contrast already fixed) and the upload is
what the content check of the returned copy expects. Every repair is recorded for the report;
anything that cannot be repaired (an icon font that is not bundled, an unknown icon name) is
recorded as unresolved.
"""
from __future__ import annotations
import io,re,sys
from pathlib import Path
from lxml import etree
sys.path.insert(0,str(Path(__file__).resolve().parent/'vendor'))
import identity_engine as E

PT=12700
FONT_DIR=Path(__file__).resolve().parent/'vendor'/'fonts'
# Icon font family (lower case) -> bundled font file (see vendor/fonts/NOTICE.md) and the height
# of one line of it in Google Slides, in ems, with the glyph at the top of the line. Measured on
# Drive PDF exports of a native deck: 25 icons at 18-24 pt sat 0.135-0.176 em (mean 0.156) above
# the centre of a middle-anchored box, which is a line 1.31 em tall.
ICON_FONTS={'material icons':{'file':'MaterialIcons-Regular.ttf','line':1.31}}
ICON_FONT_NAME=re.compile(r'material (icons|symbols)|font ?awesome|\bicons?\b',re.I)
PIXELS_PER_POINT=8
_FONTS={}


def _font(family,pixels):
    key=(family,pixels)
    if key not in _FONTS:
        from PIL import ImageFont
        _FONTS[key]=ImageFont.truetype(str(FONT_DIR/ICON_FONTS[family]['file']),pixels,layout_engine=ImageFont.Layout.RAQM)
    return _FONTS[key]


def is_icon_name(family,name):
    """True when the font draws `name` as one glyph (its ligature), not as a row of letters."""
    try:
        return _font(family,96).getlength(name,features=['liga'])<=96*1.05
    except (OSError,KeyError,ValueError):
        return False


def draw_icon(family,name,colour,points):
    """A transparent PNG of the icon, one em square, in `colour` (hex)."""
    from PIL import Image,ImageDraw
    side=max(8,round(points*PIXELS_PER_POINT))
    image=Image.new('RGBA',(side,side),(0,0,0,0))
    rgb=tuple(int(colour.lstrip('#')[i:i+2],16) for i in (0,2,4))
    ImageDraw.Draw(image).text((0,0),name,font=_font(family,side),fill=rgb+(255,),features=['liga'])
    out=io.BytesIO();image.save(out,format='PNG');return out.getvalue()


def theme_scheme(slide):
    """Theme colour names -> hex for the slide's theme, through its master's colour map."""
    from pptx.opc.constants import RELATIONSHIP_TYPE as RT
    master=slide.slide_layout.slide_master
    try:
        theme=etree.fromstring(master.part.part_related_by(RT.THEME).blob)
    except KeyError:
        return {}
    scheme={}
    colours=theme.find('.//'+E.A+'clrScheme')
    for slot in (colours if colours is not None else []):
        if len(slot):scheme[etree.QName(slot).localname]=(slot[0].get('val') or slot[0].get('lastClr') or '').lower()
    cmap=master._element.find(E.P+'clrMap')
    for name,default in (('bg1','lt1'),('tx1','dk1'),('bg2','lt2'),('tx2','dk2')):
        scheme[name]=scheme.get(cmap.get(name,default) if cmap is not None else default,'')
    return {k:v for k,v in scheme.items() if v}


def _icon_run(el):
    """(family, name, run properties) when a text box holds exactly one icon name set in an icon
    font; (family, None, None) when it uses an icon font this cannot convert; else None."""
    if el.tag!=E.P+'sp' or el.find(E.P+'txBody') is None:return None
    runs=[r for r in el.iter(E.A+'r') if (r.findtext(E.A+'t') or '').strip()]
    if not runs or any(True for _ in el.iter(E.A+'fld')):return None
    faces={(r.find(E.A+'rPr/'+E.A+'latin').get('typeface','') if r.find(E.A+'rPr/'+E.A+'latin') is not None else '') for r in runs}
    if len(faces)!=1:
        return (next((f for f in faces if ICON_FONT_NAME.search(f)),None),None,None) if any(ICON_FONT_NAME.search(f) for f in faces) else None
    face=next(iter(faces));family=face.lower()
    if not ICON_FONT_NAME.search(face):return None
    name=''.join(r.findtext(E.A+'t') or '' for r in runs).strip()
    paragraphs=[p for p in el.iter(E.A+'p') if E.text_of(p).strip()]
    plain=(family in ICON_FONTS and len(paragraphs)==1 and re.fullmatch(r'[a-z0-9_]+',name)
           and E.ph_type(el) is None and not any(r.find(E.A+'rPr/'+E.A+'hlinkClick') is not None for r in runs)
           and len({r.find(E.A+'rPr').get('sz') for r in runs})==1 and runs[0].find(E.A+'rPr').get('sz')
           and is_icon_name(family,name))
    return (face,name,runs[0].find(E.A+'rPr')) if plain else (face,None,None)


def _picture(ident,name,rid,box):
    nsmap={'p':E.NS['p'],'a':E.NS['a'],'r':E.NS['r']}
    pic=etree.Element(E.P+'pic',nsmap=nsmap)
    nv=etree.SubElement(pic,E.P+'nvPicPr')
    etree.SubElement(nv,E.P+'cNvPr',id=str(ident),name='Icon: '+name,descr=name.replace('_',' ')+' icon')
    locks=etree.SubElement(etree.SubElement(nv,E.P+'cNvPicPr'),E.A+'picLocks');locks.set('noChangeAspect','1')
    etree.SubElement(nv,E.P+'nvPr')
    fill=etree.SubElement(pic,E.P+'blipFill')
    etree.SubElement(fill,E.A+'blip').set(E.R+'embed',rid)
    etree.SubElement(etree.SubElement(fill,E.A+'stretch'),E.A+'fillRect')
    sp=etree.SubElement(pic,E.P+'spPr');xf=etree.SubElement(sp,E.A+'xfrm')
    etree.SubElement(xf,E.A+'off',x=str(round(box[0])),y=str(round(box[1])))
    etree.SubElement(xf,E.A+'ext',cx=str(round(box[2])),cy=str(round(box[3])))
    etree.SubElement(etree.SubElement(sp,E.A+'prstGeom',prst='rect'),E.A+'avLst')
    return pic


def icons_to_pictures(prs,log):
    """Replace each icon-font icon with a picture of the same glyph, where it was."""
    for n,slide in enumerate(prs.slides,1):
        tree=slide.shapes._spTree;scheme=None
        for el,flat in E.flat_shapes(tree):
            found=_icon_run(el)
            if not found:continue
            face,name,props=found;ident=el.find('.//'+E.P+'cNvPr').get('id')
            xf=el.find(E.P+'spPr/'+E.A+'xfrm');own=E.xfrm_box(el)
            if name is None or not own or not flat or xf is None or int(xf.get('rot','0'))%21600000 or not own[2] or not own[3]:
                reason=('not one plain icon name in a bundled icon font' if face and face.lower() in ICON_FONTS
                        else f'the icon font {face} is not bundled') if name is None else 'rotated or unplaced text box'
                log.append({'slide':n,'shape_id':ident,'change':'icon font left as text','status':'unresolved',
                            'detail':f"{reason}; Google's import may show it as text."});continue
            if scheme is None:scheme=theme_scheme(slide)
            fill=props.find(E.A+'solidFill')
            colour=E.resolve_color(fill[0],scheme)[0] if fill is not None and len(fill) else None
            colour=colour or scheme.get('tx1') or '000000'
            points=int(props.get('sz'))/100
            # The glyph is one em square at the top of its line. The line sits in the box by
            # alignment, anchor and insets.
            body=el.find(E.P+'txBody/'+E.A+'bodyPr')
            inset=lambda key,default:int(body.get(key,default)) if body is not None else int(default)
            scale=(own[2]/flat[2],own[3]/flat[3])  # slide EMU -> this shape's own (group) units
            side=(points*PT*scale[0],points*PT*scale[1])
            left,right,top,bottom=inset('lIns','91440')*scale[0],inset('rIns','91440')*scale[0],inset('tIns','45720')*scale[1],inset('bIns','45720')*scale[1]
            para=next((p for p in el.iter(E.A+'p') if E.text_of(p).strip()));pp=para.find(E.A+'pPr')
            align=pp.get('algn','l') if pp is not None else 'l';anchor=body.get('anchor','t') if body is not None else 't'
            x=own[0]+(left if align in ('l','just','dist') else own[2]-right-side[0] if align=='r' else left+(own[2]-left-right-side[0])/2)
            line=side[1]*ICON_FONTS[face.lower()]['line']
            y=own[1]+(top if anchor=='t' else own[3]-bottom-line if anchor=='b' else top+(own[3]-top-bottom-line)/2)
            _,rid=slide.part.get_or_add_image_part(io.BytesIO(draw_icon(face.lower(),name,colour,points)))
            parent=el.getparent()
            framed=E.fill_of(el,scheme)[0]!='none' or (
                (ln:=el.find(E.P+'spPr/'+E.A+'ln')) is not None and ln.find(E.A+'solidFill') is not None)
            if framed:
                # The box itself is a visible chip: keep it, empty, with the icon picture on top.
                for para_el in el.findall(E.P+'txBody/'+E.A+'p'):
                    for child in list(para_el):
                        if child.tag in (E.A+'r',E.A+'br'):para_el.remove(child)
                new_id=max(int(c.get('id')) for c in tree.iter(E.P+'cNvPr') if c.get('id','').isdigit())+1
                parent.insert(parent.index(el)+1,_picture(new_id,name,rid,(x,y,*side)))
            else:
                parent.replace(el,_picture(ident,name,rid,(x,y,*side)))
            log.append({'slide':n,'shape_id':ident,'change':'icon kept as picture','status':'applied',
                        'detail':f"'{name}' ({face}) is uploaded as a picture; Google's import does not keep icon fonts."})


def number_lists(prs,log):
    """Give explicit numbers to numbered items that follow a blank spacer line, so the list
    does not restart at 1 after the import. A line of real text ends the list as before."""
    for n,slide in enumerate(prs.slides,1):
        for body in slide.shapes._spTree.iter(E.P+'txBody',E.A+'txBody'):
            state={};gap=set();fixed=[]
            for para in body.findall(E.A+'p'):
                props=para.find(E.A+'pPr')
                level=int(props.get('lvl','0')) if props is not None else 0
                number=props.find(E.A+'buAutoNum') if props is not None else None
                if number is None:
                    if E.text_of(para).strip():
                        for key in [k for k in state if k>=level]:del state[key];gap.discard(key)
                    else:gap.update(state)
                    continue
                for key in [k for k in state if k>level]:del state[key];gap.discard(key)
                kind=number.get('type','arabicPeriod')
                if number.get('startAt'):count=int(number.get('startAt'))
                elif level in state and state[level][0]==kind:
                    count=state[level][1]
                    if level in gap and count>1:number.set('startAt',str(count));fixed.append(count)
                else:count=1
                state[level]=(kind,count+1);gap.discard(level)
            if fixed:
                owner=next((a for a in body.iterancestors(E.P+'sp',E.P+'graphicFrame')),None)
                cn=owner.find('.//'+E.P+'cNvPr') if owner is not None else None
                log.append({'slide':n,'shape_id':cn.get('id') if cn is not None else None,'change':'list numbering kept','status':'applied',
                            'detail':f'Items after blank spacer lines keep their numbers ({min(fixed)}–{max(fixed)}) instead of restarting at 1. This assumes a blank line inside a numbered list is spacing, not a new list.'})


def prepare(data):
    """Apply the round-trip repairs to formatted .pptx bytes. Returns (bytes, records)."""
    from pptx import Presentation
    prs=Presentation(io.BytesIO(data));log=[]
    icons_to_pictures(prs,log)
    number_lists(prs,log)
    if not any(r['status']=='applied' for r in log):return data,log
    out=io.BytesIO();prs.save(out);return out.getvalue(),log
