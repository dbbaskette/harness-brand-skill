"""Set a filled document template's layout slots: sidebars, an icon row, the figure and page breaks.

document_template.fill puts the source's words in the main column. A layout names what goes in the
template's other slots, each anchored to a level-1 or level-2 heading of the source. A heading that
matches no section, or more than one, is refused: nothing is written.

Every step first finds where it will act and only then changes the document, so one step's change
cannot move another step's anchor."""
from __future__ import annotations
import copy,io,re,zipfile
from xml.sax.saxutils import quoteattr
from lxml import etree
from document_template import W,NS,REL,IMAGE,TemplateError,text_of,unpack,el

WP='{%s}'%NS['wp'];V='{urn:schemas-microsoft-com:vml}'
SPACE='{http://www.w3.org/XML/1998/namespace}space'
KEYS={'template','closing_from','page_break_before','figure','icon_row','sidebars'}
BLOCKS={'heading':'vmwSidebarheading','body':'vmwbodycopy','bullet':'vmwbullet1','stat':'vmwSidebarquote','quote':'vmwSidebarquote'}
HEADINGS=('Heading1','Heading2')
BOLD=re.compile(r'(\*\*.+?\*\*)')
# The order Word's schema wants a paragraph's properties in; a property set out of order can make Word reject the file.
ORDER=('pStyle','keepNext','keepLines','pageBreakBefore','framePr','widowControl','numPr','suppressLineNumbers','pBdr','shd','tabs',
       'suppressAutoHyphens','kinsoku','wordWrap','overflowPunct','topLinePunct','autoSpaceDE','autoSpaceDN','bidi','adjustRightInd',
       'snapToGrid','spacing','ind','contextualSpacing','mirrorIndents','suppressOverlap','jc','textDirection','textAlignment',
       'textboxTightWrap','outlineLvl','divId','cnfStyle','rPr','sectPr','pPrChange')


def squeeze(words):return ' '.join(str(words).split())
def plain(words):return squeeze(words.replace('**',''))
def style_of(p):
    node=p.find(W+'pPr/'+W+'pStyle');return node.get(W+'val') if node is not None else ''


def validate(layout):
    if not isinstance(layout,dict):raise TemplateError('The layout must be one JSON object.')
    if set(layout)-KEYS:raise TemplateError('The layout has keys this version does not know: '+', '.join(sorted(set(layout)-KEYS))+'.')
    row=layout.get('icon_row')
    if row is not None:
        items=row.get('items') if isinstance(row,dict) else None
        if not isinstance(items,list) or not 1<=len(items)<=4:raise TemplateError('An icon row takes one to four icons.')
        if not isinstance(row.get('before'),str) or not row['before'].strip():raise TemplateError('An icon row names the heading it sits before.')
        for item in items:
            if not all(isinstance(item.get(k),str) and item[k].strip() for k in ('icon','label','detail')):
                raise TemplateError('Each icon needs an icon ID, a label and a line of detail.')
    for bar in layout.get('sidebars') or []:
        if not bar.get('blocks'):raise TemplateError('A sidebar needs at least one block.')
        for block in bar['blocks']:
            if block.get('type') not in BLOCKS or not squeeze(block.get('text','')):
                raise TemplateError('A sidebar block needs a type (heading, body, bullet, stat or quote) and text.')
            if block['type'] in ('stat','quote') and not squeeze(block.get('attribution','')):
                raise TemplateError(f"A {block['type']} in a sidebar needs its attribution.")
    return layout


def heading(body,words):
    """The one level-1 or level-2 heading with these words."""
    found=[p for p in body.findall(W+'p') if style_of(p) in HEADINGS and squeeze(text_of(p))==squeeze(words)]
    if len(found)!=1:raise TemplateError(f'The layout names the heading {words!r}, which matches {len(found)} sections; it must match exactly one.')
    return found[0]


def setting(p,node):
    """Set one paragraph property, replacing any there and keeping the schema's order."""
    props=p.find(W+'pPr')
    if props is None:props=el('pPr');p.insert(0,props)
    name=etree.QName(node).localname;rank=ORDER.index(name)
    for old in props.findall(W+name):props.remove(old)
    at=next((i for i,c in enumerate(props) if etree.QName(c).localname in ORDER and ORDER.index(etree.QName(c).localname)>rank),len(props))
    props.insert(at,node)


def page_breaks(state,layout):
    names=layout.get('page_break_before') or [];targets=[heading(state['body'],n) for n in names]
    def change():
        for p in targets:setting(p,el('pageBreakBefore'))
        state['report']['page_breaks']=list(names)
    return change


def figure(state,layout):
    holders=[p for p in state['body'].findall(W+'p') if p.find('.//'+W+'drawing') is not None] if 'figure' in layout else []
    def change():
        for p in holders:   # the picture and its caption stay on one page, with air above
            setting(p,el('keepNext'));setting(p,el('spacing',before=240,after=80))
        state['report']['figures']=len(holders)
    return change


