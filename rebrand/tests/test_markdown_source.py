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
