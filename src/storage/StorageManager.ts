import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { Highlight } from "../highlight/HighlightSystem";

/**
 * 离线数据管理体系
 * 基于 IndexedDB 设计离线笔记库
 */

export interface StoredHighlight extends Highlight {
  bookId: string;
  chapterId: string;
  chapterTitle?: string; // 冗余存储章节名，便于展示
  category?: string;
  source?: "local" | "wechat";
}

export interface BookNote {
  id: string;
  bookId: string;
  title: string;
  content: string;
  chapter?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  source?: "local" | "wechat";
}

export interface BookMetadata {
  id: string;
  title: string;
  author: string;
  cover?: string;
  filePath?: string;
  progress: number;
  lastReadAt: number;
  createdAt: number;
  updatedAt?: number;
  currentChapterId?: string;
  scrollTop?: number;
  tags?: string[];
  fromWeRead?: boolean;
}

export interface BookFileRecord {
  bookId: string;
  file: Blob;
  fileName: string;
  fileSize: number;
  mimeType: string;
  updatedAt: number;
}

export interface AnnotationBucket {
  key: string;
  title: string;
  type: "tag" | "chapter" | "date" | "source";
  highlights: StoredHighlight[];
  notes: BookNote[];
}

export interface OrganizedAnnotations {
  byTag: AnnotationBucket[];
  byChapter: AnnotationBucket[];
  byDate: AnnotationBucket[];
  bySource: AnnotationBucket[];
}

interface EpubReaderDB extends DBSchema {
  highlights: {
    key: string;
    value: StoredHighlight;
    indexes: { "by-book": string; "by-chapter": string; "by-date": number; "by-tag": string };
  };
  notes: {
    key: string;
    value: BookNote;
    indexes: { "by-book": string; "by-date": number; "by-tag": string };
  };
  books: {
    key: string;
    value: BookMetadata;
    indexes: { "by-date": number };
  };
  bookFiles: {
    key: string;
    value: BookFileRecord;
  };
}

export class StorageManager {
  private db: IDBPDatabase<EpubReaderDB> | null = null;
  private dbName = "epub-reader-db";
  private version = 3;

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    if (this.db) return;

