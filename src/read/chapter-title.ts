import type { EpubChapter } from '../parse/parse';

export function chapterDisplayTitle(chapter: Pick<EpubChapter, 'id' | 'title' | 'href'>): string {
  const title = (chapter.title || '').trim();
  if (title && !/^id\d{3,}$/.test(title)) return title;
  const base = (chapter.href || '').split('/').pop();
  if (!base) return chapter.id;
  let filename = base;
  try {
    filename = decodeURIComponent(base);
  } catch {
    // Some EPUBs store a literal percent sign in the entry name.
  }
  return filename.replace(/\.[^.]+$/, '') || chapter.id;
}
