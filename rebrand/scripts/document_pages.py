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
