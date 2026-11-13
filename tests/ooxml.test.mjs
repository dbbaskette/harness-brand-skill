import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attr, child, find, openPackage, relationId } from '../scripts/lib/ooxml.mjs';
import { parseXml } from '../scripts/lib/xml.mjs';
import { writeZip } from '../scripts/lib/zip.mjs';
import { makeTemplate } from './fixtures/template.mjs';

test('parts, their XML and their relationships are read, with targets resolved', () => {
  const pkg = openPackage(makeTemplate());
  assert.equal(pkg.related('ppt/slides/slide1.xml', 'slideLayout'), 'ppt/slideLayouts/slideLayout1.xml');
  assert.equal(pkg.target('ppt/presentation.xml', 'rId2'), 'ppt/slideMasters/slideMaster2.xml');
  assert.equal(pkg.related('ppt/slides/slide1.xml', 'theme'), null);
  assert.equal(pkg.xml('ppt/presentation.xml').name, 'p:presentation');
  assert.throws(() => pkg.xml('ppt/missing.xml'), /It has no ppt\/missing\.xml/);
});

test('names are matched whatever their prefix, and r:id is told apart from id', () => {
  const root = parseXml('<x:root xmlns:x="u" xmlns:q="r"><x:a><x:b id="1" q:id="rId7"/></x:a></x:root>');
  const b = find(root, 'a/b');
  assert.equal(attr(b, 'id'), '1');
  assert.equal(relationId(b), 'rId7');
  assert.equal(child(root, 'missing'), null);
  assert.equal(find(root, 'a/missing/b'), null);
});

test('what is not a presentation, or holds a part that cannot be placed, is refused', () => {
  assert.throws(() => openPackage(writeZip([['word/document.xml', '<w/>']])), /not a PowerPoint presentation/);
  assert.throws(() => openPackage(writeZip([['ppt/presentation.xml', '<p/>'], ['ppt/../evil.xml', '<x/>']])), /cannot be placed/);
  const broken = openPackage(writeZip([['ppt/presentation.xml', '<p:presentation>']]));
  assert.throws(() => broken.xml('ppt/presentation.xml'), /ppt\/presentation\.xml cannot be read/);
});

test('an exact attribute name wins over one that only shares its local name', () => {
  const node = parseXml('<p:sldId xmlns:p="u" xmlns:r="r" r:id="rId3" id="256"/>');
  assert.equal(attr(node, 'id'), '256');
  assert.equal(relationId(node), 'rId3');
});

test('absolute, encoded, external and missing targets are handled', () => {
  const rels = (list) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + list.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`).join('')
    + '</Relationships>';
  const pkg = openPackage(writeZip([
    ['ppt/presentation.xml', '<p/>'],
    ['ppt/theme/theme2.xml', '<t/>'],
    ['ppt/media/my pic.png', 'x'],
    ['ppt/..foo.xml', '<x/>'],
    ['ppt/_rels/presentation.xml.rels', rels([
      ['rId1', 'http://purl.oclc.org/ooxml/officeDocument/relationships/theme', '/ppt/theme/theme2.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', 'media/my%20pic.png'],
      ['rId3', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', 'https://example.com', 'External'],
      ['rId4', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', '../../../etc/passwd'],
      ['rId5', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', '..foo.xml'],
    ])],
  ]));
  assert.equal(pkg.related('ppt/presentation.xml', 'theme'), 'ppt/theme/theme2.xml');
  assert.equal(pkg.target('ppt/presentation.xml', 'rId2'), 'ppt/media/my pic.png');
  assert.equal(pkg.target('ppt/presentation.xml', 'rId3'), null);
  assert.equal(pkg.target('ppt/presentation.xml', 'rId4'), null);
  assert.equal(pkg.target('ppt/presentation.xml', 'rId5'), 'ppt/..foo.xml');
  assert.deepEqual(pkg.rels('ppt/theme/theme2.xml'), []);
});
