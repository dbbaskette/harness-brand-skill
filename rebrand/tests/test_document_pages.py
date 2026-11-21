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
