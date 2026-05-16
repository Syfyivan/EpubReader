import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { Highlight } from "../highlight/HighlightSystem";
import { EpubParser } from "../parse/parse";

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

export type LibrarySearchScope = "all" | "books" | "fullText" | "annotations";

export interface LibrarySearchResult {
  id: string;
  type: "book" | "chapter" | "highlight" | "note";
  bookId: string;
  bookTitle: string;
  title: string;
  snippet: string;
  score: number;
  chapterId?: string;
  chapterTitle?: string;
  source?: "local" | "wechat";
}

export interface LibrarySearchOptions {
  scope?: LibrarySearchScope;
  bookId?: string;
  limit?: number;
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  type: "theme" | "book" | "annotation";
  weight: number;
  bookId?: string;
  bookTitle?: string;
  source?: "local" | "wechat";
  snippet?: string;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  reason: string;
}

export interface KnowledgeGraph {
  generatedAt: string;
  themes: string[];
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface KnowledgeGraphOptions {
  bookId?: string;
  limit?: number;
  minThemeCount?: number;
}

interface BookTextIndexEntry {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  text: string;
}

interface AnnotationDocument {
  id: string;
  type: "highlight" | "note";
  bookId: string;
  bookTitle: string;
  chapterId?: string;
  chapterTitle?: string;
  text: string;
  tags: string[];
  source?: "local" | "wechat";
  createdAt: number;
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
  private fullTextIndexCache: Map<string, BookTextIndexEntry[]> = new Map();

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
          if (!highlightStore.indexNames.contains("by-tag")) {
            highlightStore.createIndex("by-tag", "tags", { multiEntry: true });
          }
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
   * 全库搜索：支持书名/作者、EPUB 全文、划线和笔记。
   * EPUB 正文索引按书懒构建并缓存在当前页面会话中。
   */
  async searchLibrary(
    query: string,
    options: LibrarySearchOptions = {}
  ): Promise<LibrarySearchResult[]> {
    if (!this.db) await this.init();

    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const scope = options.scope ?? "all";
    const limit = options.limit ?? 50;
    const lowerQuery = normalizedQuery.toLowerCase();
    const books = (await this.getAllBooks()).filter((book) =>
      options.bookId ? book.id === options.bookId : true
    );
    const bookById = new Map(books.map((book) => [book.id, book]));
    const results: LibrarySearchResult[] = [];

    if (scope === "all" || scope === "books") {
      books.forEach((book) => {
        const haystack = `${book.title} ${book.author} ${(book.tags ?? []).join(" ")}`.toLowerCase();
        const matchCount = this.countMatches(haystack, lowerQuery);
        if (matchCount > 0) {
          results.push({
            id: `book-${book.id}`,
            type: "book",
            bookId: book.id,
            bookTitle: book.title,
            title: book.title,
            snippet: book.author || "未知作者",
            score: matchCount + 8,
          });
        }
      });
    }

    if (scope === "all" || scope === "annotations") {
      const docs = await this.getAnnotationDocuments(bookById);
      docs.forEach((doc) => {
        const haystack = `${doc.text} ${doc.tags.join(" ")}`.toLowerCase();
        const matchCount = this.countMatches(haystack, lowerQuery);
        if (matchCount > 0) {
          results.push({
            id: `${doc.type}-${doc.id}`,
            type: doc.type,
            bookId: doc.bookId,
            bookTitle: doc.bookTitle,
            title: doc.type === "highlight" ? "划线" : "笔记",
            snippet: this.buildSnippet(doc.text, normalizedQuery),
            score: matchCount + (doc.type === "highlight" ? 4 : 5),
            chapterId: doc.chapterId,
            chapterTitle: doc.chapterTitle,
            source: doc.source,
          });
        }
      });
    }

    if (scope === "all" || scope === "fullText") {
      const indexes = await Promise.all(
        books.map((book) => this.buildBookTextIndex(book).catch(() => []))
      );
      indexes.flat().forEach((entry) => {
        const lowerText = entry.text.toLowerCase();
        const matchCount = this.countMatches(lowerText, lowerQuery);
        if (matchCount > 0) {
          results.push({
            id: `chapter-${entry.bookId}-${entry.chapterId}`,
            type: "chapter",
            bookId: entry.bookId,
            bookTitle: entry.bookTitle,
            title: entry.chapterTitle,
            snippet: this.buildSnippet(entry.text, normalizedQuery),
            score: matchCount + 2,
            chapterId: entry.chapterId,
            chapterTitle: entry.chapterTitle,
          });
        }
      });
    }

    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  /**
   * 构建跨书知识图谱：用主题节点连接不同书籍中的划线和笔记。
   */
  async buildKnowledgeGraph(
    options: KnowledgeGraphOptions = {}
  ): Promise<KnowledgeGraph> {
    if (!this.db) await this.init();

    const books = (await this.getAllBooks()).filter((book) =>
      options.bookId ? book.id === options.bookId : true
    );
    const bookById = new Map(books.map((book) => [book.id, book]));
    const docs = (await this.getAnnotationDocuments(bookById)).filter((doc) =>
      options.bookId ? doc.bookId === options.bookId : true
    );
    const minThemeCount = options.minThemeCount ?? (options.bookId ? 1 : 2);
    const annotationLimit = options.limit ?? 80;

    const themeStats = new Map<
      string,
      { docs: Set<string>; books: Set<string>; explicit: boolean }
    >();
    const docThemes = new Map<string, string[]>();

    docs.forEach((doc) => {
      const themes = this.extractKnowledgeThemes(doc.text, doc.tags);
      docThemes.set(doc.id, themes);
      themes.forEach((theme) => {
        const stat =
          themeStats.get(theme) ??
          { docs: new Set<string>(), books: new Set<string>(), explicit: false };
        stat.docs.add(doc.id);
        stat.books.add(doc.bookId);
        stat.explicit = stat.explicit || doc.tags.includes(theme);
        themeStats.set(theme, stat);
      });
    });

    const selectedThemes = Array.from(themeStats.entries())
      .filter(([, stat]) => stat.docs.size >= minThemeCount || stat.explicit)
      .sort((left, right) => {
        const docDiff = right[1].docs.size - left[1].docs.size;
        if (docDiff !== 0) return docDiff;
        return right[1].books.size - left[1].books.size;
      })
      .slice(0, 24)
      .map(([theme]) => theme);

    const selectedThemeSet = new Set(selectedThemes);
    const rankedDocs = docs
      .map((doc) => ({
        doc,
        themes: (docThemes.get(doc.id) ?? []).filter((theme) => selectedThemeSet.has(theme)),
      }))
      .filter((item) => item.themes.length > 0)
      .sort((left, right) => {
        const themeDiff = right.themes.length - left.themes.length;
        if (themeDiff !== 0) return themeDiff;
        return right.doc.createdAt - left.doc.createdAt;
      })
      .slice(0, annotationLimit);

    const nodeMap = new Map<string, KnowledgeGraphNode>();
    const edgeMap = new Map<string, KnowledgeGraphEdge>();

    selectedThemes.forEach((theme) => {
      const stat = themeStats.get(theme);
      nodeMap.set(`theme:${theme}`, {
        id: `theme:${theme}`,
        label: theme,
        type: "theme",
        weight: stat?.docs.size ?? 1,
      });
    });

    books.forEach((book) => {
      const weight = rankedDocs.filter((item) => item.doc.bookId === book.id).length;
      if (weight > 0) {
        nodeMap.set(`book:${book.id}`, {
          id: `book:${book.id}`,
          label: book.title,
          type: "book",
          weight,
          bookId: book.id,
          bookTitle: book.title,
        });
      }
    });

    rankedDocs.forEach(({ doc, themes }) => {
      const annotationNodeId = `annotation:${doc.id}`;
      nodeMap.set(annotationNodeId, {
        id: annotationNodeId,
        label: doc.type === "highlight" ? "划线" : "笔记",
        type: "annotation",
        weight: themes.length,
        bookId: doc.bookId,
        bookTitle: doc.bookTitle,
        source: doc.source,
        snippet: this.buildSnippet(doc.text, doc.text.slice(0, 12), 42),
      });

      const bookNodeId = `book:${doc.bookId}`;
      if (nodeMap.has(bookNodeId)) {
        this.addGraphEdge(edgeMap, bookNodeId, annotationNodeId, 1, "书籍包含这条标注");
      }

      themes.forEach((theme) => {
        const themeNodeId = `theme:${theme}`;
        const stat = themeStats.get(theme);
        this.addGraphEdge(
          edgeMap,
          themeNodeId,
          annotationNodeId,
          Math.max(1, stat?.docs.size ?? 1),
          `命中主题：${theme}`
        );
        if (nodeMap.has(bookNodeId)) {
          this.addGraphEdge(
            edgeMap,
            themeNodeId,
            bookNodeId,
            stat?.books.has(doc.bookId) ? 2 : 1,
            `《${doc.bookTitle}》包含主题：${theme}`
          );
        }
      });
    });

    const byTheme = new Map<string, AnnotationDocument[]>();
    rankedDocs.forEach(({ doc, themes }) => {
      themes.forEach((theme) => {
        const docsForTheme = byTheme.get(theme) ?? [];
        docsForTheme.push(doc);
        byTheme.set(theme, docsForTheme);
      });
    });

    byTheme.forEach((items, theme) => {
      const crossBookPairs: Array<[AnnotationDocument, AnnotationDocument]> = [];
      for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
          if (items[leftIndex].bookId !== items[rightIndex].bookId) {
            crossBookPairs.push([items[leftIndex], items[rightIndex]]);
          }
        }
      }
      crossBookPairs.slice(0, 8).forEach(([left, right]) => {
        this.addGraphEdge(
          edgeMap,
          `annotation:${left.id}`,
          `annotation:${right.id}`,
          1,
          `跨书共享主题：${theme}`
        );
      });
    });

