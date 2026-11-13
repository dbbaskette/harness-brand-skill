"""Content-preserving visual rules and explicit exceptions against the complete brand book."""
from __future__ import annotations
import copy, math, re, json, hashlib
from collections import Counter
from pathlib import Path
from lxml import etree
from pptx import Presentation
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.opc.packuri import PackURI
from pptx.util import Pt
import identity_engine as E

ROOT=Path(__file__).resolve().parents[1]
from brand_config import BRAND,PROFILE,RULES
LAYOUT=RULES['layouts']


def sid(el):
    cn=el.find('.//'+E.P+'cNvPr')
    return cn.get('id') if cn is not None else None


def shape_with(tree,ident):
    """The top-level shape with this id, or None. A missing id never matches: the tree's own
    property elements have no id either, and must not be mistaken for a title or subtitle."""
    return next((e for e in tree if sid(e)==ident),None) if ident is not None else None


def heading(slide):
    candidates=[e for e in slide.shapes._spTree if e.tag==E.P+'sp' and E.text_of(e).strip() and not E.shape_name(e).startswith(E.CHROME_PREFIX) and E.ph_type(e) not in E.FOOTER_PH]
    if not candidates:return None
    titles=[e for e in candidates if E.ph_type(e) in E.TITLE_PH]
    candidates=titles or [e for e in candidates if len(E.text_of(e).split())<=24]
    return min(candidates,key=lambda e:(E.xfrm_box(e) or (0,10**12,0,0))[1]) if candidates else None


def is_statistic(el,scale=1.0):
    """A large number in the title placeholder ("90%") is the slide's statistic, not its heading.
    Treated as a heading it would be shrunk to title size, moved to the top and lose its weight.
    `scale` converts the source's point sizes to the brand canvas."""
    sizes=[int(r.get('sz','0')) for r in E.run_props(el)]
    return (bool(re.fullmatch(r'[\d\s.,%+$×x:/−–-]+',E.text_of(el).strip())) and bool(sizes)
            and min(sizes)*scale>=150*RULES['title_size'])


def roles_for(prs):
    """Preserve source roles; deck position alone never makes a cover.

    Sparse title-only/blank slides are ambiguous and remain content. A real
    cover needs a title layout or centered-title placeholder, without body
    content. This also protects excerpt decks beginning with cards or tables.
    """
    roles={}
    for n,slide in enumerate(prs.slides,1):
        tree=slide.shapes._spTree
        texts=[e for e in tree.iter(E.P+'sp') if E.text_of(e).strip()
               and E.ph_type(e) not in E.FOOTER_PH and not E.LEGAL.search(E.text_of(e))
               and not E.shape_name(e).startswith(E.CHROME_PREFIX)]
        visuals=[e for e in tree if e.tag in (E.P+'pic',E.P+'graphicFrame',E.P+'grpSp')]
        def lines(e):return len([p for p in e.iter(E.A+'p') if E.text_of(p).strip()])
        # A title may break over two or three lines ("FUEL:" / "How to sell ..."); any other
        # text on a cover, divider or closing slide is a single paragraph, never a list.
        compact=all(lines(e)<=(3 if E.ph_type(e) in E.TITLE_PH else 1) for e in texts)
        words=sum(len(E.text_of(e).split()) for e in texts)
        lname=(slide.slide_layout.name or '').lower()
        lt=E.layout_type(slide)
        content_layout=bool(E.CONTENT_LAYOUT.search(lname)) or lt in ('obj','tx','twoObj','twoTx')
        body=any(E.ph_type(e) in ('body','obj') for e in texts)
        structured=any(True for _ in tree.iter(E.P+'graphicFrame')) or any(
            E.text_of(e).strip() for e in tree if e.tag==E.P+'grpSp')
        simple=0<len(texts)<=2 and compact and words<=32
        cover_layout=(lt=='title' or any(E.ph_type(e)=='ctrTitle' for e in texts)
                      or bool(re.search(r'^(title\s*\d|title slide|cover|title\s*-)',lname)))
        cover=cover_layout and not content_layout and not re.search(r'only|content|column',lname)
        cover=cover and simple and not body and not structured
        text=' '.join(E.text_of(e) for e in texts).strip().lower()
        closing=simple and not visuals and n==len(prs.slides) and bool(
            re.fullmatch(r'(thank you[!.]?|questions[?]?|q\s*&\s*a)',text))
        divider=(lt=='secHead' or bool(re.search(r'section|divider|breaker|chapter',lname)))
        section=simple and not visuals and not body and not content_layout and divider
        roles[n]='closing' if closing else 'cover' if cover else 'section' if section else 'content'
    return roles


def preserve_layout_text(prs,roles):
    """Retain authored layout text before the corporate layout is replaced."""
    for n,slide in enumerate(prs.slides,1):
        if roles[n]!='content':continue
        tree=slide.shapes._spTree;layout=slide.slide_layout
        existing={E.text_of(e).strip() for e in tree if E.text_of(e).strip()}
        ident=max(int(e.get('id')) for e in tree.iter(E.P+'cNvPr'))
        for el in layout.shapes._spTree:
            text=E.text_of(el).strip();b=shape_box(el)
            geom=el.find(E.P+'spPr/'+E.A+'prstGeom')
            thin_bar=b and b[2]>.2*prs.slide_width and b[3]<=4*12700 and geom is not None and geom.get('prst')=='rect'
            rule=not text and (el.tag==E.P+'cxnSp' or geom is not None and geom.get('prst')=='line' or thin_bar)
            if el.tag not in (E.P+'sp',E.P+'cxnSp') or E.ph_type(el) is not None:continue
            if not text and not rule or text and text in existing:continue
            if E.LEGAL.search(text) or E.is_slide_number_box(el) or not b or b[1]>=.925*prs.slide_height:continue
            if rule and not (.03*prs.slide_width<=b[0] and b[0]+b[2]<=.97*prs.slide_width and .15*prs.slide_height<=b[1]):continue
            clone=copy.deepcopy(el)
            for cn in clone.iter(E.P+'cNvPr'):
                ident+=1;cn.set('id',str(ident));cn.set('name','source-layout:'+cn.get('name','text'))
            for node in clone.iter():
                for key,val in list(node.attrib.items()):
                    if key.startswith(E.R):
                        rel=layout.part.rels[val]
                        node.set(key,slide.part.relate_to(rel.target_ref if rel.is_external else rel.target_part,rel.reltype,rel.is_external))
            # Layout shapes sit behind slide shapes in the source stacking order.
            tree.insert(2,clone);existing.add(text)