    this.db = await openDB<EpubReaderDB>(this.dbName, this.version, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const highlightStore = db.createObjectStore("highlights", {
            keyPath: "id",
          });
          highlightStore.createIndex("by-book", "bookId");
          highlightStore.createIndex("by-chapter", "chapterId");
          highlightStore.createIndex("by-date", "createdAt");
          highlightStore.createIndex("by-tag", "tags", { multiEntry: true });

          const noteStore = db.createObjectStore("notes", {
            keyPath: "id",
          });
          noteStore.createIndex("by-book", "bookId");
          noteStore.createIndex("by-date", "createdAt");
          noteStore.createIndex("by-tag", "tags", { multiEntry: true });

          const bookStore = db.createObjectStore("books", {
            keyPath: "id",
          });
          bookStore.createIndex("by-date", "lastReadAt");
        }

        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains("bookFiles")) {
            db.createObjectStore("bookFiles", {
              keyPath: "bookId",
            });
          }
        }

        if (oldVersion < 3) {
          // 为 highlights 增加 by-tag 索引
          const highlightStore = tx.objectStore("highlights");
          try {
            highlightStore.createIndex("by-tag", "tags", { multiEntry: true });
          } catch {}
        }
      },
    });
  }

  /**
   * 保存划线
   */
  async saveHighlight(highlight: StoredHighlight): Promise<void> {
    if (!this.db) await this.init();

    if (!highlight.createdAt) {
      highlight.createdAt = Date.now();
    }
    highlight.updatedAt = Date.now();
    if (!highlight.source) {
      highlight.source = "local";
    }

    const tx = this.db!.transaction("highlights", "readwrite");
    await tx.store.put(highlight);
    await tx.done;
  }

  /**
   * 获取书籍的所有划线
   */
  async getHighlightsByBook(bookId: string): Promise<StoredHighlight[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("highlights", "readonly");
    const index = tx.store.index("by-book");
    return await index.getAll(bookId);
  }

  async getAllHighlights(): Promise<StoredHighlight[]> {
    if (!this.db) await this.init();
    const tx = this.db!.transaction("highlights", "readonly");
    return await tx.store.getAll();
  }

  async getHighlightsByTag(tag: string): Promise<StoredHighlight[]> {
    if (!this.db) await this.init();
    const tx = this.db!.transaction("highlights", "readonly");
    const index = tx.store.index("by-tag");
    return await index.getAll(tag);
  }

  /**
   * 获取章节的所有划线
   */
  async getHighlightsByChapter(
    bookId: string,
    chapterId: string
  ): Promise<StoredHighlight[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("highlights", "readonly");
    const index = tx.store.index("by-chapter");
    const results = await index.getAll(chapterId);
    return results.filter((highlight) => highlight.bookId === bookId);
  }

  /**
   * 删除划线
   */
  async deleteHighlight(id: string): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("highlights", "readwrite");
    await tx.store.delete(id);
    await tx.done;
  }

  /**
   * 搜索划线（支持全文搜索）
   */
  async searchHighlights(query: string): Promise<StoredHighlight[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("highlights", "readonly");
    const allHighlights = await tx.store.getAll();

    const lowerQuery = query.toLowerCase();
    return allHighlights.filter(
      (h) =>
        h.text.toLowerCase().includes(lowerQuery) ||
        h.note?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 保存笔记
   */
  async saveNote(note: BookNote): Promise<void> {
    if (!this.db) await this.init();

    const now = Date.now();
    note.createdAt = note.createdAt ?? now;
    note.updatedAt = now;
    note.source = note.source ?? "local";
    note.tags = note.tags ?? [];

    const tx = this.db!.transaction("notes", "readwrite");
    await tx.store.put(note);
    await tx.done;
  }

  /**
   * 获取书籍的所有笔记
   */
  async getNotesByBook(bookId: string): Promise<BookNote[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("notes", "readonly");
    const index = tx.store.index("by-book");
    const notes = await index.getAll(bookId);
    return notes.map((note) => this.normalizeNote(note));
  }

  /**
   * 获取所有笔记
   */
  async getAllNotes(): Promise<BookNote[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("notes", "readonly");
    const notes = await tx.store.getAll();
    return notes.map((note) => this.normalizeNote(note));
  }

  /**
   * 按标签获取笔记
   */
  async getNotesByTag(tag: string): Promise<BookNote[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("notes", "readonly");
    const index = tx.store.index("by-tag");
    const notes = await index.getAll(tag);
    return notes.map((note) => this.normalizeNote(note));
  }

  private normalizeNote(note: BookNote): BookNote {
    return {
      ...note,
      tags: Array.isArray(note.tags) ? note.tags : [],
      source: note.source ?? "local",
      createdAt: note.createdAt ?? Date.now(),
      updatedAt: note.updatedAt ?? Date.now(),
    };
  }

  async getAllTags(): Promise<string[]> {
    if (!this.db) await this.init();
    const [allHighlights, allNotes] = await Promise.all([
      this.getAllHighlights(),
      this.getAllNotes(),
    ]);
    const set = new Set<string>();
    allHighlights.forEach(h => (h.tags || []).forEach(t => set.add(t)));
    allNotes.forEach(n => (n.tags || []).forEach(t => set.add(t)));
    return Array.from(set).sort((a,b)=>a.localeCompare(b,'zh-CN'));
  }

  async getByTag(tag: string): Promise<{highlights: StoredHighlight[]; notes: BookNote[]}> {
    if (!this.db) await this.init();
    const [hl, notes] = await Promise.all([
      this.getHighlightsByTag(tag),
      this.getNotesByTag(tag),
    ]);
    return { highlights: hl, notes };
  }

  async suggestTags(prefix: string, limit = 8): Promise<string[]> {
    const all = await this.getAllTags();
    const q = prefix.trim().toLowerCase();
    if (!q) return all.slice(0, limit);
    return all.filter(t => t.toLowerCase().includes(q)).slice(0, limit);
  }

  /**
   * 搜索笔记
   */
  async searchNotes(query: string): Promise<BookNote[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("notes", "readonly");
    const allNotes = await tx.store.getAll();

    const lowerQuery = query.toLowerCase();
    return allNotes.filter(
      (n) =>
        n.title.toLowerCase().includes(lowerQuery) ||
        n.content.toLowerCase().includes(lowerQuery) ||
        n.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * 删除笔记
   */
  async deleteNote(id: string): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("notes", "readwrite");
    await tx.store.delete(id);
    await tx.done;
  }

  /**
   * 保存书籍元数据
   */
  async saveBook(book: BookMetadata): Promise<void> {
    if (!this.db) await this.init();

    const now = Date.now();
    book.createdAt = book.createdAt ?? now;
    book.lastReadAt = book.lastReadAt ?? now;
    book.updatedAt = now;
    book.progress = book.progress ?? 0;

    const tx = this.db!.transaction("books", "readwrite");
    await tx.store.put(book);
    await tx.done;
  }

  /**
   * 部分更新书籍元数据
   */
  async updateBookMetadata(
    bookId: string,
    updates: Partial<BookMetadata>
  ): Promise<BookMetadata | undefined> {
    if (!this.db) await this.init();

    const existing = await this.getBook(bookId);
    if (!existing) return undefined;

    const updated: BookMetadata = {
      ...existing,
      ...updates,
      id: bookId,
      updatedAt: Date.now(),
    };

    const tx = this.db!.transaction("books", "readwrite");
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  /**
   * 获取所有书籍
   */
  async getAllBooks(): Promise<BookMetadata[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("books", "readonly");
    const books = await tx.store.getAll();
    return books.map((book) => this.normalizeBookMetadata(book)).filter(Boolean) as BookMetadata[];
  }

  /**
   * 获取书籍
   */
  async getBook(id: string): Promise<BookMetadata | undefined> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("books", "readonly");
    const book = await tx.store.get(id);
    return this.normalizeBookMetadata(book);
  }

  private normalizeBookMetadata(
    book: BookMetadata | undefined
  ): BookMetadata | undefined {
    if (!book) return undefined;
    const now = Date.now();
    return {
      ...book,
      createdAt: book.createdAt ?? now,
      lastReadAt: book.lastReadAt ?? now,
      updatedAt: book.updatedAt ?? book.lastReadAt ?? now,
      progress: book.progress ?? 0,
    };
  }

  /**
   * 保存书籍文件
   */
  async saveBookFile(
    bookId: string,
    file: Blob,
    fileName: string,
    mimeType?: string
  ): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("bookFiles", "readwrite");
    await tx.store.put({
      bookId,
      file,
      fileName,
      fileSize: file.size,
      mimeType: mimeType || file.type || "application/epub+zip",
      updatedAt: Date.now(),
    });
    await tx.done;
  }

  /**
   * 获取书籍文件
   */
  async getBookFile(bookId: string): Promise<BookFileRecord | undefined> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("bookFiles", "readonly");
    return await tx.store.get(bookId);
  }

  /**
   * 删除书籍及相关数据
   */
  async deleteBook(bookId: string): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction(
      ["books", "bookFiles", "highlights", "notes"],
      "readwrite"
    );
    const bookStore = tx.objectStore("books");
    const fileStore = tx.objectStore("bookFiles");
    const highlightStore = tx.objectStore("highlights");
    const noteStore = tx.objectStore("notes");

    const highlightIndex = highlightStore.index("by-book");
    const noteIndex = noteStore.index("by-book");

    const [highlightKeys, noteKeys] = await Promise.all([
      highlightIndex.getAllKeys(bookId),
      noteIndex.getAllKeys(bookId),
    ]);

    await Promise.all([
      bookStore.delete(bookId),
      fileStore.delete(bookId),
      ...highlightKeys.map((key) => highlightStore.delete(key)),
      ...noteKeys.map((key) => noteStore.delete(key)),
    ]);

    await tx.done;
  }

  /**
   * 删除书籍文件（保留元数据）
   */
  async deleteBookFile(bookId: string): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("bookFiles", "readwrite");
    await tx.store.delete(bookId);
    await tx.done;
  }

  /**
   * 自动整理笔记和划线
   */
  async getOrganizedAnnotations(
    bookId: string
  ): Promise<OrganizedAnnotations> {
    if (!this.db) await this.init();

    const [highlights, notes] = await Promise.all([
      this.getHighlightsByBook(bookId),
      this.getNotesByBook(bookId),
    ]);

    const byTagMap = new Map<string, AnnotationBucket>();
    const byChapterMap = new Map<string, AnnotationBucket>();
    const byDateMap = new Map<string, AnnotationBucket>();
    const bySourceMap = new Map<string, AnnotationBucket>();

    const ensureBucket = (
      target: Map<string, AnnotationBucket>,
      key: string,
      title: string,
      type: AnnotationBucket["type"]
    ) => {
      if (!target.has(key)) {
        target.set(key, {
          key,
          title,
          type,
          highlights: [],
          notes: [],
        });
      }
      return target.get(key)!;
    };

    highlights.forEach((highlight) => {
      const tags = highlight.tags ?? [];
      if (highlight.note && (!highlight.tags || highlight.tags.length === 0)) {
        tags.push("含笔记");
      }
      if (tags.length === 0) {
        tags.push("未分类");
      }

      tags.forEach((tag) => {
        ensureBucket(byTagMap, tag, tag, "tag").highlights.push(highlight);
      });

      const chapterKey = highlight.chapterId || highlight.chapterTitle || "未关联章节";
      const chapterTitle = highlight.chapterTitle || highlight.chapterId || "未关联章节";
      ensureBucket(
        byChapterMap,
        chapterKey,
        chapterTitle,
        "chapter"
      ).highlights.push(highlight);

      const dateKey = new Date(highlight.createdAt ?? Date.now())
        .toISOString()
        .slice(0, 10);
      ensureBucket(byDateMap, dateKey, dateKey, "date").highlights.push(
        highlight
      );

      const sourceKey = highlight.source || "local";
      ensureBucket(bySourceMap, sourceKey, sourceKey, "source").highlights.push(
        highlight
      );
    });

    notes.forEach((note) => {
      const tags = note.tags.length > 0 ? note.tags : ["未分类"];
      tags.forEach((tag) => {
        ensureBucket(byTagMap, tag, tag, "tag").notes.push(note);
      });

      const chapterKey = note.chapter || "未关联章节";
      const chapterTitle =
        note.chapter && note.chapter.trim().length > 0
          ? note.chapter
          : "未关联章节";
      ensureBucket(
        byChapterMap,
        chapterKey,
        chapterTitle,
        "chapter"
      ).notes.push(note);

      const dateKey = new Date(note.createdAt).toISOString().slice(0, 10);
      ensureBucket(byDateMap, dateKey, dateKey, "date").notes.push(note);

      ensureBucket(bySourceMap, "local", "本地笔记", "source").notes.push(note);
    });

    const sortBuckets = (buckets: Map<string, AnnotationBucket>) =>
      Array.from(buckets.values()).sort((a, b) =>
        a.title.localeCompare(b.title, "zh-CN")
      );

    return {
      byTag: sortBuckets(byTagMap),
      byChapter: sortBuckets(byChapterMap),
      byDate: sortBuckets(byDateMap).sort((a, b) => b.key.localeCompare(a.key)),
      bySource: sortBuckets(bySourceMap),
    };
  }

  /**
   * 更新阅读进度
   */
  async updateProgress(bookId: string, progress: number): Promise<void> {
    if (!this.db) await this.init();

    const book = await this.getBook(bookId);
    if (book) {
      book.progress = progress;
      book.lastReadAt = Date.now();
      await this.saveBook(book);
    }
  }

  /**
   * 同步微信读书的标注
   * 调用方应提供规范化后的数据
   */
  async mergeExternalHighlights(
    bookId: string,
    externalHighlights: StoredHighlight[]
  ): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("highlights", "readwrite");
    const index = tx.store.index("by-book");
    const existingHighlights = await index.getAll(bookId);
    const existingMap = new Map(existingHighlights.map((h) => [h.id, h]));

    await Promise.all(
      externalHighlights.map(async (highlight) => {
        if (!existingMap.has(highlight.id)) {
          await tx.store.put({
            ...highlight,
            source: highlight.source || "wechat",
          });
        }
      })
    );

    await tx.done;
  }

  /**
   * 导出数据为 JSON
   */
  async exportToJSON(): Promise<string> {
    if (!this.db) await this.init();

    const [highlights, notes, books] = await Promise.all([
      this.db!.getAll("highlights"),
      this.db!.getAll("notes"),
      this.db!.getAll("books"),
    ]);

    return JSON.stringify(
      {
        highlights,
        notes,
        books,
        exportDate: new Date().toISOString(),
      },
      null,
      2
    );
  }

  /**
   * 导出为 Markdown
   */
  async exportToMarkdown(bookId?: string): Promise<string> {
    if (!this.db) await this.init();

    const books = bookId
      ? ([await this.getBook(bookId)].filter(Boolean) as BookMetadata[])
      : await this.getAllBooks();

    let markdown = "# 读书报告\n\n";
    markdown += `生成时间: ${new Date().toLocaleString("zh-CN")}\n\n`;

    for (const book of books) {
      markdown += `## ${book.title}\n\n`;
      markdown += `**作者**: ${book.author}\n\n`;
      markdown += `**阅读进度**: ${(book.progress * 100).toFixed(1)}%\n\n`;

      const notes = await this.getNotesByBook(book.id);
      const highlights = await this.getHighlightsByBook(book.id);

      if (notes.length > 0) {
        markdown += `### 笔记 (${notes.length}条)\n\n`;
        notes.forEach((note, index) => {
          markdown += `#### 笔记 ${index + 1}\n\n`;
          markdown += `${note.content}\n\n`;
          if (note.tags.length > 0) {
            markdown += `**标签**: ${note.tags.join(", ")}\n\n`;
          }
        });
      }

      if (highlights.length > 0) {
        markdown += `### 划线 (${highlights.length}条)\n\n`;
        highlights.forEach((highlight, index) => {
          markdown += `${index + 1}. ${highlight.text}\n`;
          if (highlight.note) {
            markdown += `   > ${highlight.note}\n`;
          }
        });
        markdown += "\n";
      }

      markdown += "---\n\n";
    }

    return markdown;
  }

  /**
   * 导出为思维导图格式（简化版 JSON）
   */
  async exportToMindMap(bookId: string): Promise<string> {
    if (!this.db) await this.init();

    const book = await this.getBook(bookId);
    if (!book) {
      throw new Error("Book not found");
    }

    const notes = await this.getNotesByBook(bookId);
    const highlights = await this.getHighlightsByBook(bookId);

    const mindMap = {
      name: book.title,
      children: [
        {
          name: "笔记",
          children: notes.map((note) => ({
            name: note.title || note.content.substring(0, 50),
            children: note.tags.map((tag) => ({ name: tag })),
          })),
        },
        {
          name: "划线",
          children: highlights.map((h) => ({
            name: h.text.substring(0, 50),
          })),
        },
      ],
    };

    return JSON.stringify(mindMap, null, 2);
  }

  /**
   * 清空所有数据
   */
  async clearAll(): Promise<void> {
    if (!this.db) await this.init();

    const [highlightTx, noteTx, bookTx] = [
      this.db!.transaction("highlights", "readwrite"),
      this.db!.transaction("notes", "readwrite"),
      this.db!.transaction("books", "readwrite"),
    ];

    await Promise.all([
      highlightTx.store.clear(),
      noteTx.store.clear(),
      bookTx.store.clear(),
    ]);

    await Promise.all([highlightTx.done, noteTx.done, bookTx.done]);
  }
}