def boxes(template):
    """The template's own sidebar text boxes, as the runs that hold them: the first page's and later pages'."""
    parts,_=unpack(template);root=etree.fromstring(parts['word/document.xml'])
    runs=[r for r in root.find(W+'body').iter(W+'r')
          if any(style_of(p).startswith('vmwSidebar') for box in r.iter(W+'txbxContent') for p in box.iter(W+'p'))]
    if not runs:raise TemplateError('This template has no sidebar, so the layout cannot give it one.')
    return runs[0],runs[1] if len(runs)>1 else runs[0]


def paragraph(style,words):
    p=el('p');props=el('pPr');props.append(el('pStyle',val=style));p.append(props)
    for piece in BOLD.split(words):
        if not piece:continue
        run=el('r')
        if piece.startswith('**'):
            face=el('rPr');face.append(el('b'));run.append(face);piece=piece[2:-2]
        text=el('t');text.text=piece;text.set(SPACE,'preserve');run.append(text);p.append(run)
    return p


def sidebar(box,blocks,number,styles,words):
    """A copy of the template's box holding these blocks, each in the template's sidebar style."""
    pick=lambda *names:next((n for n in names if n in styles),'vmwbodycopy')
    made=[]
    for index,block in enumerate(blocks):
        kind=block['type'];text=squeeze(block['text'])
        if kind=='quote':text='“'+text.strip('“”"')+'”'
        style=pick('vmwSidebarheadingnospacebefore','vmwSidebarheading') if kind=='heading' and index==0 else pick(BLOCKS[kind])
        made.append(paragraph(style,text));words.append(plain(text))
        if kind in ('stat','quote'):
            made.append(paragraph(pick('vmwSidebarquotenamelastwithunderline','vmwSidebarquotename'),squeeze(block['attribution'])))
            words.append(squeeze(block['attribution']))
    run=copy.deepcopy(box)
    for holder in run.iter(W+'txbxContent'):   # a box is stored twice, for new and old readers; both get the words
        for old in list(holder):holder.remove(old)
        for p in made:holder.append(copy.deepcopy(p))
    for props in run.iter(WP+'docPr'):props.set('id',str(9500+number));props.set('name',f'Sidebar {number}')
    for shape in run.iter(V+'shape'):
        shape.set('id',f'Sidebar_{number}')
        for name in [a for a in shape.attrib if a.endswith('}spid') or a.endswith('}anchorId')]:del shape.attrib[name]
    for anchor in run.iter(WP+'anchor'):
        for name in [a for a in anchor.attrib if a.endswith('}anchorId') or a.endswith('}editId')]:del anchor.attrib[name]
    return run


def holds_words(p):
    return p.tag==W+'p' and bool(text_of(p).strip()) and p.find(W+'pPr/'+W+'sectPr') is None


def sidebars(state,layout):
    bars=layout.get('sidebars') or [];body=state['body'];targets=[]
    for bar in bars:
        if bar.get('page_of'):
            start=heading(body,bar['page_of']);target=start.getnext()
            while target is not None and not holds_words(target):target=target.getnext()
            if target is None:raise TemplateError(f"Nothing follows the heading {bar['page_of']!r} to hold its sidebar.")
        else:
            target=next((p for p in body.findall(W+'p') if holds_words(p) and style_of(p) not in HEADINGS),None)
            if target is None:raise TemplateError('The document has no opening paragraph to hold the first sidebar.')
        targets.append(target)
    if len({id(t) for t in targets})<len(targets):raise TemplateError('Two sidebars are anchored to the same place; give each its own heading.')
    first,later=boxes(state['template']) if bars else (None,None)
    def change():
        for number,(bar,target) in enumerate(zip(bars,targets),1):
            run=sidebar(later if bar.get('page_of') else first,bar['blocks'],number,state['styles'],state['words'])
            target.insert(next((i for i,c in enumerate(target) if c.tag!=W+'pPr'),len(target)),run)
        state['report']['sidebars']=len(bars)
    return change


ICON_SIDE=457200   # half an inch, in EMU
CT='{http://schemas.openxmlformats.org/package/2006/content-types}'


def picture(rel,number,file,label):
    """An inline picture run, half an inch square."""
    ns={k:NS[k] for k in ('w','wp','a','pic','r')}
    return etree.fromstring(
        f'<w:r xmlns:w="{ns["w"]}"><w:drawing><wp:inline xmlns:wp="{ns["wp"]}" distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{ICON_SIDE}" cy="{ICON_SIDE}"/><wp:docPr id="{number}" name="Icon {number}" descr={quoteattr(label+" icon")}/>'
        f'<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="{ns["a"]}" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
        f'<a:graphic xmlns:a="{ns["a"]}"><a:graphicData uri="{ns["pic"]}"><pic:pic xmlns:pic="{ns["pic"]}">'
        f'<pic:nvPicPr><pic:cNvPr id="{number}" name={quoteattr(file)}/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip xmlns:r="{ns["r"]}" r:embed="{rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{ICON_SIDE}" cy="{ICON_SIDE}"/></a:xfrm>'
        f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>'
        f'</wp:inline></w:drawing></w:r>')