def preserve_sidebar_layouts(prs,roles):
    """Materialize content-bearing sidebar layouts before replacing their master.

    Keep the source's column grouping and functional icons, but replace its large
    decorative bitmap with a flat brand panel. Footer/logo artwork is excluded.
    """
    for n,slide in enumerate(prs.slides,1):
        if roles[n]!='content':continue
        tree=slide.shapes._spTree;layout=slide.slide_layout
        textboxes=[shape_box(e) for e in tree if E.text_of(e).strip() and shape_box(e)]
        candidates=[]
        for el in layout.shapes._spTree:
            b=shape_box(el);g=el.find(E.P+'spPr/'+E.A+'prstGeom')
            if E.ph_type(el) or E.text_of(el).strip() or not b or g is None or g.get('prst')!='rect':continue
            if el.find(E.P+'spPr/'+E.A+'solidFill') is None:continue
            if b[0]>.02*prs.slide_width or b[1]>.02*prs.slide_height or not .25*prs.slide_width<=b[2]<=.4*prs.slide_width or b[3]<.8*prs.slide_height:continue
            inside=sum(b[0]<=t[0]+t[2]/2<=b[0]+b[2] for t in textboxes)
            if inside>=3 and len(textboxes)-inside>=4:candidates.append(el)
        if len(candidates)!=1:continue
        panel=candidates[0];box=shape_box(panel);copies=[]
        ident=max(int(e.get('id')) for e in tree.iter(E.P+'cNvPr'))
        existing={E.text_of(e).strip() for e in tree if E.text_of(e).strip()}
        for el in layout.shapes._spTree:
            b=shape_box(el);text=E.text_of(el).strip()
            if E.ph_type(el) or not b:continue
            if el is not panel and (b[1] if text else b[1]+b[3])>.925*prs.slide_height:continue
            if E.LEGAL.search(text):continue
            rect=el.find(E.P+'spPr/'+E.A+'prstGeom')
            band=(not text and rect is not None and rect.get('prst')=='rect' and b[0]>=box[0] and b[0]+b[2]<=box[0]+box[2]+12700 and el.find(E.P+'spPr/'+E.A+'solidFill') is not None)
            icon=el.tag==E.P+'pic' and 0<=b[1] and b[2]*b[3]<.005*prs.slide_width*prs.slide_height
            icon_holder=not text and rect is not None and rect.get('prst')=='ellipse' and b[2]*b[3]<.005*prs.slide_width*prs.slide_height
            if not (el is panel or band or icon or icon_holder or text and text not in existing):continue
            clone=copy.deepcopy(el)
            for cn in clone.iter(E.P+'cNvPr'):
                ident+=1;cn.set('id',str(ident));cn.set('name','source-layout:sidebar' if el is panel else 'source-layout:'+cn.get('name','content'))
            for node in clone.iter():
                for key,val in list(node.attrib.items()):
                    if key.startswith(E.R):
                        rel=layout.part.rels[val]
                        node.set(key,slide.part.relate_to(rel.target_ref if rel.is_external else rel.target_part,rel.reltype,rel.is_external))
            if icon and b[1]<.15*prs.slide_height:
                # Fine white glyphs disappear when rasterized at their tiny source size.
                scale=22*12700/max(b[2],b[3])
                if scale>1:set_box(clone,(b[0]-(scale-1)*b[2]/2,b[1]-(scale-1)*b[3]/2,b[2]*scale,b[3]*scale))
            if el is panel or band or icon_holder:
                sp=clone.find(E.P+'spPr')
                for fill in list(sp):
                    if etree.QName(fill).localname in ('solidFill','gradFill','pattFill','blipFill','noFill'):sp.remove(fill)
                sp.append(E.solid(RULES['dark_backdrop'] if el is panel or icon_holder else RULES['light_backdrop']))
            if el is panel:set_box(clone,(box[0],box[1],box[2],.925*prs.slide_height-box[1]))
            copies.append(clone)
        for i,el in enumerate(copies):tree.insert(2+i,el)


def set_box(el,box):
    x=el.find(E.P+'spPr/'+E.A+'xfrm')
    if x is None:x=el.find(E.P+'xfrm')
    if x is None:return False
    for name,keys,vals in [('off',('x','y'),box[:2]),('ext',('cx','cy'),box[2:])]:
        child=x.find(E.A+name)
        if child is None:child=etree.SubElement(x,E.A+name)
        for key,val in zip(keys,vals):child.set(key,str(round(val)))
    return True


def shape_box(el):
    b=E.xfrm_box(el)
    # Google exports some tables with dummy 3,000,000-EMU extents; use actual cells.
    table=el.find('.//'+E.A+'tbl') if el.tag==E.P+'graphicFrame' else None
    if b and table is not None:
        width=sum(int(e.get('w','0')) for e in table.findall(E.A+'tblGrid/'+E.A+'gridCol'))
        height=sum(int(e.get('h','0')) for e in table.findall(E.A+'tr'))
        if width and height:b=(*b[:2],width,height)
    return b


