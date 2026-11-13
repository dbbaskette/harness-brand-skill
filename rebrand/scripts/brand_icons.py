"""Local approved icon search, preview and inspected replacement; no model or network calls."""
from __future__ import annotations
import argparse,copy,hashlib,io,json,math,re,sys,zipfile
from functools import lru_cache
from pathlib import Path
from lxml import etree
from PIL import Image,ImageDraw,ImageChops
from brand_config import ICON_LIBRARY,RULES
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
P='{http://schemas.openxmlformats.org/presentationml/2006/main}'
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

def sha(data):return hashlib.sha256(data).hexdigest()

@lru_cache(maxsize=1)
def library():
    with zipfile.ZipFile(ICON_LIBRARY) as z:
        about=json.loads(z.read('library.json'));icons=json.loads(z.read('icons.json'))['icons']
    if about['kind']!='glyph':raise ValueError('Expected the bundled functional glyph library.')
    return {about['id']+'.'+i['slug']:i for i in icons}


def search(query,limit=5):
    words=lambda s:re.findall(r'[a-z0-9]+',s.lower())
    terms=words(query)
    if not terms:raise ValueError('Enter an icon concept to search.')
    ranked=[]
    for ident,icon in library().items():
        name=words(icon['name']);all_words=words(' '.join([icon['name'],icon['category'],icon['slug'],*icon.get('keywords',[])]))
        if all(any(w==t if len(t)<3 else w.startswith(t) for w in all_words) for t in terms):
            score=(100 if name==terms else 0)+sum(t in name for t in terms)*10-len(name)/100
            ranked.append((score,ident,icon))
    return [{'id':ident,'name':i['name'],'category':i['category']} for _,ident,i in sorted(ranked,key=lambda r:(-r[0],r[1]))[:limit]]


def segments(path):
    tokens=re.findall(r'[MLCQZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?',path)
    if re.sub(r'[\s,]','',path)!=''.join(tokens):raise ValueError('Unsupported icon path syntax.')
    arity={'M':2,'L':2,'C':6,'Q':4,'Z':0};at=0
    while at<len(tokens):
        op=tokens[at];at+=1
        if op not in arity:raise ValueError('Icon paths must use explicit absolute commands.')
        count=arity[op];nums=list(map(float,tokens[at:at+count]));at+=count
        if len(nums)!=count or not all(math.isfinite(x) for x in nums):raise ValueError('Invalid icon coordinates.')
        yield op,list(zip(nums[::2],nums[1::2]))


def paint(icon,style=None,color=None,size=256):
    """Rasterize the same catalog paths for Docs/previews, preserving even-odd holes."""
    style=style or RULES['icon_style'];color=color or RULES['icon_color']
    if style not in ('solid','ring','glyph'):raise ValueError('Icon style must be solid, ring or glyph.')
    scale=4;side=size*scale;factor=side/100;inset=12 if style!='glyph' else 0
    point=lambda p:((inset+p[0]*(1-2*inset/100))*factor,(inset+p[1]*(1-2*inset/100))*factor)
    mask=Image.new('1',(side,side));last=(0,0)
    for path in icon['paths']:
        pathmask=Image.new('1',(side,side));polygon=[]
        def flush():
            nonlocal pathmask,polygon
            if len(polygon)>2:
                piece=Image.new('1',(side,side));ImageDraw.Draw(piece).polygon([point(p) for p in polygon],fill=1)
                pathmask=ImageChops.logical_xor(pathmask,piece)
            polygon=[]
        for op,points in segments(path):
            if op=='M':flush();last=points[0];polygon=[last]
            elif op=='L':last=points[0];polygon.append(last)
            elif op in ('C','Q'):
                start=last
                for j in range(1,17):
                    t=j/16;u=1-t
                    if op=='C':p=tuple(u**3*start[k]+3*u*u*t*points[0][k]+3*u*t*t*points[1][k]+t**3*points[2][k] for k in (0,1))
                    else:p=tuple(u*u*start[k]+2*u*t*points[0][k]+t*t*points[1][k] for k in (0,1))
                    polygon.append(p)
                last=points[-1]
            else:flush()
        flush();mask=ImageChops.logical_or(mask,pathmask)
    image=Image.new('RGBA',(side,side));draw=ImageDraw.Draw(image)
    if style=='solid':draw.ellipse((0,0,side-1,side-1),fill=color)
    elif style=='ring':draw.ellipse((factor,factor,side-factor,side-factor),outline=color,width=round(3*factor))
    ink=Image.new('RGBA',(side,side),'white' if style=='solid' else color);image.paste(ink,(0,0),mask)
    stream=io.BytesIO();image.resize((size,size),Image.Resampling.LANCZOS).save(stream,format='PNG');return stream.getvalue()


