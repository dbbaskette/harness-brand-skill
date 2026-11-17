"""Flowing a source document into a brand's Word template (document_template)."""
import io,sys,unittest,zipfile
from pathlib import Path
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.section import WD_SECTION
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import document_template as D

W=D.W


def template(cover=False):
    """A small template with the parts the filler relies on: named styles, sample copy, a section
    break before the last section, a headline in the header and, optionally, a cover page."""
    d=Document()
    for name in ('vmwbodycopy','vmwHeadline','vmwSubhead','vmwHeadlinepage2onwards','vmwbullet1','vmwnumbered','vmwtablebodycopy','vmwtableheadingtop'):
        d.styles.add_style(name,WD_STYLE_TYPE.PARAGRAPH)
    import copy
    numbered=d.styles['vmwnumbered'].element;numbered.get_or_add_pPr().append(copy.deepcopy(d.styles['List Number'].element.pPr.numPr))
    header=d.sections[0].header
    header.paragraphs[0].text='Headline – Title Case';header.paragraphs[0].style=d.styles['vmwHeadline']
    header.add_paragraph('Subhead – sentence case',style='vmwSubhead')
    header.add_paragraph('WHITE PAPER Month 2026',style='vmwbodycopy')
    if cover:
        d.add_paragraph('Cover',style='vmwbodycopy')
    d.add_paragraph('Heading 1 – sentence case',style='Heading 1')
    d.add_paragraph('Sample body copy to be replaced.',style='vmwbodycopy')
    table=d.add_table(rows=1,cols=1);table.cell(0,0).text='Sample table'
    d.add_section(WD_SECTION.NEW_PAGE)
    d.add_paragraph('Sample closing copy.',style='vmwbodycopy')
    out=io.BytesIO();d.save(out);return out.getvalue()


def source(extra=None):
    d=Document()
    d.add_paragraph('A Clear Title',style='Title');d.add_paragraph('And its subtitle',style='Subtitle')
    d.add_paragraph('An opening paragraph.')
    d.add_heading('First part',1);p=d.add_paragraph('Words with ');p.add_run('emphasis').bold=True
    d.add_paragraph('One',style='List Number');d.add_paragraph('Two',style='List Number')
    d.add_paragraph('A point',style='List Bullet')
    d.add_heading('Second part',1)
    d.add_paragraph('One again',style='List Number')
    t=d.add_table(rows=2,cols=2)
    for i,row in enumerate((('Name','Value'),('alpha','1'))):
        for j,v in enumerate(row):t.cell(i,j).text=v
    d.add_heading('Last part',1);d.add_paragraph('Closing words.')
    if extra:extra(d)
    out=io.BytesIO();d.save(out);return out.getvalue()


def body(data):
    from lxml import etree
    doc=etree.fromstring(zipfile.ZipFile(io.BytesIO(data)).read('word/document.xml'))
    return doc.find(W+'body')


def paragraphs(data):
    return [(p.find(W+'pPr/'+W+'pStyle').get(W+'val') if p.find(W+'pPr/'+W+'pStyle') is not None else None,D.text_of(p)) for p in body(data).iter(W+'p') if D.text_of(p).strip()]