def materialize_font_sizes(prs):
    """Pin inherited sizes before removing source placeholder/master relationships."""
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.is_placeholder and shape._element.find(E.P+'spPr/'+E.A+'xfrm') is None:
                set_shape_geometry(shape)
        for el in slide.shapes._spTree.iter(E.P+'sp'):
            ph=el.find('.//'+E.P+'ph');kind=E.ph_type(el)
            ancestors=[]
            if ph is not None:
                for page in (slide.slide_layout,slide.slide_layout.slide_master):
                    candidates=list(page.shapes._spTree.iter(E.P+'sp'))
                    # Slide→layout uses idx; layout→master uses placeholder type.
                    match=next((x for x in candidates if (q:=x.find('.//'+E.P+'ph')) is not None and E.ph_type(x)==kind and (page is slide.slide_layout.slide_master or q.get('idx','0')==ph.get('idx','0'))),None)
                    if match is not None:ancestors.append(match)
            style='titleStyle' if kind in E.TITLE_PH else 'bodyStyle' if kind=='body' else 'otherStyle'
            master=slide.slide_layout.slide_master._element.find(E.P+'txStyles/'+E.P+style)
            default=prs._element.find(E.P+'defaultTextStyle')
            for para in el.iter(E.A+'p'):
                pp=para.find(E.A+'pPr');level=int(pp.get('lvl','0'))+1 if pp is not None else 1
                candidates=[para.find(E.A+'pPr/'+E.A+'defRPr'),el.find(E.P+'txBody/'+E.A+'lstStyle/'+E.A+f'lvl{level}pPr/'+E.A+'defRPr')]
                for parent in ancestors:
                    candidates.extend([parent.find(E.P+'txBody/'+E.A+'p/'+E.A+'pPr/'+E.A+'defRPr'),parent.find(E.P+'txBody/'+E.A+'lstStyle/'+E.A+f'lvl{level}pPr/'+E.A+'defRPr')])
                for parent in (master,default):
                    if parent is not None:candidates.append(parent.find(E.A+f'lvl{level}pPr/'+E.A+'defRPr'))
                size=next((c.get('sz') for c in candidates if c is not None and c.get('sz')), '1800')
                for rp in [*E.run_props(para),*para.findall(E.A+'endParaRPr')]:
                    if rp.get('sz') is None:rp.set('sz',size)
                    for attr in ('b','i'):
                        value=next((c.get(attr) for c in candidates if c is not None and c.get(attr) is not None),None)
                        if rp.get(attr) is None and value is not None:rp.set(attr,value)


def free_header_box(box,obstacles,text,size):
    """Find a horizontal interval for a header without moving existing artwork."""
    x,y,w,h=box;intervals=[(x,x+w)]
    for b in obstacles:
        if not b or b[1]>=y+h or b[1]+b[3]<=y:continue
        left,right=b[0]-8*12700,b[0]+b[2]+8*12700
        intervals=[piece for a,z in intervals for piece in ((a,min(z,left)),(max(a,right),z)) if piece[1]-piece[0]>=text_width(text,size)*12700]
    return (intervals[0][0],y,intervals[0][1]-intervals[0][0],h) if intervals else None


def attach_template(prs,roles,stats):
    """Use the supplied master/layout parts, retaining source slides and their relationships."""
    target=Presentation(PROFILE/'template.pptx')
    for entry in list(target.slides._sldIdLst):
        target.part.drop_rel(entry.rId);target.slides._sldIdLst.remove(entry)
    layouts={l.name:l for l in target.slide_masters[RULES['master_index']].slide_layouts}
    # Use one slide-local dynamic number, avoiding inherited duplicates.
    for page in [*target.slide_masters,*target.slide_layouts]:
        for el in list(page.shapes._spTree):
            if E.ph_type(el)=='sldNum' or E.is_slide_number_box(el):page.shapes._spTree.remove(el)
    # Each special layout has its own legal line; the content layout uses the master line.
    # Move that line to Title Only so covered master text is neither duplicated nor audited as visible.
    for master in target.slide_masters:
        for el in list(master.shapes._spTree):
            if E.LEGAL.search(E.text_of(el)):
                layouts[LAYOUT['content']].shapes._spTree.append(copy.deepcopy(el));master.shapes._spTree.remove(el)
    if RULES.get('clean_template_text'):
        # Imported templates contain sample headings and duplicate legacy legal lines.
        legal=next((copy.deepcopy(e) for e in layouts[LAYOUT['cover']].shapes._spTree if E.LEGAL.search(E.text_of(e)) and '2026' in E.text_of(e)),None)
        for page in [*target.slide_masters,*target.slide_layouts,*layouts.values()]:
            for e in list(page.shapes._spTree):
                if E.text_of(e).strip() and E.ph_type(e) not in E.TITLE_PH|{'subTitle','body'}:page.shapes._spTree.remove(e)
        if legal is not None:
            for name in set(LAYOUT.values()):
                tree=layouts[name].shapes._spTree;clone=copy.deepcopy(legal)
                clone.find('.//'+E.P+'cNvPr').set('id',str(max(int(e.get('id')) for e in tree.iter(E.P+'cNvPr'))+1))
                tree.append(clone)
    for el in layouts[LAYOUT['cover']].shapes._spTree:
        if el.find(E.P+'spPr/'+E.A+'custGeom') is not None and el.find(E.P+'spPr/'+E.A+'gradFill') is not None:
            cn=el.find('.//'+E.P+'cNvPr');cn.set('name','brand:template-frame')
    old_slides=list(prs.slides)
    # Disjoint OPC names avoid collisions with template media, notes, layouts and themes.
    for part in list(prs.part.package.iter_parts()):
        name=str(part.partname);parent,base=name.rsplit('/',1)
        part.partname=PackURI(parent+'/source_'+base)
    sx=target.slide_width/prs.slide_width;sy=target.slide_height/prs.slide_height
    text_scale=min(sx,sy)
    if abs(text_scale-1)<.001:text_scale=1
    for n,slide in enumerate(old_slides,1):
        tree=slide.shapes._spTree
        for shape in slide.shapes:
            if shape.is_placeholder and shape._element.find(E.P+'spPr/'+E.A+'xfrm') is None:
                set_shape_geometry(shape)
        # Preserve explicit source geometry, scale once to the approved 13.33 x 7.5 canvas.
        for el in tree.iter():
            if el.tag in (E.A+'off',E.A+'chOff'):
                for key,scale in [('x',sx),('y',sy)]:
                    if el.get(key) is not None:el.set(key,str(round(int(el.get(key))*scale)))
            elif el.tag in (E.A+'ext',E.A+'chExt'):
                for key,scale in [('cx',sx),('cy',sy)]:
                    if el.get(key) is not None:el.set(key,str(round(int(el.get(key))*scale)))
            elif el.tag in (E.A+'rPr',E.A+'defRPr',E.A+'endParaRPr') and el.get('sz'):
                el.set('sz',str(round(int(el.get('sz'))*text_scale)))
            elif el.tag in (E.A+'spcPts',E.A+'buSzPts') and el.get('val'):
                el.set('val',str(round(int(el.get('val'))*text_scale)))
            elif el.tag in (E.A+'bodyPr',E.A+'pPr',E.A+'tcPr'):
                for key in ('lIns','rIns','marL','marR','indent','marT','marB','tIns','bIns'):
                    if el.get(key) is not None:el.set(key,str(round(int(el.get(key))*text_scale)))
            elif el.tag==E.A+'gridCol':el.set('w',str(round(int(el.get('w'))*sx)))
            elif el.tag==E.A+'tr':el.set('h',str(round(int(el.get('h'))*sy)))
        # The actual template owns logo/background/footer. Keep only the dynamic slide number.
        for el in list(tree):
            if E.shape_name(el).startswith(E.CHROME_PREFIX) and E.shape_name(el)!='brand:slide-number':tree.remove(el)
        cs=slide._element.find(E.P+'cSld');bg=cs.find(E.P+'bg')
        if bg is not None:cs.remove(bg)
        # Source placeholders must not inherit an unrelated index from the new master.
        for el in tree.iter(E.P+'sp'):
            kind=E.ph_type(el)
            default=RULES['display_size'] if kind in E.TITLE_PH and roles[n]!='content' else RULES['title_size'] if kind in E.TITLE_PH else RULES['subtitle_size'] if kind=='subTitle' else RULES['body_size']
            for rp in E.run_props(el):
                if rp.get('sz') is None:rp.set('sz',str(default*100))
        for ph in list(tree.iter(E.P+'ph')):ph.getparent().remove(ph)
        for rel in list(slide.part.rels.values()):
            if rel.reltype==RT.SLIDE_LAYOUT:slide.part.drop_rel(rel.rId)
        layout=layouts[LAYOUT[roles[n]]]
        # Imported dark dividers can inherit black legal text from the light master.
        if roles[n]=='section' and RULES['section_text_color']=='#ffffff':
            for el in layout.shapes._spTree:
                if E.LEGAL.search(E.text_of(el)):style_text(el,color='#ffffff')
        slide.part.relate_to(layout.part,RT.SLIDE_LAYOUT)
        slide._element.set('showMasterSp','1')
        target.slides._sldIdLst.add_sldId(target.part.relate_to(slide.part,RT.SLIDE))
        stats['official_layouts_attached']+=1
        if roles[n]=='section' and RULES.get('section_image'):
            # The template reserves a picture placeholder; use its approved section photograph.
            x,y,w,h=RULES['section_image_box']
            pic=slide.shapes.add_picture(str(PROFILE/RULES['section_image']),Pt(x),Pt(y),Pt(w),Pt(h))
            pic.name='brand:section-image'
            E.Restyler._crop_fill(None,pic,w,h)
            if RULES.get('exact_template'):
                from template_alignment import section_frame
                section_frame(Presentation(PROFILE/'template.pptx'),slide)
    return target


