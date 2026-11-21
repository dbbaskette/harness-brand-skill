# Harness Brand Document Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rebrand run --document solution-brief --layout FILE` fills a brand document template's sidebars, icon row, figure and page breaks, and reports which page each landed on.

**Architecture:** `document_template.fill` keeps placing the source's words in the main column and gains one argument, `closing_from`. A new module, `document_layout.py`, takes the filled document and a layout (a JSON object) and sets the other slots, each anchored to a heading. A second new module, `document_pages.py`, renders the result and reports page positions. `brand.py` wires both behind `--layout`.

**Tech Stack:** Python 3.11+, lxml, python-docx (tests only), Pillow, `unittest`; LibreOffice and poppler's `pdftotext` for the page report.

**Repository:** `~/Projects/harness-brand-skill`, branch from `main` (currently 1.2.3). All paths below are relative to it.

**Design:** `docs/superpowers/specs/2026-11-20-solution-brief-design.md` in the Marketing Studio repository (github.com/dbbaskette/marketing-studio). Two deliberate differences from it:

- The icon row is anchored with `before` (the heading it sits above), not `after`.
- A template does not declare its slots. They are detected: a template has sidebars when it contains a text box with a `vmwSidebar…` style, and an icon row when it has the `vmwinvisibletable` style. No brand data changes.

**Reference:** `test-runs/solution-brief-reference/reference-build/add_sidebars.py` is the one-off script this ports. It produced a real five-page brief on 2026-11-20. That folder is git-ignored and private: read it, never commit it.

**Run the tests with:** `python3 -m unittest discover -s rebrand/tests -v` (use `rebrand/.venv/bin/python3` if the system Python lacks lxml, python-docx or Pillow).

---

## The layout file

```json
{
  "template": "solution-brief",
  "closing_from": "Why us",
  "page_break_before": ["The platform"],
  "figure": {},
  "icon_row": {
    "before": "The risks",
    "items": [
      {"icon": "functional-icons.database", "label": "AI-ready data",
       "detail": "Governed data products with context and lineage"}
    ]
  },
  "sidebars": [
    {"page_of": null,
     "blocks": [{"type": "heading", "text": "At a glance"},
                {"type": "bullet", "text": "**Reach** – where it runs"}]},
    {"page_of": "The platform",
     "blocks": [{"type": "stat", "text": "9 in 10 teams say so",
                 "attribution": "A survey, 2026"}]}
  ]
}
```