    return {
      generatedAt: new Date().toISOString(),
      themes: selectedThemes,
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()).sort((left, right) => right.weight - left.weight),
    };
  }

  async exportKnowledgeGraphMindMap(bookId?: string): Promise<string> {
    const graph = await this.buildKnowledgeGraph({ bookId });
    const annotationNodes = graph.nodes.filter((node) => node.type === "annotation");
    const bookNodes = new Map(
      graph.nodes
        .filter((node) => node.type === "book")
        .map((node) => [node.id, node])
    );

    const children = graph.themes.map((theme) => {
      const themeNodeId = `theme:${theme}`;
      const linkedAnnotationIds = new Set(
        graph.edges
          .filter((edge) => edge.source === themeNodeId && edge.target.startsWith("annotation:"))
          .map((edge) => edge.target)
      );
      const groupedByBook = new Map<string, KnowledgeGraphNode[]>();

      annotationNodes.forEach((node) => {
        if (!linkedAnnotationIds.has(node.id) || !node.bookId) return;
        const bookNodeId = `book:${node.bookId}`;
        const list = groupedByBook.get(bookNodeId) ?? [];
        list.push(node);
        groupedByBook.set(bookNodeId, list);
      });

      return {
        name: theme,
        children: Array.from(groupedByBook.entries()).map(([bookNodeId, nodes]) => ({
          name: bookNodes.get(bookNodeId)?.label ?? "未知书籍",
          children: nodes.map((node) => ({
            name: node.snippet ?? node.label,
            children: [
              { name: node.source === "wechat" ? "微信读书" : "本地" },
            ],
          })),
        })),
      };
    });

    return JSON.stringify(
      {
        name: bookId ? "本书知识图谱" : "跨书知识图谱",
        children,
        graph,
      },
      null,
      2
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

  private normalizeSearchText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private stripHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return this.normalizeSearchText(doc.body.textContent ?? "");
  }

  private countMatches(text: string, query: string): number {
    if (!text || !query) return 0;
    return text.split(query).length - 1;
  }

  private buildSnippet(text: string, query: string, radius = 56): string {
    const normalizedText = this.normalizeSearchText(text);
    const lowerText = normalizedText.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index < 0) {
      return normalizedText.slice(0, radius * 2);
    }
    const start = Math.max(0, index - radius);
    const end = Math.min(normalizedText.length, index + query.length + radius);
    return `${start > 0 ? "..." : ""}${normalizedText.slice(start, end)}${
      end < normalizedText.length ? "..." : ""
    }`;
  }

  private async getAnnotationDocuments(
    bookById?: Map<string, BookMetadata>
  ): Promise<AnnotationDocument[]> {
    const [books, highlights, notes] = await Promise.all([
      bookById ? Promise.resolve(Array.from(bookById.values())) : this.getAllBooks(),
      this.getAllHighlights(),
      this.getAllNotes(),
    ]);
    const resolvedBookById = bookById ?? new Map(books.map((book) => [book.id, book]));
    const docs: AnnotationDocument[] = [];

    highlights.forEach((highlight) => {
      const book = resolvedBookById.get(highlight.bookId);
      if (!book) return;
      const tags = highlight.tags ?? [];
      const inlineNotes = highlight.notes ?? [];
      docs.push({
        id: highlight.id,
        type: "highlight",
        bookId: highlight.bookId,
        bookTitle: book.title,
        chapterId: highlight.chapterId,
        chapterTitle: highlight.chapterTitle || highlight.chapterId,
        text: this.normalizeSearchText(
          [
            highlight.text,
            highlight.note,
            ...inlineNotes.map((note) => note.content),
          ]
            .filter(Boolean)
            .join(" ")
        ),
        tags: Array.from(new Set([...tags, ...inlineNotes.flatMap((note) => note.tags ?? [])])),
        source: highlight.source ?? "local",
        createdAt: highlight.createdAt ?? Date.now(),
      });
    });

    notes.forEach((note) => {
      const book = resolvedBookById.get(note.bookId);
      if (!book) return;
      docs.push({
        id: note.id,
        type: "note",
        bookId: note.bookId,
        bookTitle: book.title,
        chapterTitle: note.chapter,
        text: this.normalizeSearchText([note.title, note.content].filter(Boolean).join(" ")),
        tags: note.tags ?? [],
        source: note.source ?? "local",
        createdAt: note.createdAt ?? Date.now(),
      });
    });

    return docs;
  }

  private async buildBookTextIndex(book: BookMetadata): Promise<BookTextIndexEntry[]> {
    const cached = this.fullTextIndexCache.get(book.id);
    if (cached) return cached;

    const record = await this.getBookFile(book.id);
    const source =
      record
        ? new File([record.file], record.fileName, {
            type: record.mimeType || "application/epub+zip",
          })
        : /^https?:\/\//i.test(book.filePath ?? "")
        ? book.filePath!
        : null;

    if (!source) {
      this.fullTextIndexCache.set(book.id, []);
      return [];
    }

    const parser = new EpubParser();
    try {
      await parser.load(source);
      const entries: BookTextIndexEntry[] = [];
      const chapters = parser.getChapters();
      for (const chapter of chapters) {
        const html = await parser.loadChapter(chapter.id);
        const text = this.stripHtml(html);
        if (!text) continue;
        entries.push({
          bookId: book.id,
          bookTitle: book.title,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          text,
        });
      }
      this.fullTextIndexCache.set(book.id, entries);
      return entries;
    } finally {
      await parser.close();
    }
  }

  private addGraphEdge(
    edgeMap: Map<string, KnowledgeGraphEdge>,
    source: string,
    target: string,
    weight: number,
    reason: string
  ) {
    if (source === target) return;
    const id = `${source}->${target}:${reason}`;
    const existing = edgeMap.get(id);
    if (existing) {
      existing.weight += weight;
      return;
    }
    edgeMap.set(id, { id, source, target, weight, reason });
  }

  private extractKnowledgeThemes(text: string, tags: string[]): string[] {
    const stopTags = new Set(["划线", "笔记", "微信读书", "本地", "本地标注", "想法", "未分类"]);
    const themes = new Set<string>();
    tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 2 && !stopTags.has(tag))
      .forEach((tag) => themes.add(tag));

    const knownThemes = [
      "自由意志",
      "现代性",
      "叙事结构",
      "主体性",
      "理性",
      "权力",
      "记忆",
      "身份",
      "时间",
      "伦理",
      "存在主义",
      "资本主义",
      "民族国家",
      "技术",
      "语言",
      "历史",
      "制度",
      "共同体",
      "知识",
      "意识",
    ];
    knownThemes.forEach((theme) => {
      if (text.includes(theme)) themes.add(theme);
    });

    const quoted = Array.from(text.matchAll(/[“"《]([^”"》]{2,18})[”"》]/g));
    quoted.forEach((match) => {
      const candidate = match[1]?.trim();
      if (candidate && candidate.length <= 18) themes.add(candidate);
    });

    const englishStopWords = new Set([
      "this",
      "that",
      "with",
      "from",
      "have",
      "will",
      "they",
      "them",
      "their",
      "there",
      "about",
      "which",
      "would",
      "could",
      "should",
      "between",
      "because",
    ]);
    Array.from(text.toLowerCase().matchAll(/\b[a-z][a-z-]{3,}\b/g))
      .map((match) => match[0])
      .filter((word) => !englishStopWords.has(word))
      .slice(0, 16)
      .forEach((word) => themes.add(word));

    return Array.from(themes).slice(0, 12);
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
    this.fullTextIndexCache.delete(bookId);
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
    this.fullTextIndexCache.delete(bookId);
  }

  /**
   * 删除书籍文件（保留元数据）
   */
  async deleteBookFile(bookId: string): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction("bookFiles", "readwrite");
    await tx.store.delete(bookId);
    await tx.done;
    this.fullTextIndexCache.delete(bookId);
  }

  /**
   * 自动整理笔记和划线（单本）
   */
  async getOrganizedAnnotations(
    bookId: string
  ): Promise<OrganizedAnnotations> {
    if (!this.db) await this.init();

    const [highlights, notes] = await Promise.all([
      this.getHighlightsByBook(bookId),
      this.getNotesByBook(bookId),
    ]);

    return this.organizeBuckets(highlights, notes);
  }

  /**
   * 自动整理笔记和划线（全部图书）
   */
  async getOrganizedAnnotationsAll(): Promise<OrganizedAnnotations> {
    if (!this.db) await this.init();
    const [highlights, notes] = await Promise.all([
      this.getAllHighlights(),
      this.getAllNotes(),
    ]);
    return this.organizeBuckets(highlights, notes);
  }

  private organizeBuckets(
    highlights: StoredHighlight[],
    notes: BookNote[]
  ): OrganizedAnnotations {
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
      const tags = highlight.tags && highlight.tags.length > 0 ? [...highlight.tags] : [];
      if (highlight.note && (!highlight.tags || highlight.tags.length === 0)) {
        tags.push("含笔记");
      }
      if (tags.length === 0) {
        tags.push("未分类");
      }
      tags.forEach((tag) => {
        ensureBucket(byTagMap, tag, tag, "tag").highlights.push(highlight);
      });

      const chapterKey = highlight.chapterTitle || highlight.chapterId || "未关联章节";
      const chapterTitle = highlight.chapterTitle || highlight.chapterId || "未关联章节";
      ensureBucket(byChapterMap, chapterKey, chapterTitle, "chapter").highlights.push(highlight);

      const dateKey = new Date(highlight.createdAt ?? Date.now()).toISOString().slice(0, 10);
      ensureBucket(byDateMap, dateKey, dateKey, "date").highlights.push(highlight);

      const sourceKey = highlight.source || "local";
      ensureBucket(bySourceMap, sourceKey, sourceKey, "source").highlights.push(highlight);

      // 将高亮下的内联笔记一并纳入整理
      if (highlight.notes && highlight.notes.length > 0) {
        highlight.notes.forEach((n) => {
          const bn: BookNote = {
            id: `${highlight.id}::${n.id}`,
            bookId: highlight.bookId,
            title: chapterTitle,
            content: n.content,
            chapter: chapterTitle,
            tags: Array.isArray(n.tags) && n.tags.length > 0 ? n.tags : ["未分类"],
            createdAt: n.createdAt || highlight.createdAt || Date.now(),
            updatedAt: n.updatedAt || highlight.updatedAt || Date.now(),
            source: highlight.source || "local",
          };
          // 标签
          bn.tags.forEach((tag) => {
            ensureBucket(byTagMap, tag, tag, "tag").notes.push(bn);
          });
          // 章节
          ensureBucket(byChapterMap, chapterKey, chapterTitle, "chapter").notes.push(bn);
          // 日期
          const nd = new Date(bn.createdAt).toISOString().slice(0, 10);
          ensureBucket(byDateMap, nd, nd, "date").notes.push(bn);
          // 来源
          ensureBucket(bySourceMap, bn.source || "local", bn.source || "local", "source").notes.push(bn);
        });
      }
    });

    notes.forEach((note) => {
      const tags = note.tags.length > 0 ? note.tags : ["未分类"];
      tags.forEach((tag) => {
        ensureBucket(byTagMap, tag, tag, "tag").notes.push(note);
      });

      const chapterKey = note.chapter || "未关联章节";
      const chapterTitle = note.chapter && note.chapter.trim().length > 0 ? note.chapter : "未关联章节";
      ensureBucket(byChapterMap, chapterKey, chapterTitle, "chapter").notes.push(note);

      const dateKey = new Date(note.createdAt).toISOString().slice(0, 10);
      ensureBucket(byDateMap, dateKey, dateKey, "date").notes.push(note);

      ensureBucket(bySourceMap, note.source || "local", note.source || "local", "source").notes.push(note);
    });

    const sortBuckets = (buckets: Map<string, AnnotationBucket>) =>
      Array.from(buckets.values()).sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

    return {
      byTag: sortBuckets(byTagMap),
      byChapter: sortBuckets(byChapterMap),
      byDate: Array.from(byDateMap.values()).sort((a, b) => b.key.localeCompare(a.key)),
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
          const sourceLabel = highlight.source === "wechat" ? "微信读书" : "本地";
          const chapterLabel = highlight.chapterTitle || highlight.chapterId;
          markdown += `${index + 1}. ${highlight.text}\n`;
          markdown += `   - 来源: ${sourceLabel}\n`;
          if (chapterLabel) {
            markdown += `   - 章节: ${chapterLabel}\n`;
          }
          if (highlight.note) {
            markdown += `   > ${highlight.note}\n`;
          }
          if (highlight.notes && highlight.notes.length > 0) {
            highlight.notes.forEach((note) => {
              markdown += `   > ${note.content}\n`;
              if (note.tags && note.tags.length > 0) {
                markdown += `   > 标签: ${note.tags.join(", ")}\n`;
              }
            });
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
            children: [
              { name: h.source === "wechat" ? "微信读书" : "本地" },
              ...(h.chapterTitle ? [{ name: h.chapterTitle }] : []),
              ...((h.notes ?? []).map((note) => ({
                name: note.content.substring(0, 50),
                children: (note.tags ?? []).map((tag) => ({ name: tag })),
              }))),
            ],
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

    const [highlightTx, noteTx, bookTx, fileTx] = [
      this.db!.transaction("highlights", "readwrite"),
      this.db!.transaction("notes", "readwrite"),
      this.db!.transaction("books", "readwrite"),
      this.db!.transaction("bookFiles", "readwrite"),
    ];

    await Promise.all([
      highlightTx.store.clear(),
      noteTx.store.clear(),
      bookTx.store.clear(),
      fileTx.store.clear(),
    ]);

    await Promise.all([highlightTx.done, noteTx.done, bookTx.done, fileTx.done]);
    this.fullTextIndexCache.clear();
  }
}
