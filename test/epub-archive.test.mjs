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

test('preload and navigation share one chapter read, and failed reads can retry', async t => {
  const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  await zip.add('OPS/chapter.xhtml', new TextReader('chapter'), { level: 0 });
  const parser = new EpubParser();
  t.after(() => parser.close());
  await parser.loadFromFile(await zip.close());
  parser.chapters = [{ id: 'chapter', href: 'OPS/chapter.xhtml' }];
  t.mock.method(parser, 'processChapterContent', content => content);
  const entry = parser.entries.get('OPS/chapter.xhtml');
  const read = entry.getData.bind(entry);
  const getData = t.mock.method(entry, 'getData', async () => { throw new Error('read failed'); });
  t.mock.method(console, 'error', () => {});

  const rejected = await Promise.allSettled([parser.loadChapter('chapter'), parser.loadChapter('chapter')]);
  assert.deepEqual(rejected.map(result => result.status), ['rejected', 'rejected']);
  assert.equal(getData.mock.callCount(), 1);
  getData.mock.mockImplementation(read);

  assert.deepEqual(await Promise.all([parser.loadChapter('chapter'), parser.loadChapter('chapter')]), ['chapter', 'chapter']);
  assert.equal(await parser.loadChapter('chapter'), 'chapter');
  assert.equal(getData.mock.callCount(), 2);
});

test('a chapter that finishes after close cannot populate a reopened archive cache', async t => {
  async function archive(content) {
    const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
    await zip.add('OPS/chapter.xhtml', new TextReader(content), { level: 0 });
    return zip.close();
  }
  const parser = new EpubParser();
  t.after(() => parser.close());
  t.mock.method(parser, 'processChapterContent', content => content);
  const chapters = [{ id: 'chapter', href: 'OPS/chapter.xhtml' }];
  await parser.loadFromFile(await archive('old'));
  parser.chapters = chapters;
  const held = Promise.withResolvers();
  t.mock.method(parser.entries.get(chapters[0].href), 'getData', () => held.promise);
  const reading = parser.loadChapter('chapter');
  await parser.close();
  await parser.loadFromFile(await archive('new'));
  parser.chapters = chapters;
  assert.equal(await parser.loadChapter('chapter'), 'new');
  held.resolve('old');
  assert.equal(await reading, 'old');
  assert.equal(await parser.loadChapter('chapter'), 'new');
});
