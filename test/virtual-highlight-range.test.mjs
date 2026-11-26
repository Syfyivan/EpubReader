import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHighlightRenderer } from '../src/highlight/VirtualHighlightRenderer.ts';

test('visible range includes every highlight on both boundary lines', () => {
  const renderer = new VirtualHighlightRenderer({});
  renderer.setHighlights([99, 100, 149, 650, 699, 700].map((offset, id) => ({
    id, position: { start: { offset } },
  })));
  assert.deepEqual(renderer.calculateVisibleRange({
    scrollTop: 196, viewportHeight: 28, contentHeight: 420,
  }), { startIndex: 1, endIndex: 5 });
  assert.deepEqual(renderer.calculateVisibleRange({
    scrollTop: 1000, viewportHeight: 28, contentHeight: 1200,
  }), { startIndex: 6, endIndex: 6 });
});