def set_shape_geometry(shape):
    b=(shape.left,shape.top,shape.width,shape.height)
    sp=shape._element.find(E.P+'spPr')
    if sp is None:return
    x=etree.SubElement(sp,E.A+'xfrm')
    etree.SubElement(x,E.A+'off',x=str(b[0]),y=str(b[1]))
    etree.SubElement(x,E.A+'ext',cx=str(b[2]),cy=str(b[3]))


def style_text(el,size=None,color=None,bold=None):
    body=el.find(E.P+'txBody')
    if body is None:body=el.find(E.A+'txBody')
    if body is None:return
    for rp in E.run_props(body):
        if size is not None:rp.set('sz',str(round(size*100)))
        if bold is not None:rp.set('b','1' if bold else '0')
        rp.set('i','0')
        for kind in ('latin','ea','cs'):
            font=rp.find(E.A+kind)
            if font is None:font=etree.SubElement(rp,E.A+kind)
            if not E.SYMBOL.search(font.get('typeface','')):font.set('typeface',BRAND['font'])
        if color:
            for fill in list(rp.findall(E.A+'solidFill')):rp.remove(fill)
            rp.insert(0,E.solid(color))
    bp=body.find(E.A+'bodyPr')
    if bp is not None:
        # Changing a colour or font must not move centered labels to the top.
        for af in list(bp) if size is not None else []:
            if etree.QName(af).localname in ('normAutofit','spAutoFit'):bp.remove(af)


def text_width(text,size):
    # Conservative font width measurement for deciding whether a title can stay one line.
    try:
        from PIL import ImageFont
        font=ImageFont.truetype(str(Path('/System/Library/Fonts/Supplemental')/RULES.get('font_files',{}).get('regular',BRAND['font']+'.ttf')),round(size*4))
        return font.getlength(text)/4
    except OSError:
        return sum(.28 if c in ' il.,:;!|' else .83 if c in 'MW@' else .54 for c in text)*size


def is_obstacle(el):
    if E.text_of(el).strip() or el.tag in (E.P+'pic',E.P+'graphicFrame',E.P+'grpSp'):return True
    sp=el.find(E.P+'spPr')
    return sp is not None and any(sp.find(E.A+kind) is not None for kind in ('solidFill','gradFill','blipFill','pattFill'))


def fit_label_padding(el,stats):
    """Recover usable space for a short label without changing type or shape size."""
    body=el.find(E.P+'txBody/'+E.A+'bodyPr');b=shape_box(el)
    xf=el.find(E.P+'spPr/'+E.A+'xfrm')
    if xf is not None and int(xf.get('rot','0'))%21600000:return
    if body is None or b is None or b[2]>120*12700 or b[3]>45*12700:return
    paragraphs=[p for p in el.iter(E.A+'p') if E.text_of(p).strip()]
    sizes=[int(r.get('sz','1100'))/100 for r in E.run_props(el)]
    if len(paragraphs)!=1 or not sizes or min(sizes)<11 or max(sizes)>15:return
    text=E.text_of(el).strip()
    if len(text.split())>5:return
    for axis,extent,required in [('horizontal',b[2]/12700,text_width(text,max(sizes))*(1.25 if any(r.get('b')=='1' for r in E.run_props(el)) else 1.05)),('vertical',b[3]/12700,max(sizes)*1.2)]:
        keys=('lIns','rIns') if axis=='horizontal' else ('tIns','bIns')
        current=sum(int(body.get(k,'91440'))/12700 for k in keys)
        if extent-current<required<=extent-6:
            for k in keys:body.set(k,str(3*12700))
            stats['label_padding_fitted']+=1


