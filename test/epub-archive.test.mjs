import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { EpubParser } from '../src/parse/parse.ts';

test('loads exact ZIP resource paths and resolves relative cover entries', async t => {
  const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  await zip.add('OPS/images/cover.txt', new TextReader('cover'), { level: 0 });
  await zip.add('OPS/nested/chapter.xhtml', new TextReader('chapter'), { level: 0 });

  const parser = new EpubParser();
  t.after(() => parser.close());
  await parser.loadFromFile(await zip.close());
  parser.basePath = 'OPS/';
  parser.metadata.cover = 'images/cover.txt';
  assert.equal(await (await parser.getCoverImage()).text(), 'cover');
  assert.equal(await (await parser.loadResource('OPS/nested/chapter.xhtml')).text(), 'chapter');
  assert.equal(await parser.loadResource('OPS/missing.xhtml'), null);
  await parser.close();
  assert.equal(await parser.loadResource('OPS/nested/chapter.xhtml'), null);
});
