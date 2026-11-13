// A small PowerPoint template for tests. Master 1 is a legacy master no slide uses; master 2
// has three layouts: "Title Slide" (a subtitle with no frame of its own, which inherits the
// master body's), "Title Only " (a trailing space; a title that inherits the master's, a
// rotated and flipped logo, a slide number, master artwork hidden) and "Blank" (no slide).
// Slide 2 is hidden. The theme gives dk1 as a system colour. With `{ tricky: true }`, master
// 2 also has a date placeholder with idx 2 and a title style of its own, the Title Slide's
// subtitle has idx 2, its title colour is darkened, and Title Only maps colours its own way.
// With `{ slides: false }` it lists no slides.
// It is only for tests: it is not a package PowerPoint or LibreOffice would open (no content
// types, no root relationships, a minimal theme, empty slides).
import { writeZip } from '../../scripts/lib/zip.mjs';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const rels = (list) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + list.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')
  + '</Relationships>';
const xfrm = (x, y, w, h, extra = '') => `<a:xfrm${extra}><a:off x="${x * 12700}" y="${y * 12700}"/><a:ext cx="${w * 12700}" cy="${h * 12700}"/></a:xfrm>`;
const shape = (id, ph, frame = '', style = '') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>`
  + `<p:spPr>${frame}</p:spPr>${style ? `<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr>${style}</a:lvl1pPr></a:lstStyle><a:p/></p:txBody>` : ''}</p:sp>`;
const tree = (name, shapes) => `<p:cSld${name === null ? '' : ` name="${name}"`}><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>`;
const theme = (accent) => `<a:theme ${NS} name="T"><a:themeElements><a:clrScheme name="C">`
  + '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>'
  + `<a:accent1><a:srgbClr val="${accent}"/></a:accent1></a:clrScheme><a:fontScheme name="F">`
  + '<a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont>'
  + '</a:fontScheme></a:themeElements></a:theme>';
const STYLES = '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="2800" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
  + '<a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000">'
  + '<a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle></p:txStyles>';
const master = (shapes, layouts) => `<p:sldMaster ${NS}>${tree(null, shapes)}`
  + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" hlink="hlink" folHlink="folHlink"/>'
  + `<p:sldLayoutIdLst>${layouts.map((n) => `<p:sldLayoutId id="${2147483648 + n}" r:id="rId${n}"/>`).join('')}</p:sldLayoutIdLst>`
  + `${STYLES}</p:sldMaster>`;
const layout = (name, shapes, attrs = '', after = '') => `<p:sldLayout ${NS}${attrs}>${tree(name, shapes)}${after}</p:sldLayout>`;
const slide = (hidden) => `<p:sld ${NS}${hidden ? ' show="0"' : ''}>${tree(null, '')}</p:sld>`;

export function makeTemplate({ tricky = false, slides = true } = {}) {
  const masterShapes = shape(2, '<p:ph type="title"/>', xfrm(48, 36, 864, 60), tricky ? '<a:defRPr sz="3200"/>' : '')
    + shape(3, '<p:ph type="body" idx="1"/>', xfrm(48, 120, 864, 360))
    + shape(4, '<p:ph type="sldNum" idx="12"/>', xfrm(900, 500, 40, 20))
    + shape(5, '', xfrm(0, 0, 960, 6));
  const master2Shapes = masterShapes + (tricky ? shape(6, '<p:ph type="dt" idx="2"/>', xfrm(50, 500, 157, 24), '<a:defRPr sz="1200"/>') : '');
  const titleFill = tricky ? '<a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr>' : '<a:schemeClr val="accent1"/>';
  const logo = '<p:pic><p:nvPicPr><p:cNvPr id="7" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/>'
    + `<p:spPr>${xfrm(10, 10, 50, 20, ' rot="5400000" flipH="1"')}</p:spPr></p:pic>`;
  return writeZip([
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['ppt/presentation.xml', `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/>`
      + '<p:sldMasterId id="2147483652" r:id="rId2"/></p:sldMasterIdLst>'
      + (slides ? '<p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId4"/><p:sldId id="258" r:id="rId5"/></p:sldIdLst>' : '')
      + '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>'],
    ['ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'slideMaster', 'slideMasters/slideMaster2.xml'], ['rId3', 'slide', 'slides/slide1.xml'],
      ['rId4', 'slide', 'slides/slide2.xml'], ['rId5', 'slide', 'slides/slide3.xml']])],
    ['ppt/slideMasters/slideMaster1.xml', master(masterShapes, [1])],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout4.xml'],
      ['rId9', 'theme', '../theme/theme1.xml']])],
    ['ppt/slideMasters/slideMaster2.xml', master(master2Shapes, [1, 2, 3])],
    ['ppt/slideMasters/_rels/slideMaster2.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'slideLayout', '../slideLayouts/slideLayout2.xml'], ['rId3', 'slideLayout', '../slideLayouts/slideLayout3.xml'],
      ['rId9', 'theme', '../theme/theme2.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', layout('Title Slide',
      shape(10, '<p:ph type="ctrTitle"/>', xfrm(100, 200, 700, 100), `<a:defRPr sz="4000"><a:solidFill>${titleFill}</a:solidFill></a:defRPr>`)
      + shape(11, `<p:ph type="subTitle" idx="${tricky ? 2 : 1}"/>`), ' type="title"')],
    ['ppt/slideLayouts/slideLayout2.xml', layout('Title Only ',
      shape(20, '<p:ph type="title"/>') + logo + shape(21, '<p:ph type="sldNum" idx="12"/>', xfrm(900, 500, 40, 20)),
      ' showMasterSp="0"', tricky ? '<p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"/></p:clrMapOvr>' : '')],
    ['ppt/slideLayouts/slideLayout3.xml', layout('Blank', '')],
    ['ppt/slideLayouts/slideLayout4.xml', layout('Legacy', shape(30, '<p:ph type="title"/>', xfrm(0, 0, 100, 50)))],
    ...[1, 2, 3, 4].map((n) => [`ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`,
      rels([['rId1', 'slideMaster', `../slideMasters/slideMaster${n === 4 ? 1 : 2}.xml`]])]),
    ['ppt/slides/slide1.xml', slide(false)],
    ['ppt/slides/slide2.xml', slide(true)],
    ['ppt/slides/slide3.xml', slide(false)],
    ['ppt/slides/_rels/slide1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])],
    ['ppt/slides/_rels/slide2.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout2.xml']])],
    ['ppt/slides/_rels/slide3.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout2.xml']])],
    ['ppt/theme/theme1.xml', theme('999999')],
    ['ppt/theme/theme2.xml', theme('1F4E8C')],
  ]);
}