class Fill(unittest.TestCase):
    def test_source_words_replace_the_sample_copy_in_template_styles(self):
        data,report,_=D.fill(template(),source())
        found=paragraphs(data);texts=[t for _,t in found]
        for sample in ('Sample body copy to be replaced.','Sample table','Sample closing copy.','Heading 1 – sentence case'):self.assertNotIn(sample,texts)
        self.assertIn(('Heading1','First part'),found);self.assertIn(('vmwbodycopy','Words with emphasis'),found)
        self.assertIn(('vmwbullet1','A point'),found);self.assertIn(('vmwnumbered','Two'),found)
        self.assertIn(('vmwtableheadingtop','Name'),found);self.assertIn(('vmwtablebodycopy','alpha'),found)
        self.assertEqual(report['blocks'],{'h1':3,'h2':0,'h3':0,'body':3,'bullet':1,'number':3,'table':1})
        self.assertTrue(report['content_verified']);self.assertEqual(report['not_carried'],[])

    def test_title_and_subtitle_go_to_the_header_not_the_body(self):
        data,report,_=D.fill(template(),source(),when='March 2027')
        parts=zipfile.ZipFile(io.BytesIO(data));headers=''.join(parts.read(n).decode() for n in parts.namelist() if 'header' in n)
        self.assertIn('A Clear Title',headers);self.assertIn('And its subtitle',headers);self.assertNotIn('Headline – Title Case',headers)
        self.assertIn('March 2027',headers);self.assertNotIn('Month 2026',headers)
        self.assertNotIn('A Clear Title',[t for _,t in paragraphs(data)])
        self.assertEqual((report['title'],report['subtitle']),('A Clear Title','And its subtitle'))

    def test_a_source_without_a_title_takes_the_given_name(self):
        def untitled():
            d=Document();d.add_heading('Only part',1);d.add_paragraph('Words.');out=io.BytesIO();d.save(out);return out.getvalue()
        _,report,_=D.fill(template(),untitled(),name='From the file name')
        self.assertEqual(report['title'],'From the file name');self.assertIsNone(report['subtitle'])

    def test_a_first_heading_is_the_title_when_no_title_style_is_used(self):
        def headed():
            d=Document();d.add_heading('The Paper Itself',1);d.add_paragraph('A short line under it, with no full stop')
            d.add_paragraph('The opening paragraph ends with a full stop.');d.add_heading('First part',1);d.add_paragraph('Words.')
            out=io.BytesIO();d.save(out);return out.getvalue()
        data,report,_=D.fill(template(),headed())
        self.assertEqual((report['title'],report['subtitle'],report['guessed']),('The Paper Itself','A short line under it, with no full stop',['title','subtitle']))
        texts=[t for _,t in paragraphs(data)];self.assertNotIn('The Paper Itself',texts);self.assertIn('The opening paragraph ends with a full stop.',texts)

    def test_bold_is_kept_and_other_formatting_is_dropped(self):
        def styled(d):
            run=d.add_paragraph('Plain ').add_run('loud');run.bold=True;run.font.name='Comic Sans MS';run.font.size=__import__('docx').shared.Pt(30)
        data,_,_=D.fill(template(),source(styled))
        xml=zipfile.ZipFile(io.BytesIO(data)).read('word/document.xml').decode()
        self.assertIn('loud',xml);self.assertNotIn('Comic Sans',xml);self.assertNotIn('w:sz w:val="60"',xml)
        loud=next(r for r in body(data).iter(W+'r') if D.text_of(r)=='loud');self.assertIsNotNone(loud.find(W+'rPr/'+W+'b'))

    def test_a_numbered_list_after_a_heading_starts_again(self):
        data,_,_=D.fill(template(),source())
        ids={D.text_of(p):p.find(W+'pPr/'+W+'numPr/'+W+'numId').get(W+'val') for p in body(data).iter(W+'p') if p.find(W+'pPr/'+W+'numPr') is not None}
        self.assertEqual(ids['One'],ids['Two']);self.assertNotEqual(ids['One'],ids['One again'])

    def test_last_part_opens_the_closing_section_when_there_is_no_cover(self):
        data,report,_=D.fill(template(),source())
        self.assertEqual(report['closing_section'],'Last part')
        children=list(body(data));split=next(i for i,c in enumerate(children) if c.find(W+'pPr/'+W+'sectPr') is not None)
        after=[D.text_of(c) for c in children[split+1:] if c.tag==W+'p' and D.text_of(c)]
        self.assertEqual(after,['Last part','Closing words.'])

    def test_pictures_are_carried_and_fitted_to_the_column(self):
        from PIL import Image
        def pictured(d):
            raw=io.BytesIO();Image.new('RGB',(400,100),'navy').save(raw,'PNG');raw.seek(0)
            d.add_picture(raw,width=__import__('docx').shared.Inches(12))
        data,report,_=D.fill(template(),source(pictured))
        self.assertEqual(report['pictures'],1)
        names=zipfile.ZipFile(io.BytesIO(data)).namelist();self.assertIn('word/media/source1.png',names)
        extent=next(body(data).iter(D.WP+'extent'));self.assertLessEqual(int(extent.get('cx')),6*914400+1)

    def test_lost_words_are_caught_in_a_converted_copy(self):
        data,_,expected=D.fill(template(),source())
        self.assertEqual(D.returned(data,expected),[])
        broken=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as z,zipfile.ZipFile(broken,'w') as out:
            for item in z.infolist():
                raw=z.read(item)
                if item.filename=='word/document.xml':raw=raw.replace(b'Closing words.',b'Other words.')
                out.writestr(item,raw)
        self.assertIn('did not survive',' '.join(D.returned(broken.getvalue(),expected)))

    def test_an_empty_source_and_a_template_without_sections_are_refused(self):
        empty=io.BytesIO();Document().save(empty)
        with self.assertRaisesRegex(D.TemplateError,'no text to place'):D.fill(template(),empty.getvalue())
        plain=io.BytesIO();Document().save(plain)
        with self.assertRaisesRegex(D.TemplateError,'section structure'):D.fill(plain.getvalue(),source())


if __name__=='__main__':unittest.main()
