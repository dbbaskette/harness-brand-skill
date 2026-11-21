"""Setting a filled template's layout slots (document_layout)."""
import io,sys,unittest,zipfile
from pathlib import Path
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from lxml import etree
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import document_template as D
import document_layout as L
from test_document_template import template,source,body

W=D.W
BOX=('<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml">'
     '<w:pict><v:shape id="box{n}" type="#_x0000_t202"><v:textbox><w:txbxContent>'
     '<w:p><w:pPr><w:pStyle w:val="vmwSidebarheading"/></w:pPr><w:r><w:t>Sample sidebar {n}</w:t></w:r></w:p>'
     '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>')


def png():
    raw=io.BytesIO();Image.new('RGBA',(8,8),'navy').save(raw,'PNG');return raw.getvalue()


def sidebar_template(boxes=2,icon_table=True):
    """The plain test template plus the parts a solution brief has: sidebar styles, sidebar text boxes
    in the sample copy, and the invisible table style an icon row is set in."""
    d=Document(io.BytesIO(template()))
    for name in ('vmwSidebarheading','vmwSidebarheadingnospacebefore','vmwSidebarquote','vmwSidebarquotenamelastwithunderline'):
        d.styles.add_style(name,WD_STYLE_TYPE.PARAGRAPH)
    if icon_table:d.styles.add_style('vmwinvisibletable',WD_STYLE_TYPE.TABLE)
    samples=[p for p in d.paragraphs if p.text.startswith('Sample')]
    for n in range(boxes):samples[0]._p.append(etree.fromstring(BOX.format(n=n+1)))
    out=io.BytesIO();d.save(out);return out.getvalue()


def filled(extra=None,**kw):
    data,_,expected=D.fill(sidebar_template(),source(extra),**kw);return data,expected


def heading(data,words):
    return next(p for p in body(data).iter(W+'p') if D.text_of(p)==words)


class Anchors(unittest.TestCase):
    def test_a_page_break_goes_before_the_named_heading(self):
        data,_=filled()
        out,report,_=L.apply(data,sidebar_template(),{'page_break_before':['Second part']})
        self.assertIsNotNone(heading(out,'Second part').find(W+'pPr/'+W+'pageBreakBefore'))
        self.assertIsNone(heading(out,'First part').find(W+'pPr/'+W+'pageBreakBefore'))
        self.assertEqual(report['page_breaks'],['Second part'])

    def test_a_heading_that_matches_no_section_is_refused(self):
        data,_=filled()
        with self.assertRaises(D.TemplateError) as raised:L.apply(data,sidebar_template(),{'page_break_before':['Nowhere']})
        self.assertIn("'Nowhere'",str(raised.exception))

    def test_unknown_keys_are_refused(self):
        data,_=filled()
        with self.assertRaises(D.TemplateError):L.apply(data,sidebar_template(),{'sidebar':[]})

    def test_the_figure_stays_with_the_paragraph_after_it(self):
        def picture(d):
            d.add_picture(io.BytesIO(png()));d.add_paragraph('Figure 1: A caption')
        data,_=filled(picture)
        out,report,_=L.apply(data,sidebar_template(),{'figure':{}})
        holder=next(p for p in body(out).findall(W+'p') if p.find('.//'+W+'drawing') is not None)
        props=holder.find(W+'pPr')
        self.assertIsNotNone(props.find(W+'keepNext'))
        self.assertEqual(props.find(W+'spacing').get(W+'before'),'240')
        names=[etree.QName(c).localname for c in props]
        self.assertLess(names.index('keepNext'),names.index('spacing'))   # the order Word's schema asks for
        self.assertEqual(report['figures'],1)

    def test_an_empty_layout_changes_nothing_that_was_placed(self):
        data,expected=filled()
        out,_,words=L.apply(data,sidebar_template(),{})
        self.assertEqual(D.returned(out,expected),[]);self.assertEqual(words,[])


