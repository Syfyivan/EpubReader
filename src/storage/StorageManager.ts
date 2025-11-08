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
}

interface EpubReaderDB extends DBSchema {
  highlights: {
    key: string;
    value: StoredHighlight;
    indexes: { "by-book": string; "by-chapter": string; "by-date": number };
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
}

export class StorageManager {
  private db: IDBPDatabase<EpubReaderDB> | null = null;
  private dbName = "epub-reader-db";
  private version = 1;

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    this.db = await openDB<EpubReaderDB>(this.dbName, this.version, {
      upgrade(db) {
        // 创建划线表
        if (!db.objectStoreNames.contains("highlights")) {
          const highlightStore = db.createObjectStore("highlights", {
            keyPath: "id",
          });
          highlightStore.createIndex("by-book", "bookId");
          highlightStore.createIndex("by-chapter", "chapterId");
          highlightStore.createIndex("by-date", "createdAt");
        }

        // 创建笔记表
        if (!db.objectStoreNames.contains("notes")) {
          const noteStore = db.createObjectStore("notes", {
            keyPath: "id",
          });
          noteStore.createIndex("by-book", "bookId");
          noteStore.createIndex("by-date", "createdAt");
          noteStore.createIndex("by-tag", "tags", { multiEntry: true });
        }

        // 创建书籍元数据表
        if (!db.objectStoreNames.contains("books")) {
          const bookStore = db.createObjectStore("books", {
            keyPath: "id",
          });
          bookStore.createIndex("by-date", "lastReadAt");
        }
      },
    });
  }

  /**
   * 保存划线
   */
  async saveHighlight(highlight: StoredHighlight): Promise<void> {
    if (!this.db) await this.init();

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
    return await index.getAll(chapterId);
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
    return await index.getAll(bookId);
  }

  /**
   * 获取所有笔记
   */
  async getAllNotes(): Promise<BookNote[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("notes", "readonly");
    return await tx.store.getAll();
  }

  /**
   * 按标签获取笔记
   */
  async getNotesByTag(tag: string): Promise<BookNote[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("notes", "readonly");
    const index = tx.store.index("by-tag");
    return await index.getAll(tag);
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

    const tx = this.db!.transaction("books", "readwrite");
    await tx.store.put(book);
    await tx.done;
  }

  /**
   * 获取所有书籍
   */
  async getAllBooks(): Promise<BookMetadata[]> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("books", "readonly");
    return await tx.store.getAll();
  }

  /**
   * 获取书籍
   */
  async getBook(id: string): Promise<BookMetadata | undefined> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("books", "readonly");
    return await tx.store.get(id);
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