def centred(style,after,*runs):
    p=el('p');props=el('pPr');props.append(el('pStyle',val=style));props.append(el('spacing',before=0,after=after))
    props.append(el('jc',val='center'));p.append(props)
    for run in runs:p.append(run)
    return p


def caption(words,bold=False):
    run=el('r')
    if bold:
        face=el('rPr');face.append(el('b'));run.append(face)
    text=el('t');text.text=words;text.set(SPACE,'preserve');run.append(text);return run


def icon_row(state,layout):
    row=layout.get('icon_row')
    if not row:return lambda:None
    if 'vmwinvisibletable' not in state['styles']:raise TemplateError('This template has no icon row (no vmwinvisibletable style).')
    if state['icon_png'] is None:raise TemplateError('An icon row needs the icon library.')
    before=heading(state['body'],row['before']);items=row['items'];parts=state['parts']
    art={item['icon']:state['icon_png'](item['icon']) for item in items}   # an unknown icon is refused here, before anything changes
    section=next(state['doc'].iter(W+'sectPr'));size,margin=section.find(W+'pgSz'),section.find(W+'pgMar')
    column=int(size.get(W+'w'))-int(margin.get(W+'left'))-int(margin.get(W+'right'));side=column//len(items)
    cell_style='vmwtablebodycopy' if 'vmwtablebodycopy' in state['styles'] else 'vmwbodycopy'
    def change():
        rels=etree.fromstring(parts['word/_rels/document.xml.rels']);related={}
        number=max([int(m.group(1)) for r in rels if (m:=re.fullmatch(r'rId(\d+)',r.get('Id','')))]+[0])
        for ident,data in art.items():
            name=f'media/icon-{ident}.png';number+=1
            parts['word/'+name]=data;state['order'].append('word/'+name)
            etree.SubElement(rels,'{%s}Relationship'%REL,Id=f'rId{number}',Type=IMAGE,Target=name);related[ident]=f'rId{number}'
        parts['word/_rels/document.xml.rels']=etree.tostring(rels,xml_declaration=True,encoding='UTF-8',standalone=True)
        types=etree.fromstring(parts['[Content_Types].xml'])
        if not any(d.get('Extension','').lower()=='png' for d in types.iter(CT+'Default')):
            types.insert(0,etree.Element(CT+'Default',Extension='png',ContentType='image/png'))
            parts['[Content_Types].xml']=etree.tostring(types,xml_declaration=True,encoding='UTF-8',standalone=True)
        table=el('tbl');props=el('tblPr');props.append(el('tblStyle',val='vmwinvisibletable'));props.append(el('tblW',w=column,type='dxa'))
        props.append(el('tblLayout',type='fixed'));table.append(props)
        grid=el('tblGrid');table.append(grid)
        for _ in items:grid.append(el('gridCol',w=side))
        line=el('tr');keep=el('trPr');keep.append(el('cantSplit'));line.append(keep);table.append(line)
        for index,item in enumerate(items):
            cell=el('tc');about=el('tcPr');about.append(el('tcW',w=side,type='dxa'));cell.append(about)
            cell.append(centred(cell_style,80,picture(related[item['icon']],9600+index,f"icon-{item['icon']}.png",squeeze(item['label']))))
            cell.append(centred(cell_style,0,caption(squeeze(item['label']),bold=True)))
            cell.append(centred(cell_style,120,caption(squeeze(item['detail']))))
            line.append(cell);state['words']+=[squeeze(item['label']),squeeze(item['detail'])]
        before.addprevious(table);state['report']['icons']=[item['icon'] for item in items]
    return change


STEPS=[page_breaks,figure,sidebars,icon_row]


def apply(data,template,layout,icon_png=None):
    """(document bytes, report, the words the layout added). template is the brand's template file,
    which holds the sidebar boxes; icon_png turns an icon ID into PNG bytes."""
    layout=validate(layout);parts,order=unpack(data)
    doc=etree.fromstring(parts['word/document.xml'])
    state={'parts':parts,'order':list(order),'doc':doc,'body':doc.find(W+'body'),'template':template,'icon_png':icon_png,'words':[],'report':{},
           'styles':set(re.findall(r'w:styleId="([^"]+)"',parts['word/styles.xml'].decode('utf8')))}
    for change in [step(state,layout) for step in STEPS]:change()
    parts['word/document.xml']=etree.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for name in dict.fromkeys(state['order']):z.writestr(name,parts[name])
    return out.getvalue(),state['report'],state['words']


def kept(data,words):
    """After apply: every sidebar and icon caption the layout asked for must be in the document."""
    parts,_=unpack(data);root=etree.fromstring(parts['word/document.xml'])
    found={squeeze(text_of(p)) for p in root.iter(W+'p')}
    missing=[w for w in words if squeeze(w) not in found]
    return [f'{len(missing)} piece(s) of the layout are missing, starting with: {missing[0][:60]!r}'] if missing else []