def visual_rules(prs,roles,title_ids,stats,subtitle_ids=None,shadowless=None):
    """Apply safe role styles; retain dense or semantic constructions and report them later."""
    for n,slide in enumerate(prs.slides,1):
        tree=slide.shapes._spTree;role=roles[n]
        sidebar=any(E.shape_name(e)=='source-layout:sidebar' for e in tree)
        head=shape_with(tree,title_ids.get(n))
        # Only explicit source subtitles can be repositioned as subtitles. Nearby
        # questions, column headers and diagram labels retain their relationships.
        subtitle=shape_with(tree,(subtitle_ids or {}).get(n))
        # Consistent brand font, no italics/shadows; no stretching or repainting bitmap contents.
        for el in tree.iter(E.P+'sp',E.P+'graphicFrame'):
            if E.shape_name(el).startswith('brand:'):continue
            for effect in list(el.iter(E.A+'outerShdw',E.A+'innerShdw',E.A+'prstShdw')):
                effect.getparent().remove(effect);stats['shadows_removed']+=1
                # A shape that relied on its shadow may now need an outline (slide_repairs).
                if shadowless is not None and el.tag==E.P+'sp' and el not in shadowless:shadowless.append(el)
            for rp in el.iter(E.A+'rPr',E.A+'defRPr',E.A+'endParaRPr'):
                rp.set('i','0')
                for font in rp.findall(E.A+'latin')+rp.findall(E.A+'ea')+rp.findall(E.A+'cs'):
                    if not E.SYMBOL.search(font.get('typeface','')) and font.get('typeface')!=BRAND['font']:font.set('typeface',BRAND['font']);stats['all_text_fonts_normalized']+=1
                if rp.find(E.A+'hlinkClick') is not None:rp.set('u','sng')
            if role=='content' and el.tag==E.P+'sp' and el is not head and el is not subtitle:
                text=E.text_of(el).strip()
                metric=bool(re.fullmatch(r'[\d\s.,%+$×x:/−–-]+',text))
                if not metric:
                    sizes=[int(rp.get('sz','1800')) for rp in E.run_props(el)]
                    dense=sizes and min(sizes)>=1100 and max(sizes)<=1500 and len(text.split())>150 and (body_box:=shape_box(el)) and body_box[3]>.65*prs.slide_height
                    if dense and not RULES.get('exact_template'):
                        # Compact existing dense case-study copy without collapsing
                        # larger text into this treatment. Keep body reduction <10%.
                        for para in el.iter(E.A+'p'):
                            header=len(E.text_of(para).split())<=3
                            for space in para.findall(E.A+'pPr/'+E.A+'lnSpc/'+E.A+'spcPct'):space.set('val','100000')
                            for space in para.findall(E.A+'pPr/'+E.A+'spcBef/'+E.A+'spcPts'):space.set('val',str(min(600,int(space.get('val','0')))))
                            for rp in E.run_props(para):
                                if header:rp.set('sz','1500')
                                elif 1200>=int(rp.get('sz'))*.9:rp.set('sz','1200')
                        stats['dense_body_12pt']+=1
                    for rp in E.run_props(el):
                        if not RULES.get('exact_template') and int(rp.get('sz','1300'))>100*RULES['header_size']:
                            target=100*(RULES['header_size'] if rp.get('b')=='1' else RULES['body_size'])
                            if target>int(rp.get('sz')) or target<int(rp.get('sz'))*.9:
                                stats['hierarchy_sizes_preserved']+=1;continue
                            rp.set('sz',str(target));stats['body_ramp_applied']+=1
            if role=='content' and el.tag==E.P+'sp' and el is not head and el is not subtitle:
                if not any(r.get('b')=='1' for r in E.run_props(el)):fit_label_padding(el,stats)
                label=E.text_of(el).strip();b=shape_box(el);body=el.find(E.P+'txBody/'+E.A+'bodyPr')
                sizes=[int(r.get('sz','1100'))/100 for r in E.run_props(el)]
                xf=el.find(E.P+'spPr/'+E.A+'xfrm')
                rotated=xf is not None and int(xf.get('rot','0'))%21600000
                if not rotated and b and body is not None and sizes and 11<=min(sizes) and max(sizes)<=11/.75 and b[2]<=120*12700 and b[3]<=45*12700 and len(label.split())<=5 and '\n' not in label:
                    available=(b[2]-int(body.get('lIns','91440'))-int(body.get('rIns','91440')))/12700
                    # Bold width allowance; reduce only to the prescribed detail size when it fits.
                    if text_width(label,max(sizes))*1.25>available>=text_width(label,11)*1.25:
                        style_text(el,size=11);stats['diagram_labels_fit_at_detail_size']+=1
                fit_label_padding(el,stats)
        if sidebar:
            for el in tree:
                b=shape_box(el);text=E.text_of(el).strip()
                if el is not head and b and 0<len(text.split())<=5 and b[1]<.15*prs.slide_height and b[3]<60*12700:
                    style_text(el,size=15,bold=True)
                elif el is not head and text and b and b[0]>.33*prs.slide_width and b[3]>.4*prs.slide_height:
                    # The target font may be wider than many source serif faces; retain list scanability.
                    style_text(el,size=12)
                    bp=el.find(E.P+'txBody/'+E.A+'bodyPr')
                    if bp is not None:
                        for key in ('lIns','rIns'):bp.set(key,str(6*12700))
        if head is not None and sidebar:
            sizes=[int(r.get('sz','0')) for r in E.run_props(head)]
            style_text(head,size=RULES['title_size'] if sizes and min(sizes)>=RULES['title_size']*100 else None,color='#ffffff',bold=False)
            stats['sidebar_title_hierarchy_preserved']+=1
        if head is not None and not sidebar:
            title=E.text_of(head).strip()
            if role=='content':
                target=tuple(RULES['title_boxes'][role])
                size=RULES['title_size'];color=RULES['title_colors'][role]
            else:
                target=tuple(RULES['title_boxes'][role])
                if role=='section' and subtitle is None and RULES.get('section_title_height'):target=(*target[:3],RULES['section_title_height'])
                size=RULES['display_size'];color=RULES['title_colors'][role]
            old=shape_box(head)
            obstacles=[shape_box(e) for e in tree if e is not head and e is not subtitle and not E.shape_name(e).startswith('brand:') and is_obstacle(e)]
            box=tuple(v*12700 for v in target)
            overlap=lambda a,b:a[0]<b[0]+b[2] and b[0]<a[0]+a[2] and a[1]<b[1]+b[3] and b[1]<a[1]+a[3]
            safe=role in ('section','closing') or not any(b and overlap(box,b) for b in obstacles)
            if not safe and role=='content':
                alternative=free_header_box(box,obstacles,title,size)
                if alternative:box=alternative;safe=True;stats['titles_shifted_around_artwork']+=1
            max_lines=4 if role=='section' and subtitle is None else 2 if role!='content' else 1
            if safe and text_width(title,size)<=target[2]*max_lines:
                set_box(head,box);style_text(head,size,color,False);stats['title_ramp_applied']+=1
                bp=head.find(E.P+'txBody/'+E.A+'bodyPr')
                if bp is not None:
                    bp.set('anchor','t')
                    for k in ('lIns','rIns','tIns','bIns'):bp.set(k,'0')
            else:
                # Keep the original position if the required size fits there safely.
                fits=old and text_width(title,size)<=old[2]/12700 and old[3]/12700>=size*1.15
                style_text(head,size if fits else None,color,bold=False)
                stats['titles_preserved_to_avoid_collision']+=1
        if subtitle is not None and role=='cover' and head is not None and (hb:=shape_box(head)) and abs(hb[0]-RULES['title_boxes']['cover'][0]*12700)>12700:
            style_text(subtitle,RULES.get('display_subtitle_size',RULES['subtitle_size']),'#000000',False);subtitle=None
        if subtitle is not None and role in ('cover','content'):
            subtitle_size=RULES.get('display_subtitle_size',RULES['subtitle_size']) if role=='cover' else RULES['subtitle_size']
            b=RULES['subtitle_boxes'][role]
            box=tuple(v*12700 for v in b)
            others=[shape_box(e) for e in tree if e is not head and e is not subtitle and not E.shape_name(e).startswith('brand:') and is_obstacle(e)]
            overlap=lambda a,b:a[0]<b[0]+b[2] and b[0]<a[0]+a[2] and a[1]<b[1]+b[3] and b[1]<a[1]+a[3]
            available=free_header_box(box,others,E.text_of(subtitle),subtitle_size)
            if available is None and role=='content':
                available=free_header_box(tuple(v*12700 for v in (36,72,prs.slide_width/12700-72,22)),others,E.text_of(subtitle),subtitle_size)
            if available is not None:
                box=available
                set_box(subtitle,box);style_text(subtitle,subtitle_size,'#000000',False);stats['subtitle_ramp_applied']+=1
                bp=subtitle.find(E.P+'txBody/'+E.A+'bodyPr')
                if bp is not None:
                    bp.set('anchor','t')
                    for k in ('lIns','rIns','tIns','bIns'):bp.set(k,'0')
        for label in (head,subtitle):
            if label is not None:
                for spacing in label.iter(E.A+'spcPts'):
                    if spacing.getparent().tag in (E.A+'spcBef',E.A+'spcAft'):spacing.set('val','0')
        # Simple section slides can use the actual divider without reorganizing a diagram.
        if role=='section':
            remaining=[e for e in tree if e.tag==E.P+'sp' and e is not head and E.text_of(e).strip() and not E.shape_name(e).startswith('brand:')]
            for j,el in enumerate(remaining):
                x,y,w,h=RULES['section_text_box']
                set_box(el,tuple(v*12700 for v in (x,y+j*(h+6),w,h)))
                style_text(el,RULES.get('display_subtitle_size',RULES['subtitle_size']),RULES['section_text_color'],False)
        # Proper total rows and role colors on genuine data tables. Syntax tables are excluded.
        tables=[(e,shape_box(e)) for e in tree.iter(E.P+'graphicFrame') if e.find('.//'+E.A+'tbl') is not None]
        for table in tree.iter(E.A+'tbl'):
            if table.find('.//'+E.A+'highlight') is not None:continue
            frame=next((e for e,b in tables if e.find('.//'+E.A+'tbl') is table),None)
            box=shape_box(frame) if frame is not None else None
            columns=[e.get('w') for e in table.findall(E.A+'tblGrid/'+E.A+'gridCol')]
            continuation=box is not None and any(e is not frame and b and abs(b[0]-box[0])<2*12700 and abs(b[2]-box[2])<2*12700 and abs(b[1]+b[3]-box[1])<2*12700 and [c.get('w') for c in e.findall('.//'+E.A+'tblGrid/'+E.A+'gridCol')]==columns for e,b in tables)
            rows=table.findall(E.A+'tr')
            for i,row in enumerate(rows):
                total=bool(re.match(r'^\s*(total|grand total)\b',E.text_of(row),re.I))
                header=i==0 and not continuation
                fill=RULES['table_total'] if total else BRAND['table']['header_fill' if header else 'band1' if i%2 else 'band2']
                for cell in row.findall(E.A+'tc'):
                    props=cell.find(E.A+'tcPr')
                    if props is None:props=etree.SubElement(cell,E.A+'tcPr')
                    E.set_fill(props,fill,before=('headers','extLst'))
                    style_text(cell,color='#ffffff' if header or total else BRAND['roles']['ink'],bold=header or total)
                stats['table_role_rows_styled']+=1


