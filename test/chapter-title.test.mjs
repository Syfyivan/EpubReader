import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterDisplayTitle } from '../src/read/chapter-title.ts';

test('chapter title uses valid titles and decodes filename fallbacks', () => {
  assert.equal(chapterDisplayTitle({ id: 'id123', title: ' First chapter ', href: 'OPS/a.xhtml' }), 'First chapter');
  assert.equal(chapterDisplayTitle({ id: 'id123', title: 'id123', href: 'OPS/%E5%BA%8F.xhtml' }), '序');
});

test('chapter title remains readable when a filename contains a malformed escape', () => {
  assert.equal(chapterDisplayTitle({ id: 'id123', title: 'id123', href: 'OPS/100%.xhtml' }), '100%');
  assert.equal(chapterDisplayTitle({ id: 'id124', title: '', href: '' }), 'id124');
});
