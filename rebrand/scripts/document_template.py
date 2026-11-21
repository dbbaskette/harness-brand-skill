"""Flow an existing document into one of the brand's Word document templates.

The template keeps its cover, headers, footers, back page and styles. The source gives the words:
its title and subtitle go to the cover and running head, and its headings, paragraphs, lists,
tables, pictures, links and footnotes replace the template's sample copy, each set in the
template's own style. Source formatting other than bold, italic, underline, strike and
super/subscript is dropped: the template decides how things look. Nothing is reworded, and the
result is refused if any block of text, link, picture or footnote went missing."""
from __future__ import annotations
import copy,datetime,io,posixpath,re,zipfile
from lxml import etree

NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main',
    'pic':'http://schemas.openxmlformats.org/drawingml/2006/picture','mc':'http://schemas.openxmlformats.org/markup-compatibility/2006'}
W,R,WP,A='{%s}'%NS['w'],'{%s}'%NS['r'],'{%s}'%NS['wp'],'{%s}'%NS['a']
REL='http://schemas.openxmlformats.org/package/2006/relationships'
IMAGE='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
LINK='http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
KEEP=('b','i','u','strike','vertAlign')
TYPES={'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif'}


class TemplateError(ValueError):pass


def unpack(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if sum(i.file_size for i in z.infolist())>400_000_000:raise TemplateError('Document is too large.')
        return {i.filename:z.read(i) for i in z.infolist()},[i.filename for i in z.infolist()]


PRIVATE=re.compile('[\ue000-\uf8ff]')   # private-use marks: Google Docs wraps a code block in them; they are not words
MONO=re.compile(r'mono|courier|consolas|menlo|source code|fira code',re.I)


def text_of(el):
    return PRIVATE.sub('',''.join(t.text or '' for t in el.iter(W+'t')))


def el(tag,**attrs):
    node=etree.Element(W+tag)
    for key,value in attrs.items():node.set(W+key,str(value))
    return node


def rels_of(parts,name):
    path=posixpath.join(posixpath.dirname(name),'_rels',posixpath.basename(name)+'.rels')
    if path not in parts:return {}
    return {r.get('Id'):r for r in etree.fromstring(parts[path])}


class Source:
    """The source document read as a list of blocks, independent of how it was formatted."""
    def __init__(self,data):
        self.parts,_=unpack(data)
        if 'word/document.xml' not in self.parts:raise TemplateError('The source is not a Word document.')
        self.doc=etree.fromstring(self.parts['word/document.xml']);self.rels=rels_of(self.parts,'word/document.xml')
        styles=etree.fromstring(self.parts['word/styles.xml']) if 'word/styles.xml' in self.parts else etree.Element(W+'styles')
        self.styles={s.get(W+'styleId'):s for s in styles.iter(W+'style')}
        self.formats={}
        if 'word/numbering.xml' in self.parts:
            numbering=etree.fromstring(self.parts['word/numbering.xml'])
            abstract={a.get(W+'abstractNumId'):{l.get(W+'ilvl'):(l.find(W+'numFmt').get(W+'val') if l.find(W+'numFmt') is not None else 'bullet') for l in a.iter(W+'lvl')} for a in numbering.iter(W+'abstractNum')}
            for num in numbering.iter(W+'num'):
                ref=num.find(W+'abstractNumId')
                if ref is not None:self.formats[num.get(W+'numId')]=abstract.get(ref.get(W+'val'),{})
        size=styles.find(W+'docDefaults/'+W+'rPrDefault/'+W+'rPr/'+W+'sz')
        normal=next((x.find(W+'rPr/'+W+'sz') for x in styles.iter(W+'style') if x.get(W+'default')=='1' and x.get(W+'type')=='paragraph' and x.find(W+'rPr/'+W+'sz') is not None),None)
        self.default_size=int((normal if normal is not None else size).get(W+'val')) if (normal is not None or size is not None) else 22   # half-points
        self.footnotes={}
        if 'word/footnotes.xml' in self.parts:
            for note in etree.fromstring(self.parts['word/footnotes.xml']).iter(W+'footnote'):
                if note.get(W+'type') is None:self.footnotes[note.get(W+'id')]=note

    def style_name(self,p):
        ref=p.find(W+'pPr/'+W+'pStyle');seen=set()
        ident=ref.get(W+'val') if ref is not None else None
        while ident and ident not in seen:   # a custom style based on a heading is still a heading
            seen.add(ident);style=self.styles.get(ident)
            if style is None:break
            name=(style.find(W+'name').get(W+'val') if style.find(W+'name') is not None else '').lower()
            if name in ('title','subtitle') or re.fullmatch(r'heading [1-9]',name):return name
            based=style.find(W+'basedOn');ident=based.get(W+'val') if based is not None else None
        return 'normal'

    def numbering(self,p):
        node=p.find(W+'pPr/'+W+'numPr')
        if node is None:
            ref=p.find(W+'pPr/'+W+'pStyle');style=self.styles.get(ref.get(W+'val')) if ref is not None else None
            node=style.find(W+'pPr/'+W+'numPr') if style is not None else None
        if node is None or node.find(W+'numId') is None or node.find(W+'numId').get(W+'val')=='0':return None
        level=node.find(W+'ilvl').get(W+'val') if node.find(W+'ilvl') is not None else '0'
        ident=node.find(W+'numId').get(W+'val')
        return ident,int(level),self.formats.get(ident,{}).get(level,'bullet')

    def kind(self,p):
        name=self.style_name(p)
        if name in ('title','subtitle'):return name,0,None
        if name.startswith('heading'):return 'h'+str(min(3,int(name[-1]))),0,None
        listed=self.numbering(p)
        if listed:return ('bullet' if listed[2]=='bullet' else 'number'),listed[1],listed[0]
        return 'body',0,None


class Filler:
    def __init__(self,template,source):
        self.parts,self.order=unpack(template);self.source=Source(source)
        self.doc=etree.fromstring(self.parts['word/document.xml']);self.body=self.doc.find(W+'body')
        rels_path='word/_rels/document.xml.rels';self.rels=etree.fromstring(self.parts[rels_path])
        self.next_rel=max([int(m.group(1)) for r in self.rels if (m:=re.fullmatch(r'rId(\d+)',r.get('Id','')))]+[0])+1
        styles=etree.fromstring(self.parts['word/styles.xml']);self.styles={s.get(W+'styleId') for s in styles.iter(W+'style')}
        self.media=0;self.carried={};self.drawing=9000;self.notes={};self.links=[];self.pictures=0;self.dropped=[];self.lists={};self.guessed=[];self.code=0
        self.numbering=etree.fromstring(self.parts['word/numbering.xml']) if 'word/numbering.xml' in self.parts else None
        self.short_head=None;self.title_scale=1;self.sub_fit=1;self.sizes={s.get(W+'styleId'):int(z.get(W+'val')) for s in styles.iter(W+'style') if (z:=s.find(W+'rPr/'+W+'sz')) is not None};self.subtitle_scale=1
        self.style_numbers={s.get(W+'styleId'):n.get(W+'val') for s in styles.iter(W+'style') if (n:=s.find(W+'pPr/'+W+'numPr/'+W+'numId')) is not None}
        sect=[s for s in self.doc.iter(W+'sectPr')][0];size,margin=sect.find(W+'pgSz'),sect.find(W+'pgMar')
        self.column=(int(size.get(W+'w'))-int(margin.get(W+'left'))-int(margin.get(W+'right')))*635   # twips to EMU

    def style(self,*wanted):
        return next((s for s in wanted if s in self.styles),None)

    def relate(self,kind,target,external=False):
        ident=f'rId{self.next_rel}';self.next_rel+=1
        node=etree.SubElement(self.rels,'{%s}Relationship'%REL,Id=ident,Type=kind,Target=target)
        if external:node.set('TargetMode','External')
        return ident

    # --- inline content -------------------------------------------------------------------
    def run(self,source_run,linked=False):
        out=el('r');props=el('rPr');given=source_run.find(W+'rPr')
        if linked and self.style('Hyperlink'):props.append(el('rStyle',val='Hyperlink'))
        if given is not None:
            for name in KEEP:
                node=given.find(W+name)
                if node is not None and not (name=='u' and linked):props.append(copy.deepcopy(node))
        face=given.find(W+'rFonts') if given is not None else None
        if face is not None and MONO.search(face.get(W+'ascii') or ''):   # code stays in a fixed-width face
            props.append(el('rFonts',ascii='Courier New',hAnsi='Courier New',cs='Courier New'));self.code+=1
        if len(props):out.append(props)
        for child in source_run:
            tag=etree.QName(child).localname
            if tag=='t':
                words=PRIVATE.sub('',child.text or '')
                if words:
                    piece=copy.deepcopy(child);piece.text=words;out.append(piece)
            elif tag in ('tab','noBreakHyphen','softHyphen','sym'):out.append(copy.deepcopy(child))
            elif tag=='br' and child.get(W+'type') not in ('page','column'):out.append(el('br'))
            elif tag=='footnoteReference' and child.get(W+'id') in self.source.footnotes:
                ident=self.notes.setdefault(child.get(W+'id'),len(self.notes)+1);out.remove(props) if len(props) else None
                mark=el('rPr');mark.append(el('rStyle',val='FootnoteReference') if self.style('FootnoteReference') else el('vertAlign',val='superscript'))
                out.insert(0,mark);out.append(el('footnoteReference',id=ident))
            elif tag=='drawing':
                picture=self.picture(child)
                if picture is not None:out.append(picture)
            elif tag=='AlternateContent':   # a picture with callouts or shapes on it, and its plain fallback
                whole=copy.deepcopy(child);fine=True
                for drawing in list(whole.iter(W+'drawing')):
                    made=self.picture(drawing,count=False)
                    if made is None:fine=False;break
                    drawing.getparent().replace(drawing,made)
                if fine and whole.find('.//'+W+'drawing') is not None:
                    for legacy in list(whole.iter(W+'pict')):legacy.getparent().remove(legacy)
                    out.append(whole);self.pictures+=1
                elif not fine:self.dropped.append('a drawing that could not be carried whole')
            elif tag in ('pict','object'):self.dropped.append('an embedded object or legacy drawing')
        return out if len(out)>(1 if out.find(W+'rPr') is not None else 0) else None

    def embed(self,blip):
        """The source picture behind a blip, copied into the result once; None when it cannot be carried."""
        rel=self.source.rels.get(blip.get(R+'embed'))
        if rel is None or rel.get('TargetMode')=='External':
            self.dropped.append('a linked picture');return None
        path=posixpath.normpath(posixpath.join('word',rel.get('Target')));ext=path.rsplit('.',1)[-1].lower()
        if path not in self.source.parts or ext not in TYPES:
            self.dropped.append(f'a picture in a format Word templates cannot carry ({ext})');return None
        if path not in self.carried:
            self.media+=1;name=f'media/source{self.media}.{ext}';self.parts['word/'+name]=self.source.parts[path];self.order.append('word/'+name)
            self.carried[path]=self.relate(IMAGE,name)
        return self.carried[path]

    def picture(self,drawing,count=True):
        holder=drawing.find(WP+'inline') if drawing.find(WP+'inline') is not None else drawing.find(WP+'anchor')
        if holder is None or holder.find('.//'+A+'blip') is None:
            self.dropped.append('a chart or shape with no picture in it');return None
        holder=copy.deepcopy(holder)
        for blip in holder.iter(A+'blip'):
            ident=self.embed(blip)
            if ident is None:return None
            blip.set(R+'embed',ident)
        if etree.QName(holder).localname=='anchor':   # a floating picture becomes an inline one: placement belongs to the template
            inline=etree.Element(WP+'inline',distT='0',distB='0',distL='0',distR='0')
            for tag in ('extent','docPr','cNvGraphicFramePr'):
                node=holder.find(WP+tag)
                if node is not None:inline.append(node)
            inline.append(holder.find(A+'graphic'));holder=inline
        extent=holder.find(WP+'extent');width,height=int(extent.get('cx')),int(extent.get('cy'))
        if width>self.column:   # never wider than the text column
            scale=self.column/width;width,height=round(width*scale),round(height*scale)
            extent.set('cx',str(width));extent.set('cy',str(height))
            # The outermost shape takes the new size; whatever it groups scales with it.
            outer=next((x.find(A+'ext') for x in holder.iter(A+'xfrm') if x.find(A+'ext') is not None),None)
            if outer is not None:outer.set('cx',str(width));outer.set('cy',str(height))
            # Words inside the drawing (callouts, labels) shrink with it, or they outgrow their boxes:
            # a group scales its shapes, never the type set in them.
            for box in holder.iter(W+'txbxContent'):
                for run in box.iter(W+'r'):
                    props=run.find(W+'rPr')
                    if props is None:props=el('rPr');run.insert(0,props)
                    for name in ('sz','szCs'):
                        size=props.find(W+name)
                        if size is None:size=el(name,val=self.source.default_size);props.append(size)
                        size.set(W+'val',str(max(2,round(int(size.get(W+'val'))*scale))))
                for spacing in box.iter(W+'spacing'):
                    for key in ('before','after')+(('line',) if spacing.get(W+'lineRule') in ('exact','atLeast') else ()):
                        if spacing.get(W+key):spacing.set(W+key,str(round(int(spacing.get(W+key))*scale)))
            for body in holder.iter('{http://schemas.microsoft.com/office/word/2010/wordprocessingShape}bodyPr'):
                for key in ('lIns','tIns','rIns','bIns'):
                    body.set(key,str(round(int(body.get(key,'91440' if key in ('lIns','rIns') else '45720'))*scale)))
        self.drawing+=1;prop=holder.find(WP+'docPr')
        if prop is not None:prop.set('id',str(self.drawing))
        out=el('drawing');out.append(holder)
        if count:self.pictures+=1
        return out

    def inline(self,parent,target,linked=False):
        for child in parent:
            tag=etree.QName(child).localname
            if tag=='r':
                made=self.run(child,linked)
                if made is not None:target.append(made)
            elif tag=='hyperlink':
                rel=self.source.rels.get(child.get(R+'id')) if child.get(R+'id') else None
                if rel is not None and rel.get('TargetMode')=='External':
                    link=etree.SubElement(target,W+'hyperlink');link.set(R+'id',self.relate(LINK,rel.get('Target'),True))
                    self.links.append(rel.get('Target'));self.inline(child,link,True)
                else:self.inline(child,target)   # a link to a place inside the source: keep the words
            elif tag in ('ins','smartTag','sdt','sdtContent','fldSimple'):self.inline(child,target,linked)

    def paragraph(self,source_p,style,number=None):
        out=el('p');props=el('pPr');out.append(props)
        if style:props.append(el('pStyle',val=style))
        if number is not None:
            node=el('numPr');node.append(el('ilvl',val=0));node.append(el('numId',val=number));props.append(node)
        self.inline(source_p,out)
        return out

    # --- blocks ---------------------------------------------------------------------------
    def list_number(self,style,source_list):
        """Each numbered list of the source restarts at 1, in the template's numbering."""
        base=self.style_numbers.get(style)
        if self.numbering is None or base is None:return None
        key=(style,source_list)
        if key not in self.lists:
            num=next((n for n in self.numbering.iter(W+'num') if n.get(W+'numId')==base),None)
            if num is None:return None
            ident=max(int(n.get(W+'numId')) for n in self.numbering.iter(W+'num'))+1
            new=el('num',numId=ident);new.append(copy.deepcopy(num.find(W+'abstractNumId')))
            override=el('lvlOverride',ilvl=0);override.append(el('startOverride',val=1));new.append(override)
            self.numbering.append(new);self.lists[key]=ident
        return self.lists[key]

    def table(self,source_tbl,prototype):
        rows=[r for r in source_tbl.iter(W+'tr') if r.getparent() is source_tbl or r.getparent().getparent() is source_tbl]
        columns=max((sum(int(g.get(W+'val')) if (g:=c.find(W+'tcPr/'+W+'gridSpan')) is not None else 1 for c in r.findall(W+'tc')) for r in rows),default=1)
        out=el('tbl')
        if prototype is not None and prototype.find(W+'tblPr') is not None:
            out.append(copy.deepcopy(prototype.find(W+'tblPr')));look=out.find(W+'tblPr/'+W+'tblLook')
            if look is not None:
                for key in list(look.attrib):del look.attrib[key]
                for key,value in (('val','0420'),('firstRow','1'),('lastRow','0'),('firstColumn','0'),('lastColumn','0'),('noHBand','1'),('noVBand','1')):look.set(W+key,value)
        width=round(self.column/635/columns);grid=el('tblGrid');out.append(grid)
        for _ in range(columns):grid.append(el('gridCol',w=width))
        head=self.style('vmwtableheadingtop');cell_style=self.style('vmwtablebodycopy','vmwbodycopy');bullet=self.style('vmwtablebullet','vmwbullet1')
        for index,row in enumerate(rows):
            new_row=el('tr');out.append(new_row)
            if index==0 and head:
                props=el('trPr');props.append(el('tblHeader'));new_row.append(props)
            for cell in row.findall(W+'tc'):
                new_cell=el('tc');props=el('tcPr');new_cell.append(props);span=cell.find(W+'tcPr/'+W+'gridSpan')
                props.append(el('tcW',w=width*(int(span.get(W+'val')) if span is not None else 1),type='dxa'))
                for name in ('gridSpan','vMerge'):
                    node=cell.find(W+'tcPr/'+W+name)
                    if node is not None:props.append(copy.deepcopy(node))
                for p in cell.iter(W+'p'):
                    kind,_,_=self.source.kind(p)
                    new_cell.append(self.paragraph(p,head if index==0 and head else bullet if kind in ('bullet','number') else cell_style))
                if not new_cell.findall(W+'p'):new_cell.append(el('p'))
                new_row.append(new_cell)
        return out

    def blocks(self,prototype):
        """(kind, element, text) for everything the source says, in order; plus its title and subtitle."""
        made=[];title=subtitle=None;intro=self.style('vmwintroparagraph') if any(p.find(W+'pPr/'+W+'pStyle') is not None and p.find(W+'pPr/'+W+'pStyle').get(W+'val')=='vmwintroparagraph' for p in self.body.iter(W+'p')) else None
        styles={'h1':self.style('Heading1'),'h2':self.style('Heading2'),'h3':self.style('Heading3','Heading2'),'body':self.style('vmwbodycopy'),'number':self.style('vmwnumbered','vmwbodycopy')}
        body=self.source.doc.find(W+'body');started=False;run=[0];leading=[False]
        def walk(children):
            nonlocal title,subtitle,started
            for child in children:
                tag=etree.QName(child).localname
                if tag=='sdt':
                    content=child.find(W+'sdtContent')
                    if content is not None and child.find('.//'+W+'docPartGallery') is not None and 'Table of Contents' in (child.find('.//'+W+'docPartGallery').get(W+'val') or ''):
                        self.dropped.append("the source's table of contents (the template builds its own)");continue
                    if content is not None:walk(content)
                elif tag=='tbl':
                    made.append(('table',self.table(child,prototype),[text_of(p) for p in child.iter(W+'p') if text_of(p).strip()]));started=True;run[0]+=1
                elif tag=='p':
                    words=text_of(child);has_picture=child.find('.//'+W+'drawing') is not None
                    if not words.strip() and not has_picture:continue
                    kind,level,source_list=self.source.kind(child)
                    if kind=='title' and title is None:
                        title=' '.join(words.split());leading[0]=not made;continue
                    if kind=='subtitle' and subtitle is None:subtitle=' '.join(words.split());continue
                    if kind in ('title','subtitle'):kind='h1' if kind=='title' else 'body'
                    if kind=='bullet':style=self.style('vmwbullet2' if level else 'vmwbullet1','vmwbullet1','vmwbodycopy');number=None
                    elif kind=='number':style=styles['number'];number=self.list_number(style,(source_list,run[0]))
                    else:style=styles[kind];number=None
                    if kind in ('h1','h2','h3'):run[0]+=1
                    if kind=='body' and not started and intro and words.strip():style=intro
                    started=True;made.append((kind,self.paragraph(child,style,number),[words] if words.strip() else []))
        walk(body)
        # Many documents have no Title style: the first heading is the title, and one short line under it the subtitle.
        if title is None and len(made)>1 and made[0][0]=='h1' and made[0][2] and sum(1 for kind,_,_ in made if kind=='h1')>1:
            title=' '.join(made[0][2][0].split());made.pop(0);self.guessed.append('title');leading[0]=True
        # A subtitle is often just a short line under the title, with no Subtitle style: set in italic, not a
        # full sentence, followed by a heading, or followed by a longer paragraph.
        if subtitle is None and leading[0] and made and made[0][0]=='body' and made[0][2] and len(made[0][2][0])<=180 and made[0][1].find('.//'+W+'drawing') is None:
            words=made[0][2][0];runs=[r for r in made[0][1].iter(W+'r') if text_of(r).strip()]
            after=made[1] if len(made)>1 else None
            if (not words.rstrip().endswith(('.','?','!',':')) or (runs and all((i:=r.find(W+'rPr/'+W+'i')) is not None and i.get(W+'val') not in ('0','false') for r in runs))
                    or (after is not None and (after[0] in ('h1','h2','h3') or (after[0]=='body' and after[2] and len(after[2][0])>len(words))))):
                subtitle=' '.join(words.split());made.pop(0);self.guessed.append('subtitle')
        return made,title,subtitle

    # --- the template ---------------------------------------------------------------------
    def set_text(self,p,words):
        runs=[r for r in p.iter(W+'r') if r.find(W+'t') is not None]
        if not runs:return
        first=runs[0].find(W+'t');first.text=words;first.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        for extra in runs[0].findall(W+'t')[1:]:runs[0].remove(extra)
        for r in runs[1:]:
            for t in r.findall(W+'t'):r.remove(t)

    def title_fit(self,p,title,subtitle):
        """How much smaller the cover title must be set for it and the subtitle to stay inside their text box.
        Estimated from the box and average letter widths, so it errs towards smaller."""
        import math
        holder=next((a for a in p.iterancestors() if a.tag in (WP+'anchor',WP+'inline')),None)
        if holder is None or holder.find(WP+'extent') is None:return self.title_scale   # the legacy copy of the same box
        width=int(holder.find(WP+'extent').get('cx'))/12700-16;height=int(holder.find(WP+'extent').get('cy'))/12700-10
        base=self.sizes.get('vmwHeadline',54)/2;under=self.sizes.get('vmwSubhead',28)/2
        scale=1 if len(subtitle or '')<=90 else 0.85 if len(subtitle)<=140 else 0.75
        # Measured on rendered covers: Arial averages 0.48 em a letter; the template leads titles at 1.35 and subtitles at 1.55.
        def lines(words,points):return math.ceil(len(words)*points*0.48/width) if words else 0
        def fits(factor,small):return lines(title,base*factor)*base*factor*1.35+lines(subtitle or '',under*small)*under*small*1.55+16<=height
        # Prefer the largest title; let the subtitle give way first.
        factor,small=next(((f,m) for f in (1,0.9,0.8,0.7,0.6) for m in (scale,0.85,0.75) if m<=scale and fits(f,m)),(0.6,0.75))
        self.title_scale=factor;self.sub_fit=small
        return factor

    def running_head(self,title,limit=80):
        """The title as it runs along the top of inside pages: one line. A long title gives its part before
        the colon, or is cut at a word with an ellipsis; the cover keeps it whole."""
        if len(title)<=limit:return title
        lead=re.split(r':\s|\s[—–-]\s',title,maxsplit=1)[0].strip()
        short=lead if 12<=len(lead)<=limit else title[:limit].rsplit(' ',1)[0].rstrip(' ,;:—–-')+'…'
        self.short_head=short
        return short

    def headings(self,root,title,subtitle,when):
        for p in root.iter(W+'p'):
            ref=p.find(W+'pPr/'+W+'pStyle');style=ref.get(W+'val') if ref is not None else None
            if style=='vmwHeadline' and text_of(p).strip():
                self.set_text(p,title)
                factor=self.title_fit(p,title,subtitle)
                if factor<1:
                    for run in p.iter(W+'r'):
                        props=run.find(W+'rPr')
                        if props is None:props=el('rPr');run.insert(0,props)
                        for name in ('sz','szCs'):
                            size=props.find(W+name)
                            if size is None:size=el(name);props.append(size)
                            size.set(W+'val',str(round(self.sizes.get('vmwHeadline',54)*factor)))
            elif style=='vmwHeadlinepage2onwards' and text_of(p).strip():self.set_text(p,self.running_head(title))
            elif style=='vmwSubhead' and text_of(p).strip():
                self.set_text(p,subtitle or '')
                # A subtitle written as a sentence is longer than the template allows for: set it smaller, so it
                # keeps to its place on the cover.
                factor=min(self.sub_fit,1 if len(subtitle or '')<=90 else 0.85 if len(subtitle)<=140 else 0.75)
                if factor<1:
                    for run in p.iter(W+'r'):
                        props=run.find(W+'rPr')
                        if props is None:props=el('rPr');run.insert(0,props)
                        for name in ('sz','szCs'):
                            size=props.find(W+name)
                            if size is None:size=el(name,val=self.sizes.get('vmwSubhead',28));props.append(size)
                            else:size.set(W+'val',str(self.sizes.get('vmwSubhead',int(size.get(W+'val')))))
                            size.set(W+'val',str(round(int(size.get(W+'val'))*factor)))
                    self.subtitle_scale=factor
            elif re.fullmatch(r'\s*Item No:.*',text_of(p)):self.set_text(p,'')
            elif re.search(r'Month 20\d\d',text_of(p)):
                month,year=when.rsplit(' ',1) if ' ' in when else (when,'')
                for t in p.iter(W+'t'):   # Word may have split "Month 2026" across runs
                    if not t.text:continue
                    if re.search(r'Month 20\d\d',t.text):t.text=re.sub(r'Month 20\d\d',when,t.text)
                    elif 'Month' in t.text:t.text=t.text.replace('Month',month)
                    elif re.fullmatch(r'\s*20\d\d\s*',t.text) and year:t.text=re.sub(r'20\d\d',year,t.text)

    def contents(self,sdt,entries):
        content=sdt.find(W+'sdtContent');paragraphs=content.findall(W+'p')
        for p in paragraphs[1:]:content.remove(p)
        field=lambda kind:(lambda r:(r.append(el('fldChar',fldCharType=kind)),r)[1])(el('r'))
        for index,(level,words) in enumerate(entries):
            p=el('p');props=el('pPr');props.append(el('pStyle',val=self.style('TOC'+str(level),'TOC1')));p.append(props)
            if index==0:
                p.append(field('begin'));instr=el('r');code=etree.SubElement(instr,W+'instrText');code.text=' TOC \\o "1-2" \\h \\z \\u ';code.set('{http://www.w3.org/XML/1998/namespace}space','preserve');p.append(instr);p.append(field('separate'))
            run=el('r');t=etree.SubElement(run,W+'t');t.text=words;p.append(run)
            if index==len(entries)-1:p.append(field('end'))
            content.append(p)

    def footnotes(self):
        if 'word/footnotes.xml' not in self.parts:
            if self.notes:raise TemplateError('The template has no footnotes part, but the source has footnotes.')
            return []
        root=etree.fromstring(self.parts['word/footnotes.xml']);texts=[]
        for note in [n for n in root.iter(W+'footnote') if n.get(W+'type') is None]:root.remove(note)
        style=self.style('vmwfootnote','FootnoteText')
        for old,new in sorted(self.notes.items(),key=lambda item:item[1]):
            note=el('footnote',id=new);first=True
            for p in self.source.footnotes[old].iter(W+'p'):
                made=el('p');props=el('pPr');made.append(props)
                if style:props.append(el('pStyle',val=style))
                if first:
                    mark=el('r');mp=el('rPr');mp.append(el('rStyle',val='FootnoteReference') if self.style('FootnoteReference') else el('vertAlign',val='superscript'));mark.append(mp);mark.append(el('footnoteRef'));made.append(mark)
                    space=el('r');t=etree.SubElement(space,W+'t');t.text=' ';t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');made.append(space);first=False
                for child in p.iter(W+'r'):
                    if child.find(W+'footnoteRef') is not None:continue
                    run=el('r')
                    for piece in child:
                        if etree.QName(piece).localname in ('t','tab'):run.append(copy.deepcopy(piece))
                    if len(run):made.append(run)
                note.append(made)
            texts.append(' '.join(text_of(self.source.footnotes[old]).split()));root.append(note)
        self.parts['word/footnotes.xml']=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
        return texts

    def fill(self,name=None,when=None,closing_from=None):
        children=list(self.body);prototype=next((c for c in children if c.tag==W+'tbl'),None)
        made,title,subtitle=self.blocks(prototype)
        if not made:raise TemplateError('The source has no text to place.')
        title=title or name or 'Untitled';when=when or datetime.date.today().strftime('%B %Y')
        breaks=[c for c in children if c.tag==W+'p' and c.find(W+'pPr/'+W+'sectPr') is not None]
        final=children[-1] if children and children[-1].tag==W+'sectPr' else None
        if not breaks or final is None:raise TemplateError('The template does not have the expected section structure.')
        split=breaks[-1];sdt=next((c for c in children if c.tag==W+'sdt'),None);head_end=-1
        if sdt is not None:   # a cover and contents come first: keep them, up to the page break that ends them
            after=children.index(sdt)
            head_end=next((i for i in range(after+1,len(children)) if children[i].tag==W+'p' and children[i].find('.//'+W+'br[@'+W+'type="page"]') is not None),after)
        for index,child in enumerate(children):
            if index>head_end and child is not split and child is not final:self.body.remove(child)
        closing=[]
        if sdt is not None and closing_from:raise TemplateError('closing_from applies only to a template without a back page.')
        if sdt is None:   # no back page: the last section carries the legal footer, so the last part of the text goes there
            starts=[i for i,(kind,_,_) in enumerate(made) if kind=='h1']
            if closing_from:   # the caller says which section opens that page
                wanted=' '.join(closing_from.split())
                at=[i for i,(kind,_,words) in enumerate(made) if kind in ('h1','h2') and words and ' '.join(words[0].split())==wanted]
                if len(at)!=1 or at[0]<=(starts[0] if starts else 0):
                    raise TemplateError(f'closing_from names the heading {closing_from!r}; it must match exactly one heading after the first section.')
                closing=made[at[0]:];made=made[:at[0]]
            elif len(starts)>=2:closing=made[starts[-1]:];made=made[:starts[-1]]
        position=self.body.index(split)
        for offset,(_,node,_) in enumerate(made):self.body.insert(position+offset,node)
        for _,node,_ in closing:final.addprevious(node)
        if sdt is not None:self.contents(sdt,[(int(kind[1]),' '.join(words[0].split())) for kind,_,words in made if kind in ('h1','h2') and words])
        everything=made+closing
        for part in [n for n in self.parts if re.fullmatch(r'word/(header|footer)\d*\.xml',n)]:
            root=etree.fromstring(self.parts[part]);self.headings(root,title,subtitle,when)
            self.parts[part]=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
        self.headings(self.doc,title,subtitle,when)
        notes=self.footnotes()
        self.parts['word/document.xml']=etree.tostring(self.doc,xml_declaration=True,encoding='UTF-8',standalone=True)
        self.parts['word/_rels/document.xml.rels']=etree.tostring(self.rels,xml_declaration=True,encoding='UTF-8',standalone=True)
        if self.numbering is not None:self.parts['word/numbering.xml']=etree.tostring(self.numbering,xml_declaration=True,encoding='UTF-8',standalone=True)
        types=etree.fromstring(self.parts['[Content_Types].xml']);ct='{http://schemas.openxmlformats.org/package/2006/content-types}'
        for override in types.iter(ct+'Override'):   # the result is a document, whatever the template was
            if override.get('PartName')=='/word/document.xml':override.set('ContentType','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
        have={d.get('Extension').lower() for d in types.iter(ct+'Default')}
        for ext in {n.rsplit('.',1)[-1].lower() for n in self.parts if n.startswith('word/media/source')}-have:
            types.insert(0,etree.Element(ct+'Default',Extension=ext,ContentType=TYPES[ext]))
        self.parts['[Content_Types].xml']=etree.tostring(types,xml_declaration=True,encoding='UTF-8',standalone=True)
        if sdt is not None and 'word/settings.xml' in self.parts:   # Word refreshes the contents' page numbers when it opens the file
            settings=etree.fromstring(self.parts['word/settings.xml'])
            if settings.find(W+'updateFields') is None:settings.insert(0,el('updateFields',val='true'))
            self.parts['word/settings.xml']=etree.tostring(settings,xml_declaration=True,encoding='UTF-8',standalone=True)
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
            for name_ in dict.fromkeys(self.order):z.writestr(name_,self.parts[name_])
        counts={k:sum(1 for kind,_,_ in everything if kind==k) for k in ('h1','h2','h3','body','bullet','number','table')}
        report={'title':title,'subtitle':subtitle,'date':when,'blocks':counts,'pictures':self.pictures,'links':len(self.links),'footnotes':len(notes),
                'contents_entries':sum(1 for kind,_,words in made if kind in ('h1','h2') and words) if sdt is not None else 0,
                'closing_section':closing[0][2][0] if closing and closing[0][2] else None,'not_carried':sorted(set(self.dropped)),'guessed':self.guessed,'code_runs':self.code,'subtitle_scale':self.subtitle_scale,'running_head':self.short_head,'title_scale':self.title_scale}
        report['headings']=[' '.join(words[0].split()) for kind,_,words in everything if kind in ('h1','h2') and words]
        report['captions']=[' '.join(everything[i+1][2][0].split()) for i,(kind,node,_) in enumerate(everything[:-1])
                            if kind!='table' and node.find('.//'+W+'drawing') is not None and everything[i+1][2]]
        expected={'text':[' '.join(w.split()) for _,_,words in everything for w in words],'links':sorted(self.links),'pictures':self.media,'drawings':self.pictures,'footnotes':notes}
        return out.getvalue(),report,expected


def placed(data,expected):
    """Read the result back and confirm every block of text, link, picture and footnote is in it, in order."""
    parts,_=unpack(data);doc=etree.fromstring(parts['word/document.xml']);body=doc.find(W+'body')
    found=[' '.join(text_of(p).split()) for child in body for p in ([child] if child.tag==W+'p' else child.iter(W+'p')) if child.tag in (W+'p',W+'tbl') and text_of(p).strip()]
    position=0;missing=[]
    for words in expected['text']:
        try:position=found.index(words,position)+1
        except ValueError:missing.append(words[:60])
    rels=rels_of(parts,'word/document.xml')
    links=sorted(r.get('Target') for r in rels.values() if r.get('Type')==LINK and r.get('Target') in expected['links'])
    pictures=sum(1 for r in rels.values() if r.get('Type')==IMAGE and '/source' in '/'+r.get('Target'))
    notes=[' '.join(text_of(n).split()) for n in etree.fromstring(parts['word/footnotes.xml']).iter(W+'footnote') if n.get(W+'type') is None] if 'word/footnotes.xml' in parts else []
    problems=[]
    if missing:problems.append(f'{len(missing)} block(s) of text are missing or out of order, starting with: {missing[0]!r}')
    if len(set(links))<len(set(expected['links'])):problems.append('a link was lost')
    if pictures!=expected['pictures']:problems.append('a picture was lost')
    if [n.strip() for n in notes]!=[n.strip() for n in expected['footnotes']]:problems.append('a footnote was lost or changed')
    return problems


def fill(template,source,*,name=None,when=None,closing_from=None):
    """(document bytes, report, what a copy of it must still contain). Raises TemplateError when
    anything the source says could not be placed. closing_from names the heading that opens the
    final page of a template without a back page; without it the last level-1 section does."""
    data,report,expected=Filler(template,source).fill(name,when,closing_from)
    problems=placed(data,expected)
    if problems:raise TemplateError('The filled template lost content: '+'; '.join(problems)+'. No output was written.')
    report['content_verified']=True
    return data,report,expected


def returned(data,expected):
    """After a conversion (Google's import): the words and links must survive; pictures and footnotes are
    stored differently there, so they are counted, not matched part for part."""
    parts,_=unpack(data);doc=etree.fromstring(parts['word/document.xml'])
    found=' '.join(' '.join(text_of(p).split()) for p in doc.iter(W+'p'))
    missing=[words[:60] for words in expected['text'] if words not in found]
    targets={r.get('Target') for r in rels_of(parts,'word/document.xml').values() if r.get('Type')==LINK}
    problems=[]
    if missing:problems.append(f'{len(missing)} block(s) of text did not survive, starting with: {missing[0]!r}')
    if not set(expected['links'])<=targets:problems.append('a link did not survive')
    if sum(1 for _ in doc.iter(W+'drawing'))<expected.get('drawings',expected['pictures']):problems.append('a picture did not survive')
    return problems


if __name__=='__main__':
    import argparse,json
    from pathlib import Path
    p=argparse.ArgumentParser(description='Flow a .docx into a Word template (local check; rebrand run --document does the same with brand assets).')
    p.add_argument('template');p.add_argument('source');p.add_argument('output');p.add_argument('--name');a=p.parse_args()
    data,report,_=fill(Path(a.template).read_bytes(),Path(a.source).read_bytes(),name=a.name)
    Path(a.output).write_bytes(data);print(json.dumps(report,indent=2))