def scale_text_metrics(root,scale):
    """Group transforms scale boxes, but renderers do not consistently scale type."""
    for el in root.iter():
        if el.tag in (E.A+'rPr',E.A+'defRPr',E.A+'endParaRPr') and el.get('sz'):
            el.set('sz',str(round(int(el.get('sz'))*scale)))
        elif el.tag in (E.A+'spcPts',E.A+'buSzPts') and el.get('val'):
            el.set('val',str(round(int(el.get('val'))*scale)))
        elif el.tag in (E.A+'bodyPr',E.A+'pPr',E.A+'tcPr'):
            for key in ('lIns','rIns','tIns','bIns','marL','marR','marT','marB','indent'):
                if el.get(key):el.set(key,str(round(int(el.get(key))*scale)))


def fit_single_line(el,stats):
    """Recover small font width differences in unambiguous one-line text boxes."""
    from PIL import ImageFont
    paras=list(el.iter(E.A+'p'));body=el.find(E.P+'txBody/'+E.A+'bodyPr')
    xf=el.find(E.P+'spPr/'+E.A+'xfrm')
    if len(paras)!=1 or body is None or xf is None or el.find('.//'+E.A+'br') is not None or el.find('.//'+E.A+'fld') is not None:return
    ext=xf.find(E.A+'ext')
    if ext is None:return
    props=list(E.run_props(el));sizes={int(r.get('sz','0')) for r in props}
    if len(sizes)!=1 or not props:return
    size=next(iter(sizes))/100
    width=int(ext.get('cx'))/12700;height=int(ext.get('cy'))/12700
    if size<11 or height>size*1.65:return  # Existing multi-line/dense copy is not a label.
    available=width-sum(int(body.get(k,'91440'))/12700 for k in ('lIns','rIns'))
    if available<=0:return
    measured=0
    for run in paras[0].findall(E.A+'r'):
        rp=run.find(E.A+'rPr');latin=rp.find(E.A+'latin') if rp is not None else None
        if latin is not None and E.SYMBOL.search(latin.get('typeface','')):return
        bold=rp is not None and rp.get('b')=='1'
        path=Path('/System/Library/Fonts/Supplemental')/RULES.get('font_files',{}).get('bold' if bold else 'regular',BRAND['font']+(' Bold.ttf' if bold else '.ttf'))
        try:font=ImageFont.truetype(str(path),round(size*4))
        except OSError:return  # No guessed fitting when actual font metrics are unavailable.
        measured+=font.getlength(run.findtext(E.A+'t') or '')/4
    if available<measured*1.015<=available/.9:
        scale=available/(measured*1.015)
        for rp in el.iter(E.A+'rPr',E.A+'defRPr',E.A+'endParaRPr'):
            if rp.get('sz'):rp.set('sz',str(round(int(rp.get('sz'))*scale)))
        stats['single_line_fit']+=1


