"""Formatting-only OOXML pass for the project-free Google Drive round trip."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from brand_config import BRAND
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
NS = {'a': A, 'p': P, 'w': W, 'r': R}
SYMBOL = re.compile(r'wingdings|webdings|symbol|marlett|emoji|font awesome|material icons', re.I)
MAX_EXPANDED = 256 * 1024 * 1024


def tag(ns, name):
    return '{' + ns + '}' + name


def rgb(h):
    return tuple(int(h.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))


def nearest(h):
    if not re.fullmatch(r'#?[a-fA-F0-9]{6}', h):
        return h
    src = rgb(h)
    return min(BRAND['palette'].values(), key=lambda c: sum((x-y)**2 for x,y in zip(src, rgb(c)))).lstrip('#').upper()


def xml(data):
    # OOXML does not need DTDs/entities; reject them before parsing.
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('XML entities/DTDs are not supported.')
    namespaces = {}
    for _, pair in ET.iterparse(io.BytesIO(data), events=['start-ns']):
        prefix, uri = pair
        if prefix in namespaces and namespaces[prefix] != uri:
            raise ValueError('Conflicting XML namespace aliases are not supported.')
        namespaces[prefix] = uri
    return ET.fromstring(data), namespaces


def serialize(root, namespaces):
    used = {name.split('}', 1)[0][1:] for e in root.iter() for name in [e.tag, *e.attrib] if name.startswith('{')}
    for prefix, uri in namespaces.items():
        if not re.fullmatch(r'ns\d+', prefix):
            ET.register_namespace(prefix, uri)
        # Preserve aliases referenced only in mc:Ignorable or QName attributes.
        if uri not in used:
            root.set('xmlns' + (':' + prefix if prefix else ''), uri)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


def unpack(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        info = archive.infolist()
        if len(info) > 10000 or sum(x.file_size for x in info) > MAX_EXPANDED:
            raise ValueError('Office export exceeds the supported expanded size.')
        names = [x.filename for x in info]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate Office package entries are not supported.')
        if any(x.startswith('/') or '..' in x.split('/') for x in names):
            raise ValueError('Unsafe Office package path.')
        return {x.filename: archive.read(x) for x in info}, info


def relationships(parts, part):
    path = posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part)+'.rels')
    if path not in parts:
        return {}
    root, _ = xml(parts[path])
    return {e.get('Id'): dict(e.attrib) for e in root}


def target_part(part, target):
    return posixpath.normpath(posixpath.join(posixpath.dirname(part), target)).lstrip('/')


def slide_parts(parts):
    root, _ = xml(parts['ppt/presentation.xml'])
    rels = relationships(parts, 'ppt/presentation.xml')
    return [target_part('ppt/presentation.xml', rels[e.get(tag(R, 'id'))]['Target'])
            for e in root.findall('./p:sldIdLst/p:sldId', NS)]


def text_blocks(root, namespace):
    result = []
    for paragraph in root.iter(tag(namespace, 'p')):
        text = ''
        for e in paragraph.iter():
            if e.tag == tag(namespace, 't'):
                text += e.text or ''
            elif e.tag == tag(namespace, 'tab'):
                text += '\t'
            elif e.tag in (tag(namespace, 'br'), tag(namespace, 'cr')):
                text += '\n'
        if text:
            result.append(text)
    return result


def links(parts, part):
    # Relationship IDs can change in Google's conversion; targets are semantic.
    rels = relationships(parts, part)
    return sorted(r['Target'] for r in rels.values() if r.get('Type', '').endswith('/hyperlink'))


def slide_links(parts, part, root):
    """What each link on a slide points at and which words carry it: sorted [target, text] pairs.

    One pair per linked stretch of a paragraph, not per run or per relationship: Google's
    conversion joins neighbouring runs that share a destination, splits others and renumbers
    or shares relationships, none of which changes a link. A link on a shape or picture has
    no words and is recorded with empty text."""
    targets = {key: r['Target'] for key, r in relationships(parts, part).items()
               if r.get('Type', '').endswith('/hyperlink')}
    found, counted = [], set()
    for paragraph in root.iter(tag(A, 'p')):
        current = None
        for child in paragraph:
            if child.tag == tag(A, 'br'):
                continue  # a line break inside a link does not end it
            if child.tag not in (tag(A, 'r'), tag(A, 'fld')):
                continue
            click = child.find(tag(A, 'rPr')+'/'+tag(A, 'hlinkClick'))
            target = targets.get(click.get(tag(R, 'id'))) if click is not None else None
            if click is not None:
                counted.add(click)
            if target is None:
                current = None
                continue
            text = ''.join(t.text or '' for t in child.iter(tag(A, 't')))
            if current is not None and current[0] == target:
                current[1] += text
            else:
                current = [target, text]
                found.append(current)
    for name in ('hlinkClick', 'hlinkHover', 'hlinkMouseOver'):
        for link in root.iter(tag(A, name)):
            if link not in counted and link.get(tag(R, 'id')) in targets:
                found.append([targets[link.get(tag(R, 'id'))], ''])
    # Spacing at the edge of a link may move in or out of it; the slide text is checked separately.
    return sorted([target, ' '.join(text.split())] for target, text in found)


def content_manifest(data):
    parts, _ = unpack(data)
    if 'ppt/presentation.xml' in parts:
        slides = []
        for part in slide_parts(parts):
            root, _ = xml(parts[part])
            # Google regenerates the cached display text of page-number fields as ‹#›.
            # Normalize only typed slide-number fields, never literal business text.
            for field in root.iter(tag(A,'fld')):
                if field.get('type')=='slidenum':
                    for value in field.iter(tag(A,'t')):value.text='<slide-number>'
            notes = []
            for rel in relationships(parts, part).values():
                if rel.get('Type', '').endswith('/notesSlide'):
                    note_path = target_part(part, rel['Target'])
                    note, _ = xml(parts[note_path])
                    # Slide-number placeholders may be regenerated; body notes are content.
                    for shape in note.findall('.//p:sp', NS):
                        ph = shape.find('./p:nvSpPr/p:nvPr/p:ph', NS)
                        if ph is None or ph.get('type') not in ('sldNum', 'hdr', 'ftr', 'dt'):
                            notes.extend(text_blocks(shape, A))
            slides.append({'text': text_blocks(root, A), 'notes': notes, 'links': slide_links(parts, part, root),
                           'pictures': len(root.findall('.//p:pic', NS)),
                           'tables': [len(t.findall('./a:tr', NS)) for t in root.findall('.//a:tbl', NS)]})
        return {'format': 'slides', 'slides': slides}
    if 'word/document.xml' in parts:
        root, _ = xml(parts['word/document.xml'])
        # Headers, footers, footnotes and endnotes survive as separate ordered parts.
        auxiliary = {}
        for kind in ('header', 'footer', 'footnotes', 'endnotes'):
            values = []
            for name in sorted(parts):
                if re.fullmatch(r'word/'+kind+r'\d*\.xml', name):
                    r, _ = xml(parts[name]); values.append(text_blocks(r, W))
            if values:
                auxiliary[kind] = values
        return {'format': 'docs', 'text': text_blocks(root, W), 'auxiliary': auxiliary,
                'links': links(parts, 'word/document.xml'),
                'pictures': len(root.findall('.//w:drawing', NS)),
                'tables': [len(t.findall('./w:tr', NS)) for t in root.findall('.//w:tbl', NS)]}
    raise ValueError('Export is not a supported PowerPoint or Word package.')


def local_content(parts):
    """Exact text, relationships, media, shape identity and geometry before/after styling."""
    result = {}
    for name, data in parts.items():
        if not name.endswith('.xml') or name.endswith('.rels'):
            result[name] = hashlib.sha256(data).hexdigest()
            continue
        root, _ = xml(data)
        # All text elements/fields and non-style relationships remain byte-exact values.
        result[name] = [(e.tag, e.text, tuple(sorted(e.attrib.items()))) for e in root.iter()
                        if e.tag in (tag(A,'t'), tag(W,'t'), tag(W,'instrText'), tag(W,'delText'),
                                     tag(P,'cNvPr'), tag(W,'hyperlink'), tag(W,'bookmarkStart'), tag(W,'bookmarkEnd'))]
    return result


def set_font(root, stats):
    for e in root.iter():
        if e.tag in (tag(A,'latin'), tag(A,'ea'), tag(A,'cs'), tag(A,'font')):
            old = e.get('typeface', '')
            if old and not SYMBOL.search(old) and old != BRAND['font']:
                e.set('typeface', BRAND['font']); stats['fonts'] += 1
        elif e.tag == tag(W,'rFonts'):
            for attr in ('ascii', 'hAnsi', 'eastAsia', 'cs'):
                old = e.get(tag(W,attr), '')
                if not SYMBOL.search(old):
                    e.set(tag(W,attr), BRAND['font'])
                    e.attrib.pop(tag(W,'cstheme' if attr=='cs' else attr+'Theme'), None)
            stats['fonts'] += 1
    # Explicit run fonts prevent direct formatting from overriding the theme.
    for p in root.iter(tag(A,'p')):
        for run in p:
            if run.tag not in (tag(A,'r'), tag(A,'fld')):
                continue
            props = run.find(tag(A,'rPr'))
            if props is None:
                props = ET.Element(tag(A,'rPr')); run.insert(0,props)
            latin = props.find(tag(A,'latin'))
            if latin is None:
                latin=ET.Element(tag(A,'latin'), {'typeface': BRAND['font']})
                index=next((i for i,e in enumerate(props) if e.tag in (tag(A,'ea'),tag(A,'cs'),tag(A,'sym'),tag(A,'hlinkClick'),tag(A,'hlinkMouseOver'),tag(A,'rtl'),tag(A,'extLst'))),len(props))
                props.insert(index,latin); stats['fonts'] += 1
    for run in root.iter(tag(W,'r')):
        props = run.find(tag(W,'rPr'))
        if props is None:
            props = ET.Element(tag(W,'rPr')); run.insert(0,props)
        fonts = props.find(tag(W,'rFonts'))
        if fonts is None:
            fonts=ET.Element(tag(W,'rFonts'), {tag(W,'ascii'): BRAND['font'],tag(W,'hAnsi'): BRAND['font']})
            props.insert(1 if props.find(tag(W,'rStyle')) is not None else 0,fonts)
            stats['fonts'] += 1


def map_colors(root, stats):
    for e in root.iter():
        if e.tag == tag(A,'srgbClr'):
            old = e.get('val',''); new = nearest(old)
            if new != old:
                e.set('val',new); stats['colors'] += 1
        elif e.tag == tag(A,'sysClr') and e.get('lastClr'):
            e.set('lastClr',nearest(e.get('lastClr'))); stats['colors'] += 1
        elif e.tag in (tag(W,'color'), tag(W,'shd'), tag(W,'top'),tag(W,'bottom'),tag(W,'left'),tag(W,'right'),tag(W,'insideH'),tag(W,'insideV')):
            attrs = ('val',) if e.tag == tag(W,'color') else ('fill','color')
            for attr in attrs:
                k=tag(W,attr)
                if e.get(k) and re.fullmatch('[a-fA-F0-9]{6}',e.get(k)):
                    e.set(k,nearest(e.get(k))); stats['colors'] += 1


def tidy_ppt(root, stats):
    tree = root.find('./p:cSld/p:spTree', NS)
    if tree is None or tree.find('p:cxnSp',NS) is not None or tree.find('p:grpSp',NS) is not None:
        return
    def bounds(shape):
        x = shape.find('./p:spPr/a:xfrm',NS)
        if x is None or any(x.get(k) not in (None,'0') for k in ('rot','flipH','flipV')):
            return None
        off,ext=x.find('a:off',NS),x.find('a:ext',NS)
        if off is None or ext is None:return None
        return [int(off.get('x')),int(off.get('y')),int(ext.get('cx')),int(ext.get('cy'))]
    shapes = list(tree.findall('p:sp',NS))
    boxes = {id(s):bounds(s) for s in shapes}
    if any(b is None for b in boxes.values()) or tree.find('p:pic',NS) is not None or tree.find('p:graphicFrame',NS) is not None:
        return
    def overlap(a,b): return a[0]<b[0]+b[2] and b[0]<a[0]+a[2] and a[1]<b[1]+b[3] and b[1]<a[1]+a[3]
    for s in shapes:
        if s.find('./p:nvSpPr/p:nvPr/p:ph',NS) is not None or s.find('p:txBody',NS) is None:continue
        old=boxes[id(s)]
        candidates=[b[0] for k,b in boxes.items() if k!=id(s) and 0<old[0]-b[0]<=4*12700 and not overlap(old,b)]
        if not candidates:continue
        new=[min(candidates),*old[1:]]
        if any(overlap(new,b) and not overlap(old,b) for k,b in boxes.items() if k!=id(s)):continue
        s.find('./p:spPr/a:xfrm/a:off',NS).set('x',str(new[0])); boxes[id(s)]=new; stats['alignments']+=1


def tidy_doc(root, stats):
    for p in root.iter(tag(W,'p')):
        props=p.find(tag(W,'pPr'))
        if props is None:props=ET.Element(tag(W,'pPr'));p.insert(0,props)
        # Lists retain their indentation and numbering; only paragraph spacing changes.
        spacing=props.find(tag(W,'spacing'))
        if spacing is None:spacing=ET.SubElement(props,tag(W,'spacing'))
        style=props.find(tag(W,'pStyle'))
        heading=style is not None and re.search(r'heading|title',style.get(tag(W,'val'),''),re.I)
        spacing.set(tag(W,'before'),'240' if heading else '0');spacing.set(tag(W,'after'),'120')
        stats['spacing']+=1


def verify_geometry(before, after, tidy):
    names=(tag(A,'xfrm'),tag(A,'off'),tag(A,'ext'),tag(A,'chOff'),tag(A,'chExt'),tag(W,'sectPr'))
    left=[(e.tag,dict(e.attrib)) for e in before.iter() if e.tag in names]
    right=[(e.tag,dict(e.attrib)) for e in after.iter() if e.tag in names]
    if len(left)!=len(right):raise ValueError('Geometry structure changed.')
    for (lt,la),(rt,ra) in zip(left,right):
        if (lt,la)==(rt,ra):continue
        if not tidy or lt!=tag(A,'off') or lt!=rt:
            raise ValueError('Unexpected geometry change.')
        lx,rx=la.pop('x',None),ra.pop('x',None)
        if la!=ra or lx is None or rx is None or not 0<=int(lx)-int(rx)<=4*12700:
            raise ValueError('Tidy exceeded its 4 pt alignment boundary.')


def _brand_office(data, tidy=False, remove_brand_shapes=None, compliance_report=None, template_plan=None):
    parts, info = unpack(data)
    # Validate XML before handing the package to private formatting libraries.
    for name,raw in parts.items():
        if name.endswith(('.xml','.rels')):xml(raw)
    if 'ppt/presentation.xml' in parts:
        import tempfile
        from brand_slides import apply
        with tempfile.TemporaryDirectory(prefix='brand-format-') as work:
            source=Path(work)/'source.pptx';target=Path(work)/'branded.pptx'
            source.write_bytes(data)
            report=apply(source,target,','.join(remove_brand_shapes or []),template_plan=template_plan)
            if not report['audit']['pass']:
                raise ValueError('Slide brand audit failed; inspect the local preview before upload.')
            if compliance_report is not None:compliance_report.update(report['compliance'])
            result=target.read_bytes()
        return result,report['changes'],report['notes']+['Visual review is required; code syntax colors and content artwork are preserved.']
    if template_plan is not None:raise ValueError('--template-plan applies only to Slides.')
    if remove_brand_shapes:raise ValueError('--remove-brand-shape applies only to Slides.')
    before = local_content(parts)
    original = content_manifest(data)
    stats = {'fonts':0,'colors':0,'alignments':0,'spacing':0,'parts':0}
    warnings = ['Drive conversion may alter advanced formatting; the returned native file is checked after import.',
                'Existing document header artwork is retained; visually check for old logos alongside the new brand mark.']
    for name, raw in list(parts.items()):
        if not name.endswith('.xml'):
            continue
        ppt = re.fullmatch(r'ppt/(slides|slideLayouts|slideMasters|theme)/[^/]+\.xml',name)
        doc = re.fullmatch(r'word/(document|styles|numbering|header\d*|footer\d*|footnotes|endnotes)\.xml',name)
        if not ppt and not doc and not re.fullmatch(r'word/theme/[^/]+\.xml',name):
            continue
        root,namespaces=xml(raw)
        if doc and any(e.tag in (tag(W,'ins'),tag(W,'del'),tag(W,'moveFrom'),tag(W,'moveTo')) for e in root.iter()):
            raise ValueError('Word export contains unresolved tracked changes; resolve them in a separate copy first.')
        old=ET.tostring(root)
        before_root=copy.deepcopy(root)
        set_font(root,stats);map_colors(root,stats)
        if tidy and name.startswith('ppt/slides/'):
            tidy_ppt(root,stats)
        elif tidy and doc and name!='word/styles.xml':
            tidy_doc(root,stats)
        verify_geometry(before_root,root,tidy)
        if ET.tostring(root)!=old:
            parts[name]=serialize(root,namespaces);stats['parts']+=1
    if local_content(parts)!=before:
        raise ValueError('The formatting pass changed non-formatting content; no upload is permitted.')
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as archive:
        for entry in info:archive.writestr(entry,parts[entry.filename])
    result=output.getvalue()
    if content_manifest(result)!=original:
        raise ValueError('Content check failed after formatting; no upload is permitted.')
    from brand_docs import apply
    result,identity_stats=apply(result)
    # New header art has no text; all original business text and auxiliary text must survive.
    checked=content_manifest(result)
    for key in ('text','links','pictures','tables'):
        if checked.get(key)!=original.get(key):raise ValueError('Document identity pass changed business content.')
    for kind,values in original.get('auxiliary',{}).items():
        if checked.get('auxiliary',{}).get(kind)!=values:raise ValueError('Document identity pass changed auxiliary text.')
    stats.update(identity_stats)
    return result,stats,warnings


def brand_office(data, tidy=False, remove_brand_shapes=None, compliance_report=None, icon_map=None, template_plan=None):
    records=[]
    if icon_map:
        parts,_=unpack(data)
        for name,raw in parts.items():
            if name.endswith(('.xml','.rels')):xml(raw)
        from brand_icons import replace
        data,records=replace(data,icon_map)
    result,stats,warnings=_brand_office(data,tidy,remove_brand_shapes,compliance_report,template_plan)
    if 'ppt/presentation.xml' in unpack(result)[0]:
        # Last, on the formatted deck: keep what Google's import of the upload would lose.
        import round_trip
        result,kept=round_trip.prepare(result)
        if kept:
            for change,key in (('icon kept as picture','icons_kept_as_pictures'),('list numbering kept','numbered_lists_kept')):
                count=sum(1 for r in kept if r['change']==change and r['status']=='applied')
                if count:stats[key]=count
            if compliance_report is not None:compliance_report['round_trip_repairs']=kept
            if any(r['status']=='unresolved' for r in kept):
                warnings.append("Some icon-font text could not be kept as a picture; Google's import may show it as plain text. See the report.")
    if records and compliance_report is not None:compliance_report['icon_replacements']=records
    if compliance_report is not None and 'ppt/presentation.xml' in unpack(result)[0]:
        # For the person reviewing the copy: what was done to each slide. Never blocks a run.
        try:
            from slide_summary import summarize
            compliance_report['slide_summary']=summarize(data,result,compliance_report)
        except Exception as exc:
            warnings.append('Slide-by-slide summary unavailable: '+str(exc)[:120])
    if records:
        stats['icon_replacements']=len(records)
        if compliance_report is not None:compliance_report['icon_replacements']=records
        warnings.append('Inspected functional icons were replaced with bundled approved artwork; other business content was preserved.')
    return result,stats,warnings
