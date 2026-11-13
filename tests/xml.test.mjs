import { test } from 'node:test';
import assert from 'node:assert/strict';
import { all, kid, kids, parseXml, path } from '../scripts/lib/xml.mjs';

test('elements, attributes, text and entities are read', () => {
  const root = parseXml(`<?xml version="1.0"?>
    <!-- a comment -->
    <p:sld xmlns:p="urn:p" a='1' b="x &amp; y">
      <p:t>Fish &lt;&amp;&gt; chips &#x41;&#66;</p:t>
      <p:empty/>
      <p:raw><![CDATA[<kept>]]></p:raw>
    </p:sld>`);
  assert.equal(root.name, 'p:sld');
  assert.deepEqual(root.attrs, { 'xmlns:p': 'urn:p', a: '1', b: 'x & y' });
  assert.equal(kid(root, 'p:t').text, 'Fish <&> chips AB');
  assert.deepEqual(kid(root, 'p:empty').children, []);
  assert.equal(kid(root, 'p:raw').text, '<kept>');
});

test('an attribute may hold a > inside its quotes', () => {
  assert.equal(parseXml('<a title="x > y"/>').attrs.title, 'x > y');
});

test('finding children and descendants', () => {
  const root = parseXml('<a><b><c id="1"/></b><b><c id="2"/><c id="3"/></b></a>');
  assert.equal(kids(root, 'b').length, 2);
  assert.equal(path(root, 'b/c').attrs.id, '1');
  assert.equal(path(root, 'b/x/c'), null);
  assert.deepEqual(all(root, 'c').map((c) => c.attrs.id), ['1', '2', '3']);
});

test('badly formed XML is refused', () => {
  assert.throws(() => parseXml('<a><b></a>'), /closes a where b is open/);
  assert.throws(() => parseXml('<a>'), /still open/);
  assert.throws(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>'), /document type/);
  assert.throws(() => parseXml('just text'), /no element/);
});

test('a plain document type is skipped', () => {
  assert.equal(parseXml('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>').name, 'svg');
});

test('invalid numeric references are refused', () => {
  for (const text of ['<a>&#x110000;</a>', '<a>&#xD800;</a>', '<a>&#0;</a>', '<a>&#99999999999999999999;</a>']) {
    assert.throws(() => parseXml(text), /not a character/, text);
  }
});

test('a closing tag with nothing open is refused', () => {
  assert.throws(() => parseXml('<a/></a>'), /nothing is open/);
});

test('a second root element is refused', () => {
  assert.throws(() => parseXml('<a/><b/>'), /more than one root/);
});

test('comments, processing instructions, spacing and CDATA are read without decoding CDATA', () => {
  const root = parseXml('<a><!-- x > y --><?pi z?><b >1</b ><c><![CDATA[&amp;]]></c><d>&amp;lt;</d></a>');
  assert.equal(kid(root, 'b').text, '1');
  assert.equal(kid(root, 'c').text, '&amp;');
  assert.equal(kid(root, 'd').text, '&lt;');
});
