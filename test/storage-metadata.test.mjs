import assert from 'node:assert/strict';
import test from 'node:test';
import { StorageManager } from '../src/storage/StorageManager.ts';

test('concurrent chapter progress and tag updates both survive', async () => {
  let book = { id: 'book', title: 'Fixture', author: '', progress: 0, tags: [] };
  let lastWrite = Promise.resolve();
  const manager = new StorageManager();
  manager.db = {
    transaction(name, mode) {
      assert.equal(name, 'books');
      const previous = lastWrite;
      const commit = Promise.withResolvers();
      if (mode === 'readwrite') lastWrite = commit.promise;
      return {
        store: {
          async get(id) {
            await previous;
            return id === book.id ? structuredClone(book) : undefined;
          },
          async put(value) {
            assert.equal(mode, 'readwrite');
            await previous;
            book = structuredClone(value);
            commit.resolve();
          },
        },
        done: mode === 'readwrite' ? commit.promise : previous,
      };
    },
  };

  await Promise.all([
    manager.updateBookMetadata('book', { progress: 60, currentChapterId: 'chapter-3' }),
    manager.updateBookMetadata('book', { tags: ['fiction'] }),
  ]);
  assert.equal(book.progress, 60);
  assert.equal(book.currentChapterId, 'chapter-3');
  assert.deepEqual(book.tags, ['fiction']);
});
