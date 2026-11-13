"""Apply the bundled document identity without replacing document text."""
from __future__ import annotations
import io,json
from pathlib import Path
from docx import Document
from docx.shared import Inches,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT=Path(__file__).resolve().parents[1]
from brand_config import BRAND,PROFILE,RULES


def apply(data):
    doc=Document(io.BytesIO(data))
    stats={'heading_styles':0,'table_cells':0,'header_logos':0}
    for style in doc.styles:
        if style.type==1:
            style.font.name=BRAND['font']
            if style.name.startswith(('Heading','Title','Subtitle')):
                style.font.color.rgb=RGBColor.from_string(BRAND['roles']['title'].lstrip('#'))
                style.font.bold=False
    # Preserve run text, links, lists, bookmarks, drawings and fields, including nested cells.
    for p in doc.element.iter(qn('w:p')):
        pp=p.find(qn('w:pPr'))
        ps=pp.find(qn('w:pStyle')) if pp is not None else None
        if ps is not None and ps.get(qn('w:val'),'').lower().startswith(('heading','title','subtitle')):
            for run in p.iter(qn('w:r')):
                rp=run.get_or_add_rPr()
                color=rp.find(qn('w:color'))
                if color is None:color=OxmlElement('w:color');rp.append(color)
                color.set(qn('w:val'),BRAND['roles']['title'].lstrip('#'))
                for a in ('themeColor','themeTint','themeShade'):color.attrib.pop(qn('w:'+a),None)
            stats['heading_styles']+=1
    for table in doc.element.iter(qn('w:tbl')):
        for i,row in enumerate(table.findall(qn('w:tr'))):
            for cell in row.findall(qn('w:tc')):
                props=cell.get_or_add_tcPr()
                shade=props.find(qn('w:shd'))
                if shade is None:shade=OxmlElement('w:shd');props.append(shade)
                shade.set(qn('w:fill'),BRAND['table']['header_fill' if i==0 else 'band1' if i%2 else 'band2'].lstrip('#'))
                shade.set(qn('w:val'),'clear')
                for a in ('themeFill','themeFillTint','themeFillShade'):shade.attrib.pop(qn('w:'+a),None)
                for run in cell.iter(qn('w:r')):
                    rp=run.get_or_add_rPr();color=rp.find(qn('w:color'))
                    if color is None:color=OxmlElement('w:color');rp.append(color)
                    color.set(qn('w:val'),BRAND['table']['header_text' if i==0 else 'text'].lstrip('#'))
                    for a in ('themeColor','themeTint','themeShade'):color.attrib.pop(qn('w:'+a),None)
                stats['table_cells']+=1
    seen=set()
    for section in doc.sections:
        headers=[section.header]
        if section.different_first_page_header_footer:headers.append(section.first_page_header)
        if doc.settings.odd_and_even_pages_header_footer:headers.append(section.even_page_header)
        for header in headers:
            if str(header.part.partname) in seen:continue
            seen.add(str(header.part.partname))
            if any(e.get('name')==RULES.get('doc_logo_name',BRAND['name']+' logo') for e in header._element.iter(qn('wp:docPr'))):continue
            paragraph=header.add_paragraph()
            inline=paragraph.add_run().add_picture(str(PROFILE/RULES['doc_logo']),width=Inches(1.65))
            inline._inline.docPr.set('name',RULES.get('doc_logo_name',BRAND['name']+' logo'))
            props=paragraph._p.get_or_add_pPr();borders=OxmlElement('w:pBdr');bottom=OxmlElement('w:bottom')
            for k,v in {'val':'single','sz':'12','color':RULES['doc_rule'],'space':'8'}.items():bottom.set(qn('w:'+k),v)
            borders.append(bottom);props.append(borders)
            stats['header_logos']+=1
    out=io.BytesIO();doc.save(out)
    return out.getvalue(),stats