def svg_geometry(icon):
    geom=etree.Element(A+'custGeom')
    for tag in ('avLst','gdLst','ahLst','cxnLst'):etree.SubElement(geom,A+tag)
    etree.SubElement(geom,A+'rect',l='0',t='0',r='r',b='b');paths=etree.SubElement(geom,A+'pathLst')
    for path in icon['paths']:
        el=etree.SubElement(paths,A+'path',w='100000',h='100000')
        for op,points in segments(path):
            step=etree.SubElement(el,A+{'M':'moveTo','L':'lnTo','C':'cubicBezTo','Q':'quadBezTo','Z':'close'}[op])
            for x,y in points:etree.SubElement(step,A+'pt',x=str(round(x*1000)),y=str(round(y*1000)))
    return geom


def native_icon(ident,box,shape_id,next_id,style,color):
    x,y,w,h=box;side=min(w,h);x+=round((w-side)/2);y+=round((h-side)/2)
    group=etree.Element(P+'grpSp');nv=etree.SubElement(group,P+'nvGrpSpPr')
    etree.SubElement(nv,P+'cNvPr',id=str(shape_id),name='icon:'+ident,descr=library()[ident]['name'])
    etree.SubElement(nv,P+'cNvGrpSpPr');etree.SubElement(nv,P+'nvPr')
    xf=etree.SubElement(etree.SubElement(group,P+'grpSpPr'),A+'xfrm')
    for tag,values in [('off',{'x':x,'y':y}),('ext',{'cx':side,'cy':side}),('chOff',{'x':0,'y':0}),('chExt',{'cx':100000,'cy':100000})]:
        etree.SubElement(xf,A+tag,**{k:str(v) for k,v in values.items()})
    def shape(name,geometry,fill,inset=0,outline=False):
        nonlocal next_id
        e=etree.SubElement(group,P+'sp');nv=etree.SubElement(e,P+'nvSpPr');next_id+=1
        etree.SubElement(nv,P+'cNvPr',id=str(next_id),name=name);etree.SubElement(nv,P+'cNvSpPr');etree.SubElement(nv,P+'nvPr')
        sp=etree.SubElement(e,P+'spPr');xf=etree.SubElement(sp,A+'xfrm');etree.SubElement(xf,A+'off',x=str(inset),y=str(inset));etree.SubElement(xf,A+'ext',cx=str(100000-2*inset),cy=str(100000-2*inset));sp.append(geometry)
        if outline:etree.SubElement(sp,A+'noFill')
        else:etree.SubElement(etree.SubElement(sp,A+'solidFill'),A+'srgbClr',val=fill.lstrip('#'))
        line=etree.SubElement(sp,A+'ln',w='25400')
        if outline:etree.SubElement(etree.SubElement(line,A+'solidFill'),A+'srgbClr',val=color.lstrip('#'))
        else:etree.SubElement(line,A+'noFill')
    if style!='glyph':
        geom=etree.Element(A+'prstGeom',prst='ellipse');etree.SubElement(geom,A+'avLst');shape('Icon container',geom,color,outline=style=='ring')
    shape('Approved functional glyph',svg_geometry(library()[ident]),'#ffffff' if style=='solid' else color,12000 if style!='glyph' else 0)
    return group


def fingerprint(shape,slide):
    blip=shape.find('.//'+A+'blip')
    if shape.tag==P+'pic' and blip is not None:return sha(slide.part.rels[blip.get(R+'embed')].target_part.blob)
    return sha(etree.tostring(shape,method='c14n'))


def eligible(shape,slide):
    from brand_slides import engine as E
    if shape.tag not in (P+'pic',P+'sp',P+'grpSp') or E.text_of(shape).strip():return False
    if any(True for _ in shape.iter(P+'cxnSp',P+'graphicFrame',A+'hlinkClick',A+'hlinkMouseOver')):return False
    if any(int(x.get('rot','0')) or x.get('flipH') in ('1','true') or x.get('flipV') in ('1','true') for x in shape.iter(A+'xfrm')):return False
    ids={e.get('id') for e in shape.iter(P+'cNvPr')}
    if any(e.get('id') in ids for e in slide.shapes._spTree.iter(A+'stCxn',A+'endCxn')):return False
    if shape.tag!=P+'pic' and shape.find('.//'+A+'blip') is not None:return False
    b=E.xfrm_box(shape)
    return bool(b and min(b[2:])>0 and max(b[2:])<=180*12700)


def inspect(data):
    if 'ppt/presentation.xml' in zipfile.ZipFile(io.BytesIO(data)).namelist():
        from pptx import Presentation
        from brand_slides import engine as E
        return [{'slide':n,'shape_id':str(s.shape_id),'name':s.name,'expected_sha256':fingerprint(s._element,slide),'box_pt':[round(v/12700,2) for v in E.xfrm_box(s._element)]} for n,slide in enumerate(Presentation(io.BytesIO(data)).slides,1) for s in slide.shapes if eligible(s._element,slide)]
    from docx import Document
    from docx.oxml.ns import qn
    doc=Document(io.BytesIO(data));result=[]
    for drawing in doc.element.iter(qn('wp:inline')):
        prop=drawing.find(qn('wp:docPr'));blip=drawing.find('.//'+qn('a:blip'));ext=drawing.find(qn('wp:extent'))
        if prop is not None and blip is not None and ext is not None and max(int(ext.get(k)) for k in ('cx','cy'))<=180*12700:
            result.append({'drawing_id':prop.get('id'),'name':prop.get('name'),'expected_sha256':sha(doc.part.related_parts[blip.get(qn('r:embed'))].blob)})
    return result