def fit_content(prs,roles,title_ids,stats,keep=None):
    """`keep` is {slide: {shape ids}} of header text already placed (a restacked subtitle) that
    must stay with the title, outside the fitted content group."""
    for n,slide in enumerate(prs.slides,1):
        if roles.get(n)!='content':continue
        tree=slide.shapes._spTree
        if any(E.shape_name(e)=='source-layout:sidebar' for e in tree):
            # Keep the sidebar anchored; nudge a bottom tag row above the new footer.
            tags=[(e,b) for e in tree if not E.shape_name(e).startswith('brand:') and (b:=shape_box(e)) and b[0]>.4*prs.slide_width and b[1]>.75*prs.slide_height]
            excess=max((b[1]+b[3]-RULES['content_bottom']*12700 for e,b in tags),default=0)
            if 0<excess<=12*12700:
                for e,b in tags:set_box(e,(b[0],b[1]-excess,b[2],b[3]))
                stats['sidebar_footer_tags_nudged']+=1
            stats['sidebar_geometry_preserved']+=1;continue
        content=[e for e in tree if e.tag in (E.P+'sp',E.P+'pic',E.P+'grpSp',E.P+'graphicFrame',E.P+'cxnSp')
                 and sid(e)!=title_ids.get(n) and not E.shape_name(e).startswith('brand:')
                 and sid(e) not in (keep or {}).get(n,())
                 and not ((b:=shape_box(e)) and (
                     (e.tag==E.P+'sp' and 72<=b[1]/12700<=80 and b[3]<=30*12700)
                     or (not E.text_of(e).strip() and b[1]<72*12700 and b[3]<80*12700 and b[2]<.2*prs.slide_width)))]
        boxes=[shape_box(e) for e in content]
        boxes=[b for b in boxes if b and b[2]>0 and b[3]>0 and b[0]<prs.slide_width and b[1]<prs.slide_height]
        if not boxes:continue
        x=min(b[0] for b in boxes);y=min(b[1] for b in boxes)
        r=max(b[0]+b[2] for b in boxes);bottom=max(b[1]+b[3] for b in boxes)
        margin=RULES['margin']*12700;limit=RULES['content_bottom']*12700
        if x>=margin and r<=prs.slide_width-margin and bottom<=limit:continue
        scale=min(1,(prs.slide_width-2*margin)/(r-x),(limit-y)/(bottom-y))
        if scale<.90:
            stats['content_fit_requires_review']+=1;continue
        left=max(margin,min(x,prs.slide_width-margin-(r-x)*scale))
        group=etree.Element(E.P+'grpSp');nv=etree.SubElement(group,E.P+'nvGrpSpPr')
        ident=max(int(e.get('id')) for e in tree.iter(E.P+'cNvPr'))+1
        etree.SubElement(nv,E.P+'cNvPr',id=str(ident),name='Brand content fit')
        etree.SubElement(nv,E.P+'cNvGrpSpPr');etree.SubElement(nv,E.P+'nvPr')
        gp=etree.SubElement(group,E.P+'grpSpPr');xf=etree.SubElement(gp,E.A+'xfrm')
        etree.SubElement(xf,E.A+'off',x=str(round(left)),y=str(round(y)))
        etree.SubElement(xf,E.A+'ext',cx=str(round((r-x)*scale)),cy=str(round((bottom-y)*scale)))
        etree.SubElement(xf,E.A+'chOff',x=str(round(x)),y=str(round(y)))
        etree.SubElement(xf,E.A+'chExt',cx=str(round(r-x)),cy=str(round(bottom-y)))
        # Preserve z-order of all content; the title does not overlap by construction.
        for el in content:
            if scale<1:scale_text_metrics(el,scale)
            group.append(el)
        tree.insert(2,group);stats['content_groups_fit_to_margins']+=1
        # The image panel moved with the body; keep its overlaid title inside it.
        head=shape_with(tree,title_ids.get(n))
        hb=shape_box(head) if head is not None else None
        if hb:
            for el,b in E.flat_shapes(tree):
                if el.tag==E.P+'pic' and b and b[0]<=hb[0]+hb[2]/2<=b[0]+b[2] and b[1]<=hb[1]+hb[3]/2<=b[1]+b[3]:
                    if hb[0]<b[0]+12*12700:
                        set_box(head,(b[0]+12*12700,hb[1],min(hb[2],b[2]-24*12700),hb[3]));stats['photo_titles_inset']+=1
                    break