class Sidebars(unittest.TestCase):
    BARS={'sidebars':[
        {'page_of':None,'blocks':[{'type':'heading','text':'At a glance'},{'type':'bullet','text':'**Reach** – where it runs'}]},
        {'page_of':'Second part','blocks':[{'type':'stat','text':'76 percent say so','attribution':'A survey, 2026'}]}]}

    def boxed(self,p):
        return [(L.style_of(q),D.text_of(q)) for box in list(p.iter(W+'txbxContent'))[:1] for q in box.iter(W+'p')]

    def test_each_sidebar_goes_in_a_copy_of_the_templates_box_on_its_page(self):
        data,_=filled()
        out,report,words=L.apply(data,sidebar_template(),self.BARS)
        opening=next(p for p in body(out).findall(W+'p') if 'An opening paragraph.' in D.text_of(p))
        self.assertEqual(self.boxed(opening),[('vmwSidebarheadingnospacebefore','At a glance'),('vmwbullet1','Reach – where it runs')])
        later=heading(out,'Second part').getnext()
        self.assertEqual(self.boxed(later),[('vmwSidebarquote','76 percent say so'),('vmwSidebarquotenamelastwithunderline','A survey, 2026')])
        self.assertEqual(report['sidebars'],2)
        self.assertEqual(words,['At a glance','Reach – where it runs','76 percent say so','A survey, 2026'])

    def test_the_first_page_uses_the_first_box_and_later_pages_the_second(self):
        data,_=filled()
        out,_,_=L.apply(data,sidebar_template(),self.BARS)
        ids=[s.get('id') for s in body(out).iter('{urn:schemas-microsoft-com:vml}shape')]
        self.assertEqual(ids,['Sidebar_1','Sidebar_2'])

    def test_bold_marks_become_bold_runs_and_the_sample_copy_is_gone(self):
        data,_=filled()
        out,_,_=L.apply(data,sidebar_template(),self.BARS)
        xml=zipfile.ZipFile(io.BytesIO(out)).read('word/document.xml').decode()
        self.assertNotIn('Sample sidebar',xml);self.assertNotIn('**',xml)
        bold=[r for r in body(out).iter(W+'r') if r.find(W+'rPr/'+W+'b') is not None and D.text_of(r)=='Reach']
        self.assertEqual(len(bold),1)

    def test_a_quote_is_set_in_quotation_marks(self):
        data,_=filled()
        out,_,words=L.apply(data,sidebar_template(),{'sidebars':[{'page_of':'First part','blocks':[{'type':'quote','text':'It works.','attribution':'A. Person, Example Co'}]}]})
        self.assertEqual(words[0],'“It works.”')

    def test_two_sidebars_in_one_place_and_a_stat_without_a_source_are_refused(self):
        data,_=filled()
        twice={'sidebars':[{'page_of':'First part','blocks':[{'type':'body','text':'a'}]},{'page_of':'First part','blocks':[{'type':'body','text':'b'}]}]}
        with self.assertRaises(D.TemplateError):L.apply(data,sidebar_template(),twice)
        with self.assertRaises(D.TemplateError):L.apply(data,sidebar_template(),{'sidebars':[{'page_of':None,'blocks':[{'type':'stat','text':'9 in 10'}]}]})

    def test_a_template_without_sidebar_boxes_is_refused(self):
        data,_=filled()
        with self.assertRaises(D.TemplateError) as raised:L.apply(data,sidebar_template(boxes=0),self.BARS)
        self.assertIn('no sidebar',str(raised.exception))


class IconRow(unittest.TestCase):
    ROW={'icon_row':{'before':'First part','items':[
        {'icon':'functional-icons.database','label':'AI-ready data','detail':'Governed data products'},
        {'icon':'functional-icons.identity','label':'Agent identity','detail':'Tied to a person'}]}}

    def test_the_row_is_a_table_of_icons_and_captions_above_its_heading(self):
        data,_=filled();asked=[]
        out,report,words=L.apply(data,sidebar_template(),self.ROW,lambda ident:asked.append(ident) or png())
        table=heading(out,'First part').getprevious()
        self.assertEqual(table.tag,W+'tbl');self.assertEqual(table.find(W+'tblPr/'+W+'tblStyle').get(W+'val'),'vmwinvisibletable')
        cells=list(table.iter(W+'tc'));self.assertEqual(len(cells),2)
        self.assertEqual([D.text_of(p) for p in cells[0].iter(W+'p')],['','AI-ready data','Governed data products'])
        self.assertEqual(len(list(table.iter(W+'drawing'))),2)
        self.assertEqual(asked,['functional-icons.database','functional-icons.identity'])
        self.assertEqual(report['icons'],asked)
        self.assertEqual(words,['AI-ready data','Governed data products','Agent identity','Tied to a person'])

    def test_each_icon_is_stored_and_related_once(self):
        data,_=filled()
        row={'icon_row':{'before':'First part','items':[dict(self.ROW['icon_row']['items'][0]),dict(self.ROW['icon_row']['items'][0])]}}
        out,_,_=L.apply(data,sidebar_template(),row,lambda ident:png())
        with zipfile.ZipFile(io.BytesIO(out)) as z:
            self.assertEqual([n for n in z.namelist() if n.startswith('word/media/icon-')],['word/media/icon-functional-icons.database.png'])
            self.assertEqual(z.read('word/_rels/document.xml.rels').decode().count('media/icon-functional-icons.database.png'),1)
            self.assertIn('Extension="png"',z.read('[Content_Types].xml').decode())
        Document(io.BytesIO(out))   # python-docx can still open it

    def test_five_icons_a_missing_caption_and_a_template_without_the_table_are_refused(self):
        data,_=filled();item=self.ROW['icon_row']['items'][0]
        with self.assertRaises(D.TemplateError):L.apply(data,sidebar_template(),{'icon_row':{'before':'First part','items':[item]*5}},lambda i:png())
        with self.assertRaises(D.TemplateError):L.apply(data,sidebar_template(),{'icon_row':{'before':'First part','items':[{'icon':'x','label':'y'}]}},lambda i:png())
        bare,_,_=D.fill(sidebar_template(icon_table=False),source())   # the filled document carries the template's styles
        with self.assertRaises(D.TemplateError) as raised:L.apply(bare,sidebar_template(icon_table=False),self.ROW,lambda i:png())
        self.assertIn('no icon row',str(raised.exception))


class Kept(unittest.TestCase):
    def test_every_word_the_layout_added_is_found_and_a_lost_one_is_named(self):
        data,expected=filled()
        out,_,words=L.apply(data,sidebar_template(),Sidebars.BARS)
        self.assertEqual(L.kept(out,words),[])
        self.assertEqual(D.returned(out,expected),[])   # and the main column still has the source's words
        problems=L.kept(out,words+['Not in the document'])
        self.assertEqual(len(problems),1);self.assertIn('Not in the document',problems[0])


if __name__=='__main__':unittest.main()