def replace(data,mapping):
    entries=mapping.get('replacements') if isinstance(mapping,dict) else None
    if not isinstance(entries,list) or not 1<=len(entries)<=100:raise ValueError('Icon map requires 1–100 inspected replacements.')
    candidates=inspect(data);seen=set();records=[]
    slides='ppt/presentation.xml' in zipfile.ZipFile(io.BytesIO(data)).namelist()
    if slides:
        from pptx import Presentation
        doc=Presentation(io.BytesIO(data))
        from brand_slides import engine as E
    else:
        from docx import Document
        from docx.oxml.ns import qn
        doc=Document(io.BytesIO(data))
    for entry in entries:
        ident=entry.get('icon');style=entry.get('style',RULES['icon_style']);color=RULES['icon_color']
        if ident not in library() or style not in ('solid','ring','glyph'):raise ValueError('Unknown approved icon or treatment.')
        keys=('slide','shape_id') if slides else ('drawing_id',)
        if not all(k in entry for k in keys):raise ValueError('Icon replacement target is missing.')
        key=tuple(str(entry[k]) for k in keys)
        if key in seen:raise ValueError('Duplicate icon target.')
        seen.add(key)
        item=next((c for c in candidates if tuple(str(c[k]) for k in keys)==key),None)
        if item is None or entry.get('expected_sha256')!=item['expected_sha256']:raise ValueError('Icon target is unsafe, missing or changed; inspect the current source.')
        if slides:
            slide=doc.slides[int(entry['slide'])-1];tree=slide.shapes._spTree
            old=next(s._element for s in slide.shapes if str(s.shape_id)==str(entry['shape_id']))
            maximum=max(int(e.get('id')) for e in tree.iter(P+'cNvPr'))
            new=native_icon(ident,E.xfrm_box(old),entry['shape_id'],maximum,style,color);tree.replace(old,new)
        else:
            drawing=next(e for e in doc.element.iter(qn('wp:inline')) if e.find(qn('wp:docPr')).get('id')==str(entry['drawing_id']))
            if any(e.tag==qn('a:hlinkClick') for e in drawing.iter()):raise ValueError('Linked document images are not replaceable icons.')
            extent=drawing.find(qn('wp:extent'))
            # Keep the original frame and transparent-pad the square glyph; no stretch/reflow.
            w,h=[int(extent.get(k)) for k in ('cx','cy')];side=512
            glyph=Image.open(io.BytesIO(paint(library()[ident],style,color,side)))
            dimensions=(round(side*w/min(w,h)),round(side*h/min(w,h)))
            if max(dimensions)>4096:raise ValueError('Icon frame is too elongated.')
            frame=Image.new('RGBA',dimensions)
            frame.alpha_composite(glyph,((frame.width-side)//2,(frame.height-side)//2));png=io.BytesIO();frame.save(png,format='PNG');png.seek(0)
            rid,_=doc.part.get_or_add_image(png);drawing.find('.//'+qn('a:blip')).set(qn('r:embed'),rid)
        records.append({**{k:entry[k] for k in keys},'icon':ident,'style':style,'original_sha256':item['expected_sha256']})
    stream=io.BytesIO();doc.save(stream);out=stream.getvalue()
    from brand_ooxml import content_manifest
    before=content_manifest(data);after=content_manifest(out)
    if slides:
        for a,b in zip(before['slides'],after['slides']):
            for key in ('text','links','notes','tables'):
                if a.get(key)!=b.get(key):raise ValueError('Icon replacement altered business content.')
    else:
        if before!=after:raise ValueError('Icon replacement changed document content or picture count.')
    return out,records


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    s=sub.add_parser('search');s.add_argument('query');s.add_argument('--limit',type=int,default=5)
    s=sub.add_parser('preview');s.add_argument('id');s.add_argument('--out',required=True);s.add_argument('--style',choices=['solid','ring','glyph'])
    s=sub.add_parser('inspect');s.add_argument('source')
    a=p.parse_args(argv)
    if a.command=='search':result=search(a.query,min(20,max(1,a.limit)))
    elif a.command=='inspect':result=inspect(Path(a.source).read_bytes())
    else:
        if a.id not in library():p.error('Unknown approved icon ID.')
        with Path(a.out).open('xb') as f:f.write(paint(library()[a.id],a.style))
        result={'id':a.id,'preview':str(Path(a.out).resolve()),'name':library()[a.id]['name']}
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