def audit(prs,roles,title_ids,stats):
    issues=[]
    def issue(slide,rule,detail):issues.append({'slide':slide,'rule':rule,'detail':detail})
    image_slides=[]
    content_layouts=[LAYOUT['content']]
    allowed_sizes={RULES['subtitle_size'],28,40}
    if RULES.get('template_contract'):
        template=Presentation(PROFILE/'template.pptx')
        contract=RULES['template_contract']
        content_layouts += [template.slides[i-1].slide_layout.name for i in contract['samples'].values()]
        allowed_sizes.update(contract.get('text_roles',{}).values())
        allowed_sizes.update(contract['body_levels'])
        allowed_sizes.update(v for levels in contract['column_levels'].values() for v in levels)
        allowed_sizes.update((RULES['title_size'],RULES['display_size']))
    for n,slide in enumerate(prs.slides,1):
        role=roles[n];tree=slide.shapes._spTree
        if slide.slide_layout.name not in (content_layouts if role=='content' else [LAYOUT[role]]):issue(n,'template_layout','Approved layout is missing.')
        head=shape_with(tree,title_ids.get(n))
        if head is None:issue(n,'title','No unambiguous existing title; adding one requires authorship.')
        else:
            sizes={int(e.get('sz'))/100 for e in head.iter(E.A+'rPr') if e.get('sz')}
            required=RULES['title_size'] if role=='content' else RULES['display_size']
            if sizes!={required}:issue(n,'title_size',f'Expected {required} pt; retained sizes to avoid collision or overflow.')
            if role=='content' and (b:=shape_box(head)) and any(abs(v-w)>12700 for v,w in zip(b[:2],tuple(v*12700 for v in RULES['title_boxes']['content'][:2]))):issue(n,'title_position','Title retained outside the prescribed top-left position.')
            if E.title_case_issues(E.text_of(head),'sentence'):issue(n,'sentence_case_review','Review title casing while preserving product names and acronyms; no automatic rewriting.')
        if role=='content':
            # Do not manufacture a takeaway subtitle from body copy.
            # In the brand's subtitle slot, or stacked directly under a title that kept its own place.
            hb=shape_box(head) if head is not None else None
            stacked=lambda b:bool(hb) and abs(b[0]-hb[0])<=12700 and -2*12700<=b[1]-(hb[1]+hb[3])<=12*12700 and b[3]/12700<=60
            subtitles=[e for e,b in E.flat_shapes(tree) if e is not head and e.tag==E.P+'sp' and E.text_of(e).strip() and not E.shape_name(e).startswith('brand:') and b and ((58<=b[1]/12700<=80 and b[3]/12700<=36) or stacked(b))]
            if any((b:=next((box for e,box in E.flat_shapes(tree) if e is sub),None)) and abs(b[1]/12700-RULES['subtitle_boxes']['content'][1])>1 for sub in subtitles):issue(n,'subtitle_spacing','Subtitle baseline is lowered slightly to avoid overlap at the prescribed type sizes.')
            if not subtitles and not RULES.get('exact_template'):issue(n,'subtitle','Existing one-line point-making subtitle not identified; author input required.')
        for el,b in E.flat_shapes(tree):
            if E.shape_name(el).startswith('brand:'):continue
            text=E.text_of(el).strip()
            if el.tag==E.P+'pic':image_slides.append(n)
            b=shape_box(el) if el.getparent() is tree else b
            if b and role=='content' and (text or el.tag in (E.P+'pic',E.P+'graphicFrame')):
                if b[0]<(RULES['margin']-1)*12700 or b[0]+b[2]>prs.slide_width-(RULES['margin']-1)*12700 or b[1]+b[3]>RULES['content_bottom']*12700:
                    issue(n,'content_bounds','Some original content exceeds the prescribed margins/footer boundary.')
            g=el.find(E.P+'spPr/'+E.A+'prstGeom')
            if g is not None and (('Arrow' in g.get('prst','')) or g.get('prst') in ('chevron','hexagon','ellipse')):
                issue(n,'diagram_geometry','Original nonrectangular diagram/icon geometry needs semantic review.')
            if text:
                small=[e for e in el.iter(E.A+'rPr') if e.get('sz') and int(e.get('sz'))<100*RULES['detail_size'] and not E.shape_name(el).startswith('brand:')]
                sizes={int(e.get('sz'))/100 for e in el.iter(E.A+'rPr') if e.get('sz')}
                if role=='content' and sid(el)!=title_ids.get(n) and ((RULES.get('exact_template') and any(v not in allowed_sizes for v in sizes)) or (not RULES.get('exact_template') and any(v>RULES['header_size'] and v not in (RULES['subtitle_size'],28,40) for v in sizes))):issue(n,'body_type_ramp','Source body/header sizes outside the standard ramp remain; role classification needs review.')
                if small:issue(n,'small_text',f"Original text below {RULES['detail_size']} pt remains; enlarging requires layout review (sources/labels may be exempt).")
                for p in el.iter(E.A+'p'):
                    words=len(E.text_of(p).split())
                    if words>15:issue(n,'copy_density','Long source paragraph retained; shortening would change content.');break
        if any(E.shape_name(e)=='Brand content fit' for e in tree):issue(n,'effective_type_size','A minor uniform fit preserves diagram relationships; rendered type sizes need review.')
        if role=='section' and RULES['chapter_metadata']:issue(n,'chapter_metadata','Chapter locator/step metadata cannot be invented from the source.')
    if image_slides:issue(None,'approved_imagery',f'Original imagery on {len(set(image_slides))} slides is preserved; library provenance and embedded styling are not verified.')
    # Deduplicate repeated findings; never convert unchecked requirements into a full pass.
    unique={(x['slide'],x['rule'],x['detail']):x for x in issues};issues=list(unique.values())
    titles={str(n):{'id':title_ids[n],'text_sha256':hashlib.sha256(E.text_of(el).encode()).hexdigest()} for n,slide in enumerate(prs.slides,1) if n in title_ids for el in slide.shapes._spTree.iter(E.P+'sp') if sid(el)==title_ids[n]}
    return {'status':'exceptions' if issues else 'checked_visual_rules_pass','titles':titles,
            'full_compliance':False,
            'scope':'Visual rules checked; semantic component/imagery approval and editorial rules need human review.',
            'finding_groups':__import__('reporting').categorize({'exceptions':issues}),
            'rules_source':str(PROFILE/'rules.md'),'roles':{str(k):v for k,v in roles.items()},
            'summary':dict(Counter(x['rule'] for x in issues)),'exceptions':issues}
