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