- Every heading named must match exactly one level-1 or level-2 heading of the source.
- `page_of: null` is the opening page (the sidebar is anchored to the first body paragraph and uses the template's first-page box). A heading anchors the sidebar to the first paragraph after it.
- Block types: `heading`, `body`, `bullet`, `stat`, `quote`. `stat` and `quote` need `attribution`. `**bold**` is the only inline markup.
- `figure: {}` keeps every top-level picture on one page with the paragraph after it (its caption).

## File structure

| File | Responsibility |
| --- | --- |
| `rebrand/scripts/document_template.py` (modify) | `fill(..., closing_from=None)` chooses the section that starts the final page. |
| `rebrand/scripts/document_layout.py` (create) | Validate a layout; set page breaks, figure, sidebars, icon row; check the words landed. |
| `rebrand/scripts/markdown_source.py` (create) | Read a Markdown brief as a Word source. |
| `rebrand/scripts/document_pages.py` (create) | Render to PDF, read each page's text, report where headings, sidebars and the figure are. |
| `rebrand/scripts/brand.py` (modify) | `--layout FILE`; call the two modules from `document()`. |
| `rebrand/scripts/reporting.py` (modify) | A "Layout" paragraph in `report.md`. |
| `rebrand/tests/test_document_layout.py` (create) | Tests for `document_layout`. |
| `rebrand/tests/test_document_pages.py` (create) | Tests for `document_pages.locate`. |
| `references/rebranding.md`, `docs/rebranding-profile-format.md`, `CHANGELOG.md`, `package.json` (modify) | Document the option; version 1.3.0. |

---

### Task 1: `closing_from` chooses the final page's section

**Files:**
- Modify: `rebrand/scripts/document_template.py` (`Filler.fill`, the module-level `fill`)
- Test: `rebrand/tests/test_document_template.py`

- [ ] **Step 1: Write the failing tests**

Add to class `Fill` in `rebrand/tests/test_document_template.py`, after `test_last_part_opens_the_closing_section_when_there_is_no_cover`:

```python
    def test_closing_from_names_the_section_that_opens_the_closing_section(self):
        data,report,_=D.fill(template(),source(),closing_from='Second part')
        self.assertEqual(report['closing_section'],'Second part')
        children=list(body(data));split=next(i for i,c in enumerate(children) if c.find(W+'pPr/'+W+'sectPr') is not None)
        after=[D.text_of(c) for c in children[split+1:] if c.tag==W+'p' and D.text_of(c)]
        self.assertEqual(after[0],'Second part');self.assertIn('Closing words.',after)

    def test_closing_from_must_match_one_later_heading(self):
        with self.assertRaises(D.TemplateError):D.fill(template(),source(),closing_from='No such part')
        with self.assertRaises(D.TemplateError):D.fill(template(),source(),closing_from='First part')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest rebrand.tests.test_document_template -v 2>&1 | tail -5` from the repository root, or `cd rebrand/tests && python3 -m unittest test_document_template -v 2>&1 | tail -5`.
Expected: both new tests ERROR with `TypeError: fill() got an unexpected keyword argument 'closing_from'`.

- [ ] **Step 3: Implement**

In `rebrand/scripts/document_template.py`, change the signature of `Filler.fill`:

```python
    def fill(self,name=None,when=None,closing_from=None):
```

Replace these three lines in `Filler.fill`:

```python
        closing=[]
        if sdt is None:   # no back page: the last section carries the legal footer, so the last part of the text goes there
            starts=[i for i,(kind,_,_) in enumerate(made) if kind=='h1']
            if len(starts)>=2:closing=made[starts[-1]:];made=made[:starts[-1]]
```

with:

```python
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
```

Replace the module-level `fill`:

```python
def fill(template,source,*,name=None,when=None,closing_from=None):
    """(document bytes, report, what a copy of it must still contain). Raises TemplateError when
    anything the source says could not be placed. closing_from names the heading that opens the
    final page of a template without a back page; without it the last level-1 section does."""
    data,report,expected=Filler(template,source).fill(name,when,closing_from)
    problems=placed(data,expected)
    if problems:raise TemplateError('The filled template lost content: '+'; '.join(problems)+'. No output was written.')
    report['content_verified']=True
    return data,report,expected
```

- [ ] **Step 4: Run the whole file to verify it passes**

Run: `cd rebrand/tests && python3 -m unittest test_document_template -v 2>&1 | tail -4`
Expected: `OK`, with two more tests than before this task.

- [ ] **Step 5: Commit**

```bash
git checkout -b document-layout
git add rebrand/scripts/document_template.py rebrand/tests/test_document_template.py
git commit -m "Name the section that opens a document's final page"
```

---

### Task 2: Layout module: validation, heading anchors, page breaks, the figure

**Files:**
- Create: `rebrand/scripts/document_layout.py`
- Test: `rebrand/tests/test_document_layout.py`

- [ ] **Step 1: Write the failing tests**

Create `rebrand/tests/test_document_layout.py`:

```python
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


if __name__=='__main__':unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rebrand/tests && python3 -m unittest test_document_layout -v 2>&1 | tail -4`
Expected: `ModuleNotFoundError: No module named 'document_layout'`.

- [ ] **Step 3: Create the module**

Create `rebrand/scripts/document_layout.py`:

```python
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


STEPS=[page_breaks,figure]


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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd rebrand/tests && python3 -m unittest test_document_layout -v 2>&1 | tail -4`
Expected: `OK`, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add rebrand/scripts/document_layout.py rebrand/tests/test_document_layout.py
git commit -m "Set page breaks and keep a figure with its caption from a document layout"
```

---

### Task 3: Sidebars

**Files:**
- Modify: `rebrand/scripts/document_layout.py`
- Test: `rebrand/tests/test_document_layout.py`

- [ ] **Step 1: Write the failing tests**

Add this class to `rebrand/tests/test_document_layout.py`, above the `if __name__` line:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rebrand/tests && python3 -m unittest test_document_layout.Sidebars -v 2>&1 | tail -4`
Expected: FAIL/ERROR: `KeyError: 'sidebars'` in the first test (the report has no such key yet).

- [ ] **Step 3: Implement**

In `rebrand/scripts/document_layout.py`, add these functions above the `STEPS=` line:

```python
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
```

Replace the `STEPS=` line with:

```python
STEPS=[page_breaks,figure,sidebars]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd rebrand/tests && python3 -m unittest test_document_layout -v 2>&1 | tail -4`
Expected: `OK`, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add rebrand/scripts/document_layout.py rebrand/tests/test_document_layout.py
git commit -m "Fill a document template's sidebars from a layout"
```

---

### Task 4: The icon row

**Files:**
- Modify: `rebrand/scripts/document_layout.py`
- Test: `rebrand/tests/test_document_layout.py`

- [ ] **Step 1: Write the failing tests**

Add this class above the `if __name__` line:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rebrand/tests && python3 -m unittest test_document_layout.IconRow -v 2>&1 | tail -4`
Expected: FAIL: `AttributeError: 'NoneType' object has no attribute 'tag'` or an assertion that the previous element is not a table.

- [ ] **Step 3: Implement**

In `rebrand/scripts/document_layout.py`, add above the `STEPS=` line:

```python
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
```

Replace the `STEPS=` line with:

```python
STEPS=[page_breaks,figure,sidebars,icon_row]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd rebrand/tests && python3 -m unittest test_document_layout -v 2>&1 | tail -4`
Expected: `OK`, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add rebrand/scripts/document_layout.py rebrand/tests/test_document_layout.py
git commit -m "Set a row of library icons with captions from a document layout"
```

---

### Task 5: Check that the layout's words landed

**Files:**
- Modify: `rebrand/scripts/document_layout.py`
- Test: `rebrand/tests/test_document_layout.py`

- [ ] **Step 1: Write the failing tests**

Add this class above the `if __name__` line:

```python
class Kept(unittest.TestCase):
    def test_every_word_the_layout_added_is_found_and_a_lost_one_is_named(self):
        data,expected=filled()
        out,_,words=L.apply(data,sidebar_template(),Sidebars.BARS)
        self.assertEqual(L.kept(out,words),[])
        self.assertEqual(D.returned(out,expected),[])   # and the main column still has the source's words
        problems=L.kept(out,words+['Not in the document'])
        self.assertEqual(len(problems),1);self.assertIn('Not in the document',problems[0])
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rebrand/tests && python3 -m unittest test_document_layout.Kept -v 2>&1 | tail -4`
Expected: `AttributeError: module 'document_layout' has no attribute 'kept'`.

- [ ] **Step 3: Implement**

Add at the end of `rebrand/scripts/document_layout.py`:

```python
def kept(data,words):
    """After apply: every sidebar and icon caption the layout asked for must be in the document."""
    parts,_=unpack(data);root=etree.fromstring(parts['word/document.xml'])
    found={squeeze(text_of(p)) for p in root.iter(W+'p')}
    missing=[w for w in words if squeeze(w) not in found]
    return [f'{len(missing)} piece(s) of the layout are missing, starting with: {missing[0][:60]!r}'] if missing else []
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd rebrand/tests && python3 -m unittest test_document_layout -v 2>&1 | tail -4`
Expected: `OK`, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add rebrand/scripts/document_layout.py rebrand/tests/test_document_layout.py
git commit -m "Check that a layout's sidebar and icon words are in the result"
```

---

### Task 6: The page report

**Files:**
- Create: `rebrand/scripts/document_pages.py`
- Test: `rebrand/tests/test_document_pages.py`

- [ ] **Step 1: Write the failing tests**

Create `rebrand/tests/test_document_pages.py`:

```python
"""Where a rendered document's headings, sidebars and figure landed (document_pages)."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import document_pages as P

PAGES=['A Clear Title\nAnd its subtitle\nAt a glance\nAn opening paragraph.\nFirst part\nWords',
       'Second part\n76 percent say so\nmore words\nFigure 1: A caption\nThird part',
       'Last part\nClosing words.']
LAYOUT={'sidebars':[{'page_of':None,'blocks':[{'type':'heading','text':'At a glance'}]},
                    {'page_of':'Second part','blocks':[{'type':'stat','text':'76 percent **say** so','attribution':'x'}]}]}
FILL={'subtitle':'And its subtitle','headings':['First part','Second part','Third part','Last part'],'captions':['Figure 1: A caption']}


class Locate(unittest.TestCase):
    def test_pages_headings_sidebars_and_the_figure_are_placed(self):
        found=P.locate(PAGES,FILL,LAYOUT)
        self.assertEqual(found['pages'],3)
        self.assertEqual(found['headings'],{'First part':1,'Second part':2,'Third part':2,'Last part':3})
        self.assertEqual(found['sidebars'],[{'page_of':None,'page':1},{'page_of':'Second part','page':2}])
        self.assertEqual(found['figures'],[2]);self.assertTrue(found['subtitle_on_one_line'])
        self.assertEqual(found['sidebars_sharing_a_page'],[])

    def test_two_sidebars_on_a_page_and_a_wrapped_subtitle_are_reported(self):
        pages=[PAGES[0].replace('And its subtitle','And its\nsubtitle'),PAGES[1],PAGES[2]]
        both={'sidebars':[LAYOUT['sidebars'][0],{'page_of':'First part','blocks':[{'type':'body','text':'More'}]}]}
        found=P.locate(pages,FILL,both)
        self.assertEqual(found['sidebars_sharing_a_page'],[1]);self.assertFalse(found['subtitle_on_one_line'])

    def test_something_not_found_has_no_page(self):
        self.assertEqual(P.locate(PAGES,{'subtitle':None,'headings':['Missing'],'captions':[]},{})['headings'],{'Missing':None})


if __name__=='__main__':unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rebrand/tests && python3 -m unittest test_document_pages -v 2>&1 | tail -4`
Expected: `ModuleNotFoundError: No module named 'document_pages'`.

- [ ] **Step 3: Implement**

Create `rebrand/scripts/document_pages.py`:

```python
"""Render a Word document and say which page its headings, sidebars and figure landed on.

LibreOffice makes the PDF and pdftotext reads each page. Word may break pages a line or two
differently, so this is a check of the layout, not a promise about Word."""
from __future__ import annotations
import shutil,subprocess,tempfile
from pathlib import Path
from render import find,SOFFICE

PDFTOTEXT=find('pdftotext',['/opt/homebrew/bin/pdftotext','/usr/local/bin/pdftotext'])


def squeeze(words):return ' '.join(str(words).split())


def page_texts(docx,pdf=None):
    """Each page's text, or None when LibreOffice or pdftotext is absent. The PDF is kept at pdf when given."""
    if not SOFFICE or not PDFTOTEXT:return None
    docx=Path(docx)
    with tempfile.TemporaryDirectory() as tmp:
        made=subprocess.run([SOFFICE,f'-env:UserInstallation=file://{tmp}/profile','--headless','--convert-to','pdf','--outdir',tmp,str(docx)],
                            stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=300)
        out=Path(tmp)/(docx.stem+'.pdf')
        if made.returncode or not out.exists():return None
        text=subprocess.run([PDFTOTEXT,str(out),'-'],stdout=subprocess.PIPE,text=True,timeout=120).stdout
        if pdf:shutil.copyfile(out,pdf)
    pages=text.split('\f')
    return pages[:-1] if pages and not pages[-1].strip() else pages


def locate(pages,fill,layout):
    """fill: {'subtitle','headings','captions'} from the source; layout: the layout that was applied."""
    flat=[squeeze(p) for p in pages]
    page_of=lambda words:next((n for n,text in enumerate(flat,1) if squeeze(words) and squeeze(words) in text),None)
    # A sidebar is fixed to the page of the paragraph it is anchored to, which follows its heading. Its own
    # words are no guide: in a narrow column they wrap, and the page's text interleaves them with the main column.
    bars=[{'page_of':bar.get('page_of') or None,'page':page_of(bar['page_of']) if bar.get('page_of') else (1 if pages else None)} for bar in layout.get('sidebars') or []]
    used=[b['page'] for b in bars if b['page']]
    lines=[squeeze(line) for line in pages[0].splitlines()] if pages else []
    return {'pages':len(pages),'headings':{h:page_of(h) for h in fill.get('headings') or []},'sidebars':bars,
            'sidebars_sharing_a_page':sorted({n for n in used if used.count(n)>1}),
            'figures':[page_of(c) for c in fill.get('captions') or []],
            'subtitle_on_one_line':(squeeze(fill['subtitle']) in lines) if fill.get('subtitle') else None}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd rebrand/tests && python3 -m unittest test_document_pages -v 2>&1 | tail -4`
Expected: `OK`, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add rebrand/scripts/document_pages.py rebrand/tests/test_document_pages.py
git commit -m "Report which page a rendered document's headings, sidebars and figure are on"
```

---

### Task 7: `--layout` on the command, and the report

**Files:**
- Modify: `rebrand/scripts/document_template.py` (the report from `Filler.fill`)
- Modify: `rebrand/scripts/brand.py` (`document()`, `main()`)
- Modify: `rebrand/scripts/reporting.py`
- Test: `rebrand/tests/test_document_template.py`

- [ ] **Step 1: Write the failing test**

The page report needs the source's headings and figure captions. Add to class `Fill` in `rebrand/tests/test_document_template.py`:

```python
    def test_the_report_lists_headings_and_the_paragraph_after_each_picture(self):
        def picture(d):
            from PIL import Image
            raw=io.BytesIO();Image.new('RGB',(40,10),'navy').save(raw,'PNG');raw.seek(0)
            d.add_picture(raw);d.add_paragraph('Figure 1: A caption')
        _,report,_=D.fill(template(),source(picture))
        self.assertEqual(report['headings'],['First part','Second part','Last part'])
        self.assertEqual(report['captions'],['Figure 1: A caption'])
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rebrand/tests && python3 -m unittest test_document_template -v 2>&1 | tail -4`
Expected: `KeyError: 'headings'`.

- [ ] **Step 3: Add the two report fields**

In `Filler.fill` in `rebrand/scripts/document_template.py`, directly after the line that begins `report={'title':title,'subtitle':subtitle,` and its two continuation lines, add:

```python
        report['headings']=[' '.join(words[0].split()) for kind,_,words in everything if kind in ('h1','h2') and words]
        report['captions']=[' '.join(everything[i+1][2][0].split()) for i,(kind,node,_) in enumerate(everything[:-1])
                            if kind!='table' and node.find('.//'+W+'drawing') is not None and everything[i+1][2]]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd rebrand/tests && python3 -m unittest test_document_template -v 2>&1 | tail -4`
Expected: `OK`, with one more test than before this step.

- [ ] **Step 5: Wire `--layout` into `document()`**

In `rebrand/scripts/brand.py`, change the signature of `document`:

```python
def document(api, source, ident, *, output='both', folder=None, name=None, run_dir=None, progress=None, when=None, layout=None):
```

Replace these two lines:

```python
    try:data,report,expected=fill(template,original,name=title,when=when)
    except TemplateError as exc:raise BrandError(str(exc)) from None
```

with:

```python
    placed=None
    try:
        data,report,expected=fill(template,original,name=title,when=when,closing_from=(layout or {}).get('closing_from'))
        if layout is not None:
            from document_layout import apply, kept
            from brand_icons import library, paint
            def icon_png(icon):
                if icon not in library():raise TemplateError(f'The icon library has no icon {icon}.')
                return paint(library()[icon])
            stage('setting_layout')
            data,placed,words=apply(data,template,layout,icon_png)
            problems=returned(data,expected)+kept(data,words)
            if problems:raise TemplateError('The layout lost content: '+'; '.join(problems)+'. No output was written.')
    except TemplateError as exc:raise BrandError(str(exc)) from None
```

Directly after the line that ends `result['preview_file']=str(path.resolve())`, inside the same `if output in ('word','both'):` block, add:

```python
        if placed is not None:
            from document_pages import page_texts, locate
            stage('rendering_pages')
            pdf=path.with_suffix('.pdf');pages=page_texts(path,pdf)
            if pages is None:
                result['layout']={**placed,'rendered':False}
                result['warnings'].append('LibreOffice or pdftotext was not found, so the pages were not rendered: where the sidebars and page breaks fall is unchecked.')
            else:
                result['layout']={**placed,'rendered':True,**locate(pages,report,layout)};result['outputs']['pdf']=str(pdf.resolve())
                if result['layout']['sidebars_sharing_a_page']:
                    result['warnings'].append('Two sidebars landed on page '+', '.join(map(str,result['layout']['sidebars_sharing_a_page']))+' and will overlap; move one to a later heading or add a page break.')
```

In `main()`, add the argument after the `--output` line:

```python
    parser.add_argument('--layout',help='With --document: a JSON file naming what goes in the template\'s sidebars, icon row and page breaks; see references/rebranding.md')
```

After the line `if args.document and (args.review or args.verify_copy or args.template_plan or args.dry_run):raise BrandError(...)`, add:

```python
        if args.layout and not args.document:raise BrandError('--layout needs --document.')
        if args.layout and args.output=='google':raise BrandError('--layout needs a Word file: use --output word or both.')
        layout=json.loads(Path(args.layout).read_text()) if args.layout else None
```

Change the `document(...)` call in `main()` to pass it:

```python
            result=document(api,source,args.document,output=args.output,folder=args.folder,name=args.name,run_dir=run_dir,progress=progress,layout=layout)
```

- [ ] **Step 6: Add the layout paragraph to the report**

In `rebrand/scripts/reporting.py`, inside `if filled:`, directly after the line that begins `if filled.get('contents_entries'):`, add:

```python
        placed=result.get('layout')
        if placed:
            count=lambda value:len(value) if isinstance(value,list) else (value or 0)   # a rendered report lists pages where an unrendered one counts
            lines+=['### Layout','',f"Set from the layout file: {count(placed.get('sidebars'))} sidebars, {count(placed.get('icons'))} icons, {count(placed.get('page_breaks'))} page breaks, {count(placed.get('figures'))} figures kept with their captions.",'']
            if placed.get('rendered'):
                lines+=[f"Rendered with LibreOffice: {placed['pages']} pages. Sidebars on pages "+', '.join(str(b['page'] or 'not found') for b in placed['sidebars'])+'. '
                        +('The subtitle fits one line. ' if placed.get('subtitle_on_one_line') else 'The subtitle wraps onto a second line. ' if placed.get('subtitle_on_one_line') is False else '')
                        +'Word may break pages a line or two differently.','']
                for kind,where in (result.get('outputs') or {}).items():
                    if kind=='pdf':lines+=['PDF: '+local_link('open',where),'']
            else:lines+=['The pages were not rendered, so this layout is unchecked.','']
```

The existing loop over `outputs` a few lines above prints a Google link for any kind that is not `word`. Change that line so a PDF is not printed as a Google Doc:

```python
        for kind,where in (result.get('outputs') or {}).items():
            if kind=='pdf':continue
            lines+=[('Word file: '+local_link('open',where)) if kind=='word' else '[Google Doc]('+where+')','']
```

- [ ] **Step 7: Run every test**

Run: `python3 -m unittest discover -s rebrand/tests -v 2>&1 | tail -4` and `npm test 2>&1 | tail -6`
Expected: Python `OK`; Node all passing, as before this change.

- [ ] **Step 8: Commit**

```bash
git add rebrand/scripts/brand.py rebrand/scripts/reporting.py rebrand/scripts/document_template.py rebrand/tests/test_document_template.py
git commit -m "rebrand run --document takes --layout and reports where the pages fall"
```

---

### Task 8: A Markdown source

Blog Studio is standard-library Python and cannot write Word files, so document mode also takes a `.md` file.

**Files:**
- Create: `rebrand/scripts/markdown_source.py`
- Modify: `rebrand/scripts/brand.py` (`document()`, `main()`)
- Test: `rebrand/tests/test_markdown_source.py`

- [ ] **Step 1: Write the failing tests**

Create `rebrand/tests/test_markdown_source.py`:

```python
"""A Markdown brief read as a Word source (markdown_source)."""
import io,sys,tempfile,unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import document_template as D
import markdown_source as M
from test_document_template import template,paragraphs

TEXT="""# A Clear Title

_And its subtitle_

An opening paragraph
on two lines with **emphasis**.

## First part

- One point
- Another point

1. Step one
2. Step two

### A smaller heading

Closing words.

## Last part

The end.
"""


class Markdown(unittest.TestCase):
    def test_title_subtitle_headings_lists_and_bold_reach_the_template(self):
        data,report,_=D.fill(template(),M.to_docx(TEXT))
        self.assertEqual((report['title'],report['subtitle']),('A Clear Title','And its subtitle'))
        self.assertEqual(report['headings'],['First part','A smaller heading','Last part'])
        self.assertEqual(report['blocks']['bullet'],2);self.assertEqual(report['blocks']['number'],2)
        placed=[text for _,text in paragraphs(data)]
        self.assertIn('An opening paragraph on two lines with emphasis.',placed)
        self.assertNotIn('**',''.join(placed))

    def test_a_picture_is_read_from_beside_the_file_and_a_missing_one_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            Image.new('RGB',(40,10),'navy').save(Path(folder)/'figure.png')
            text=TEXT+'\n![Three layers](figure.png)\n\nFigure 1: A caption\n'
            _,report,_=D.fill(template(),M.to_docx(text,folder))
            self.assertEqual(report['pictures'],1);self.assertEqual(report['captions'],['Figure 1: A caption'])
            with self.assertRaises(ValueError):M.to_docx(TEXT+'\n![x](missing.png)\n',folder)


if __name__=='__main__':unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rebrand/tests && python3 -m unittest test_markdown_source -v 2>&1 | tail -4`
Expected: `ModuleNotFoundError: No module named 'markdown_source'`.

- [ ] **Step 3: Implement**

Create `rebrand/scripts/markdown_source.py`:

```python
"""Read a Markdown brief as a Word source for document_template.

Only the subset a studio hands over: '# ' the title, a whole line in _italics_ straight after it
the subtitle, '## ' and '### ' level-1 and level-2 headings, paragraphs, '- ' bullets, '1. '
numbered items, '![alt](file)' pictures on a line of their own, and **bold** and *italic* in text.
Anything else is kept as plain words."""
from __future__ import annotations
import io,re
from pathlib import Path
from docx import Document

INLINE=re.compile(r'(\*\*.+?\*\*|\*.+?\*)')
PICTURE=re.compile(r'!\[(.*?)\]\((.+?)\)')
SUBTITLE=re.compile(r'(?:_([^_].*?)_|\*([^*].*?)\*)')


def runs(p,words):
    for piece in INLINE.split(words):
        if not piece:continue
        if piece.startswith('**') and len(piece)>4:p.add_run(piece[2:-2]).bold=True
        elif piece.startswith('*') and len(piece)>2:p.add_run(piece[1:-1]).italic=True
        else:p.add_run(piece)


def to_docx(text,base=None):
    """Word document bytes. base is the folder pictures are read from."""
    d=Document();lines=text.splitlines();held=[];titled=False;i=0
    def flush():
        if held:runs(d.add_paragraph(),' '.join(held));held.clear()
    while i<len(lines):
        line=lines[i].strip();i+=1
        if not line:flush();continue
        picture=PICTURE.fullmatch(line)
        if line.startswith('# ') and not titled:
            flush();d.add_paragraph(line[2:].strip(),style='Title');titled=True
            j=i
            while j<len(lines) and not lines[j].strip():j+=1
            found=SUBTITLE.fullmatch(lines[j].strip()) if j<len(lines) else None
            if found:d.add_paragraph(found.group(1) or found.group(2),style='Subtitle');i=j+1
        elif line.startswith('### '):flush();d.add_heading(line[4:].strip(),2)
        elif line.startswith('## '):flush();d.add_heading(line[3:].strip(),1)
        elif re.match(r'[-*] ',line):flush();runs(d.add_paragraph(style='List Bullet'),line[2:].strip())
        elif re.match(r'\d+[.)] ',line):flush();runs(d.add_paragraph(style='List Number'),line.split(' ',1)[1].strip())
        elif picture:
            flush();file=(Path(base or '.')/picture.group(2)).resolve()
            if not file.is_file():raise ValueError(f'The picture {picture.group(2)} was not found beside the Markdown file.')
            d.add_picture(str(file))
        else:held.append(line)
    flush()
    out=io.BytesIO();d.save(out);return out.getvalue()
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd rebrand/tests && python3 -m unittest test_markdown_source -v 2>&1 | tail -4`
Expected: `OK`, 2 tests.

- [ ] **Step 5: Accept a `.md` file in document mode**

In `rebrand/scripts/brand.py`, in `document()`, replace:

```python
    local=Path(source).expanduser()
    if local.suffix.lower()=='.docx' and local.is_file():
        original=local.read_bytes();title=local.stem;origin=None
```

with:

```python
    local=Path(source).expanduser()
    if local.suffix.lower() in ('.docx','.md') and local.is_file():
        if local.suffix.lower()=='.md':
            from markdown_source import to_docx
            try:original=to_docx(local.read_text(encoding='utf-8'),local.parent)
            except ValueError as exc:raise BrandError(str(exc)) from None
        else:original=local.read_bytes()
        title=local.stem;origin=None
```

In `main()`, replace the line that sets `local_source`:

```python
        local_source=bool(args.document) and Path(args.source).expanduser().suffix.lower() in ('.docx','.md') and Path(args.source).expanduser().is_file()
```

and change the help of the `source` argument to:

```python
    parser.add_argument('source',help='Google Slides/Docs URL or Drive file ID; with --document, also a local .docx or .md file')
```

- [ ] **Step 6: Run every Python test**

Run: `python3 -m unittest discover -s rebrand/tests 2>&1 | tail -3`
Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
git add rebrand/scripts/markdown_source.py rebrand/scripts/brand.py rebrand/tests/test_markdown_source.py
git commit -m "rebrand run --document reads a Markdown source"
```

---

### Task 9: Reproduce the reference brief (private check, nothing committed)

This is the end-to-end check. It uses a real brief whose words are not public, kept in the
git-ignored folder `test-runs/solution-brief-reference/`: `reference-build/` (the one-off scripts
this plan ports), `layout.json` (the layout for that brief), `README.txt` and the PDF that the
one-off build produced. **Never commit anything from that folder.** If the folder is absent on
this machine, skip this task and say so in the pull request.

It needs the brand profile that brief was built with (its ID is the `brand:` line of
`README.txt`; `node scripts/harness-brand.mjs rebrand status --brand ID` reports whether it is
installed), LibreOffice and poppler.

- [ ] **Step 1: Make the plain source document**

The reference build's `make_source.py` writes "Summary" as a level-2 heading and promotes it
afterwards. With `closing_from` that trick is gone, so restore the level-1 heading:

```bash
cd ~/Projects/harness-brand-skill
R=test-runs/solution-brief-reference; W=$R/work
rm -rf "$W" && mkdir -p "$W" && cp "$R/reference-build/make_source.py" "$R/reference-build/diagram.svg" "$W/"
sed -i '' "s/h2('Summary')/h1('Summary')/" "$W/make_source.py"
rsvg-convert -w 1800 "$W/diagram.svg" -o "$W/diagram.png"
rebrand/.venv/bin/python3 "$W/make_source.py" "$W/brief.docx" "$W/diagram.png"
```

Expected: `test-runs/solution-brief-reference/work/brief.docx` exists.

- [ ] **Step 2: Run it**

```bash
BRAND=$(sed -n 's/^brand: //p' "$R/README.txt")
rebrand/.venv/bin/python3 rebrand/scripts/brand.py "$W/brief.docx" --brand "$BRAND" \
  --document solution-brief --layout "$R/layout.json" --output word --run-dir "$W/run" > "$W/result.json"
python3 -c "import json,sys;r=json.load(open(sys.argv[1]));print(r['status'],r['layout']['pages'],[b['page'] for b in r['layout']['sidebars']],r['layout']['sidebars_sharing_a_page'],r['layout']['subtitle_on_one_line'])" "$W/result.json"
```

Expected: `branded 5 [1, 2, 3, 4, 5] [] True`.

- [ ] **Step 3: Look at the pages**

```bash
pdftoppm -r 60 -png "$W"/run/*.pdf "$W/run/page"
```

Open the five PNGs. Each page has one sidebar on the left; page 1 has the icon row above its
first heading; the figure and its caption are both on page 2; the last two sections share page 5
with the legal footer. Compare with the PDF in `test-runs/solution-brief-reference/`.

If the page numbers differ, fix the code, not the expectation: the reference build reached this
result with the same anchors.

There is no commit for this task.

---

### Task 10: Documentation and version 1.3.0

**Files:**
- Modify: `references/rebranding.md`, `docs/rebranding-profile-format.md`, `CHANGELOG.md`, `package.json`

- [ ] **Step 1: Describe the option for agents**

In `references/rebranding.md`, in the section "A document in a brand template", add after the paragraph that ends "and checks the Google copy again after import.":

````markdown
### Sidebars, an icon row and page breaks

A template's main column takes the source's words. Its other slots take a layout file:

```sh
python3 scripts/brand.py FILE.docx --document solution-brief --layout layout.json --output word
```

```json
{"closing_from": "Why us",
 "page_break_before": ["The platform"],
 "figure": {},
 "icon_row": {"before": "The risks", "items": [{"icon": "functional-icons.database", "label": "AI-ready data", "detail": "Governed data products"}]},
 "sidebars": [{"page_of": null, "blocks": [{"type": "heading", "text": "At a glance"}, {"type": "bullet", "text": "**Reach** – where it runs"}]},
              {"page_of": "The platform", "blocks": [{"type": "stat", "text": "76 percent …", "attribution": "A survey, 2026"}]}]}
```

Each heading named must match exactly one level-1 or level-2 heading of the source; otherwise
nothing is written. `page_of: null` is the opening page. Block types are `heading`, `body`,
`bullet`, `stat` and `quote`; a `stat` or `quote` needs its `attribution`, and a `quote` is only
for words a source attributes to a named person. `**bold**` is the only inline markup. An icon
row takes one to four icons from the brand's library (`rebrand icons --brand B search …`).
`closing_from` names the section that opens the final page; without it the last level-1 section
does. `figure: {}` keeps a picture on one page with the paragraph after it.

The source may be a `.md` file instead of a `.docx`: `# ` is the title, a whole line in
_italics_ under it the subtitle, `## ` and `### ` level-1 and level-2 headings, with `- ` bullets,
`1. ` numbered items, `**bold**`, `*italic*` and `![alt](file)` pictures read from beside the file.

With LibreOffice and poppler present the result is rendered and `result.json` gains `layout`:
the page count, the page each heading, sidebar and figure is on, whether the subtitle fits one
line, and any page where two sidebars would overlap. Tell the person those findings. Word may
break pages a line or two differently, so look at the pages before calling it done. Without
those tools the layout is reported as unchecked.
````

- [ ] **Step 2: Describe what a template needs**

In `docs/rebranding-profile-format.md`, after the paragraph that ends "may have a cover and a table of contents before its first page break.", add:

```markdown
A template takes `--layout` sidebars when its sample copy has a text box whose paragraphs use a
`vmwSidebar…` style: the first such box is copied for the opening page and the second for later
pages (one box serves both). It takes an icon row when it has the `vmwinvisibletable` table
style. Nothing is declared in `brand.json`; a layout that asks for a slot the template lacks is
refused.
```

- [ ] **Step 3: Changelog and version**

In `CHANGELOG.md`, add above `## 1.2.3`:

```markdown
## 1.3.0

- `rebrand run --document` takes `--layout FILE`: a JSON file that fills a document
  template's sidebars, sets a row of up to four library icons with captions, keeps a figure
  with its caption, adds page breaks, and names the section that opens the final page. Each
  is anchored to a heading; a heading that matches no section, or more than one, is refused.
- With a layout, the result is rendered and the report says how many pages it has, which page
  each heading, sidebar and figure is on, whether the subtitle fits one line, and where two
  sidebars would overlap. A PDF is saved beside the Word file.
- `rebrand run --document` also takes a local Markdown file: `# ` is the title, an italic line
  under it the subtitle, `## ` and `### ` the headings, with lists, bold, italic and pictures.
```

In `package.json`, change `"version": "1.2.3"` to `"version": "1.3.0"`. Then find any other place that names the version:

```bash
grep -rn '1\.2\.3' . --include='*.json' --include='*.md' --include='*.mjs' --include='*.py' | grep -v -E 'node_modules|/dist/|test-runs|\.venv|/runs/|CHANGELOG'
```

Expected: no lines. If any appear, update each to 1.3.0.

- [ ] **Step 4: Run everything once more**

Run: `npm test 2>&1 | tail -6 && python3 -m unittest discover -s rebrand/tests 2>&1 | tail -3`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add references/rebranding.md docs/rebranding-profile-format.md CHANGELOG.md package.json
git commit -m "Layout slots for document templates (1.3.0)"
```

Installing the new version where it is used (`rebrand setup`, the skill shortcuts) is a release step for the person, not part of this plan.
