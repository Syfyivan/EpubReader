import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AnnotationBucket,
  BookMetadata,
  BookNote,
  KnowledgeGraph,
  LibrarySearchResult,
  LibrarySearchScope,
  OrganizedAnnotations,
  StoredHighlight,
} from "../storage/StorageManager";
import type { StorageManager } from "../storage/StorageManager";
import {
  mcpApiClient,
  type MCPBookInfo,
  type MCPBookNote,
} from "../api/mcpApiClient";
import "./LibraryView.css";

const TagCenter = lazy(() => import("./TagCenter"));

interface LibraryViewProps {
  books: BookMetadata[];
  storageManager: StorageManager;
  onOpenBook: (book: BookMetadata, options?: { chapterId?: string; scrollTop?: number }) => void;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  activeBookId?: string;
}

interface ImportResult {
  addedNotes: number;
  addedHighlights: number;
}

const GROUP_PREVIEW_LIMIT = 3;

type ExternalAnnotation = Record<string, unknown>;

type MCPInsightAction = "sync" | "analysis" | "classify" | "knowledge";

interface KnowledgeConnection {
  source: string;
  target: string;
  weight: number;
}

interface MCPInsightState {
  title: string;
  body?: string;
  connections?: KnowledgeConnection[];
  generatedAt: number;
}

const emptyExternalPosition = () => ({
  start: { xpath: ".", offset: 0 },
  end: { xpath: ".", offset: 0 },
  timestamp: Date.now(),
});

const firstString = (item: ExternalAnnotation, keys: string[]) => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const normalizeTimestamp = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
};

const normalizeTags = (value: unknown, fallback: string[]) => {
  const tags = Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  return Array.from(new Set([...fallback, ...tags.map((tag) => tag.trim())]));
};

const safeIdPart = (value: string) =>
  encodeURIComponent(value)
    .replace(/%/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 36) || Math.random().toString(36).slice(2, 10);

const formatMcpResult = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return JSON.stringify(value, null, 2);
};

const downloadTextFile = (content: string, fileName: string, type = "application/json") => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const tokenizeKnowledgeText = (text: string) => {
  const words = text
    .toLowerCase()
    .split(/[\s,，。.!！?？;；:：、"'“”‘’()[\]{}<>《》]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);

  if (words.length > 1) {
    return new Set(words);
  }

  const compact = text.replace(/\s+/g, "");
  const shingles: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    shingles.push(compact.slice(index, index + 2));
  }
  return new Set(shingles);
};

const calculateKnowledgeWeight = (left: string, right: string) => {
  const leftTokens = tokenizeKnowledgeText(left);
  const rightTokens = tokenizeKnowledgeText(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  });

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
};

const buildKnowledgeConnections = (notes: MCPBookNote[]): KnowledgeConnection[] => {
  const connections: KnowledgeConnection[] = [];
  for (let leftIndex = 0; leftIndex < notes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < notes.length; rightIndex += 1) {
      const weight = calculateKnowledgeWeight(
        notes[leftIndex].content,
        notes[rightIndex].content
      );
      if (weight >= 0.18) {
        connections.push({
          source: notes[leftIndex].id,
          target: notes[rightIndex].id,
          weight,
        });
      }
    }
  }

  return connections.sort((left, right) => right.weight - left.weight).slice(0, 12);
};

const buildExternalHighlight = (
  item: ExternalAnnotation,
  book: BookMetadata,
  index: number
): StoredHighlight | null => {
  const text = firstString(item, [
    "content",
    "text",
    "markText",
    "abstract",
    "highlight",
    "note",
  ]);
  if (!text) return null;

  const chapter =
    firstString(item, ["chapter", "chapterName", "chapterTitle", "title"]) ||
    "微信读书";
  const createdAt = normalizeTimestamp(item.createdAt ?? item.createTime ?? item.created_time);
  const updatedAt = normalizeTimestamp(item.updatedAt ?? item.updateTime ?? item.updated_time);
  const rawId = firstString(item, ["id", "noteId", "reviewId", "bookmarkId"]) || `${index}-${text}`;
  const inlineNote = firstString(item, ["review", "comment", "thought"]);
  const note =
    inlineNote && inlineNote !== text
      ? [
          {
            id: `wechat-note-${safeIdPart(rawId)}`,
            content: inlineNote,
            createdAt,
            updatedAt,
            tags: ["微信读书", "想法"],
          },
        ]
      : undefined;

  return {
    id: `wechat-highlight-${safeIdPart(String(rawId))}`,
    bookId: book.id,
    chapterId: `wechat-${safeIdPart(chapter)}`,
    chapterTitle: chapter,
    position: emptyExternalPosition(),
    text,
    color: "#10b981",
    tags: normalizeTags(item.tags, ["微信读书", "划线"]),
    notes: note,
    source: "wechat",
    createdAt,
    updatedAt,
  };
};

const buildExternalNote = (
  item: ExternalAnnotation,
  book: BookMetadata,
  index: number
): BookNote | null => {
  const content = firstString(item, ["content", "text", "note", "review", "comment"]);
  if (!content) return null;

  const chapter =
    firstString(item, ["chapter", "chapterName", "chapterTitle", "title"]) ||
    undefined;
  const createdAt = normalizeTimestamp(item.createdAt ?? item.createTime ?? item.created_time);
  const rawId = firstString(item, ["id", "noteId", "reviewId"]) || `${index}-${content}`;

  return {
    id: `wechat-note-${safeIdPart(String(rawId))}`,
    bookId: book.id,
    title: chapter ?? book.title,
    content,
    chapter,
    tags: normalizeTags(item.tags, ["微信读书", "笔记"]),
    createdAt,
    updatedAt: normalizeTimestamp(item.updatedAt ?? item.updateTime ?? item.updated_time),
    source: "wechat",
  };
};

function renderBucketPreview(
  bucket: AnnotationBucket,
  type: "highlights" | "notes"
) {
  const items = type === "highlights" ? bucket.highlights : bucket.notes;
  if (items.length === 0) return null;
  const preview = items.slice(0, GROUP_PREVIEW_LIMIT);
  const toggle = (e: React.MouseEvent<HTMLLIElement>) => {
    e.currentTarget.classList.toggle("expanded");
  };
  return (
    <ul className="bucket-preview">
      {preview.map((item) =>
        type === "highlights" ? (
          <li
            key={(item as StoredHighlight).id}
            onClick={toggle}
            title={(item as StoredHighlight).text}
          >
            {(item as StoredHighlight).text}
          </li>
        ) : (
          <li
            key={(item as BookNote).id}
            onClick={toggle}
            title={(item as BookNote).content}
          >
            {(item as BookNote).content}
          </li>
        )
      )}
      {items.length > GROUP_PREVIEW_LIMIT && (
        <li className="bucket-more">…… 共 {items.length} 条</li>
      )}
    </ul>
  );
}

const LibraryView: React.FC<LibraryViewProps> = ({
  books,
  storageManager,
  onOpenBook,
  onBack,
  onRefresh,
  activeBookId,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(
    books[0]?.id ?? null
  );
  const [organized, setOrganized] = useState<OrganizedAnnotations | null>(null);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTagCenter, setShowTagCenter] = useState<boolean>(false);
  const [mcpServerPath, setMcpServerPath] = useState("");
  const [mcpQuery, setMcpQuery] = useState("");
  const [mcpBooks, setMcpBooks] = useState<MCPBookInfo[]>([]);
  const [selectedMcpBookId, setSelectedMcpBookId] = useState("");
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpSyncing, setMcpSyncing] = useState(false);
  const [mcpInsightLoading, setMcpInsightLoading] = useState<MCPInsightAction | null>(null);
  const [mcpInsight, setMcpInsight] = useState<MCPInsightState | null>(null);
  const [librarySearchQuery, setLibrarySearchQuery] = useState("");
  const [librarySearchScope, setLibrarySearchScope] = useState<LibrarySearchScope>("all");
  const [librarySearchResults, setLibrarySearchResults] = useState<LibrarySearchResult[]>([]);
  const [librarySearchLoading, setLibrarySearchLoading] = useState(false);
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId]
  );
  const selectedBookTitle = selectedBook?.title ?? "";

  useEffect(() => {
    if (selectedBookId && selectedBookTitle) {
      setMcpQuery(selectedBookTitle);
      setMcpBooks([]);
      setSelectedMcpBookId("");
    }
  }, [selectedBookId, selectedBookTitle]);

  const filteredBooks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return books;
    return books.filter((book) => {
      const title = book.title?.toLowerCase() ?? "";
      const author = book.author?.toLowerCase() ?? "";
      return title.includes(term) || author.includes(term);
    });
  }, [books, searchTerm]);

  const loadAnnotations = useCallback(
    async (bookId: string) => {
      setLoadingBuckets(true);
      setError(null);
      try {
        const data = await storageManager.getOrganizedAnnotations(bookId);
        setOrganized(data);
      } catch (err) {
        console.error("Failed to load annotations:", err);
        setError("载入划线与笔记分类失败，请稍后重试。");
        setOrganized(null);
      } finally {
        setLoadingBuckets(false);
      }
    },
    [storageManager]
  );

  useEffect(() => {
    if (!selectedBookId && books.length > 0) {
      setSelectedBookId(books[0].id);
    } else if (
      selectedBookId &&
      !books.some((book) => book.id === selectedBookId)
    ) {
      const fallback = books[0]?.id ?? null;
      setSelectedBookId(fallback);
      if (fallback) {
        loadAnnotations(fallback);
      } else {
        setOrganized(null);
      }
    }
  }, [books, selectedBookId, loadAnnotations]);

  useEffect(() => {
    if (selectedBookId) {
      loadAnnotations(selectedBookId);
    } else {
      setOrganized(null);
    }
  }, [selectedBookId, loadAnnotations]);

  const handleSelectBook = useCallback((bookId: string) => {
    setSelectedBookId(bookId);
  }, []);

  const handleEditBook = useCallback(async () => {
    if (!selectedBook) return;
    const newTitle = window.prompt("更新书名", selectedBook.title);
    if (!newTitle) return;
    const newAuthor = window.prompt("更新作者", selectedBook.author || "未知作者");

    await storageManager.updateBookMetadata(selectedBook.id, {
      title: newTitle.trim(),
      author: newAuthor?.trim() || "未知作者",
    });
    await onRefresh();
    setMessage("书籍信息已更新。");
  }, [selectedBook, storageManager, onRefresh]);

  const handleDeleteBook = useCallback(async () => {
    if (!selectedBook) return;
    const confirmed = window.confirm(
      `确定要删除《${selectedBook.title}》及其所有标注吗？此操作不可恢复。`
    );
    if (!confirmed) return;
    await storageManager.deleteBook(selectedBook.id);
    await onRefresh();
    setSelectedBookId(null);
    setOrganized(null);
    setMessage("书籍已删除。");
  }, [selectedBook, storageManager, onRefresh]);

  const parseWeReadText = useCallback((content: string) => {
    const lines = content.split(/\r?\n/).map((line) => line.trim());
    const highlights: Array<{ chapter?: string; content: string; id: string }> = [];
    let currentChapter: string | undefined;
    lines.forEach((line, index) => {
      if (!line) return;
      if (line.startsWith("#")) {
        currentChapter = line.replace(/^#+\s*/, "").trim();
      } else {
        highlights.push({
          id: `manual-${Date.now()}-${index}`,
          chapter: currentChapter,
          content: line.replace(/^[-*>\s◆]+/, "").trim(),
        });
      }
    });
    return highlights;
  }, []);

  const saveExternalAnnotations = useCallback(
    async (
      book: BookMetadata,
      highlights: ExternalAnnotation[],
      notes: ExternalAnnotation[] = []
    ): Promise<ImportResult> => {
      const storedHighlights = highlights
        .map((item, index) => buildExternalHighlight(item, book, index))
        .filter((item): item is StoredHighlight => item !== null);
      const storedNotes = notes
        .map((item, index) => buildExternalNote(item, book, index))
        .filter((item): item is BookNote => item !== null);

      await Promise.all([
        ...storedHighlights.map((highlight) => storageManager.saveHighlight(highlight)),
        ...storedNotes.map((note) => storageManager.saveNote(note)),
      ]);

      return {
        addedHighlights: storedHighlights.length,
        addedNotes: storedNotes.length,
      };
    },
    [storageManager]
  );

  const importWeReadData = useCallback(
    async (file: File, book: BookMetadata): Promise<ImportResult> => {
      const text = await file.text();
      try {
        const parsed = JSON.parse(text) as
          | ExternalAnnotation[]
          | {
          highlights?: ExternalAnnotation[];
          notes?: ExternalAnnotation[];
          marks?: ExternalAnnotation[];
          reviews?: ExternalAnnotation[];
        };

        if (Array.isArray(parsed)) {
          return await saveExternalAnnotations(book, parsed, []);
        }

        return await saveExternalAnnotations(
          book,
          [...(parsed.highlights ?? []), ...(parsed.marks ?? [])],
          [...(parsed.notes ?? []), ...(parsed.reviews ?? [])]
        );
      } catch {
        return await saveExternalAnnotations(book, parseWeReadText(text), []);
      }
    },
    [parseWeReadText, saveExternalAnnotations]
  );

  const handleImportWeRead = useCallback(async () => {
    if (!selectedBook) return;
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  }, [selectedBook]);

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !selectedBook) return;

      setImporting(true);
      setError(null);
      try {
        const result = await importWeReadData(file, selectedBook);
        await onRefresh();
        if (selectedBookId) {
          await loadAnnotations(selectedBookId);
        }
        setMessage(
          `已从微信读书导入 ${result.addedHighlights} 条划线、${result.addedNotes} 条笔记。`
        );
      } catch (err) {
        console.error("Failed to import WeRead data:", err);
        setError("导入微信读书数据失败，请确认文件格式。");
      } finally {
        setImporting(false);
      }
    },
    [selectedBook, selectedBookId, importWeReadData, loadAnnotations, onRefresh]
  );

  const mcpAnnotationPayload = useMemo<MCPBookNote[]>(() => {
    if (!organized || !selectedBook) {
      return [];
    }

    const items = new Map<string, MCPBookNote>();
    organized.bySource.forEach((bucket) => {
      bucket.highlights.forEach((highlight) => {
        const content = highlight.text.trim();
        if (!content) return;
        items.set(`highlight-${highlight.id}`, {
          id: highlight.id,
          bookId: selectedBook.id,
          content,
          chapter: highlight.chapterTitle || highlight.chapterId,
          createdAt: highlight.createdAt,
          updatedAt: highlight.updatedAt,
          tags: highlight.tags ?? [],
        });
      });

      bucket.notes.forEach((note) => {
        const content = note.content.trim();
        if (!content) return;
        items.set(`note-${note.id}`, {
          id: note.id,
          bookId: selectedBook.id,
          content,
          chapter: note.chapter,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          tags: note.tags,
        });
      });
    });

    return Array.from(items.values());
  }, [organized, selectedBook]);

  const mcpAnnotationById = useMemo(
    () => new Map(mcpAnnotationPayload.map((note) => [note.id, note])),
    [mcpAnnotationPayload]
  );

  const handleSearchWeReadBooks = useCallback(async () => {
    if (!selectedBook) return;
    const query = (mcpQuery || selectedBook.title).trim();
    if (!query) return;

    setMcpLoading(true);
    setError(null);
    setMessage(null);
    try {
      const options = { serverPath: mcpServerPath.trim() || undefined };
      let results = await mcpApiClient.searchBooks(query, options);
      if (results.length === 0) {
        const bookshelf = await mcpApiClient.getBookshelf(options);
        const lowerQuery = query.toLowerCase();
        results = bookshelf.filter((book) =>
          `${book.title} ${book.author}`.toLowerCase().includes(lowerQuery)
        );
      }
      setMcpBooks(results);
      setSelectedMcpBookId(results[0]?.id ?? "");
      setMessage(
        results.length > 0
          ? `找到 ${results.length} 本微信读书候选书籍。`
          : "未找到匹配的微信读书书籍。"
      );
    } catch (err) {
      console.error("Failed to search WeRead books:", err);
      setError("搜索微信读书失败，请确认后端已启动且 MCP 服务路径可用。");
    } finally {
      setMcpLoading(false);
    }
  }, [selectedBook, mcpQuery, mcpServerPath]);

  const handleSyncWeReadHighlights = useCallback(async () => {
    if (!selectedBook || !selectedMcpBookId) return;
    const matchedBook = mcpBooks.find((book) => book.id === selectedMcpBookId);

    setMcpSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const notes = await mcpApiClient.getBookNotes(selectedMcpBookId, {
        serverPath: mcpServerPath.trim() || undefined,
      });
      const result = await saveExternalAnnotations(
        selectedBook,
        notes.map((note: MCPBookNote) => ({
          ...note,
          chapter: note.chapter || matchedBook?.title,
          tags: note.tags ?? [],
        })),
        []
      );
      await onRefresh();
      if (selectedBookId) {
        await loadAnnotations(selectedBookId);
      }
      setMessage(
        `已同步微信读书《${matchedBook?.title || selectedMcpBookId}》的 ${result.addedHighlights} 条划线。`
      );
    } catch (err) {
      console.error("Failed to sync WeRead highlights:", err);
      setError("同步微信读书划线失败，请检查 MCP 服务和书籍选择。");
    } finally {
      setMcpSyncing(false);
    }
  }, [
    selectedBook,
    selectedBookId,
    selectedMcpBookId,
    mcpBooks,
    mcpServerPath,
    saveExternalAnnotations,
    onRefresh,
    loadAnnotations,
  ]);

  const handleSyncLocalNotesToMcp = useCallback(async () => {
    if (mcpAnnotationPayload.length === 0) {
      setError("当前书籍还没有可同步的划线或笔记。");
      return;
    }

    setMcpInsightLoading("sync");
    setError(null);
    setMessage(null);
    try {
      const result = await mcpApiClient.syncNotes(mcpAnnotationPayload, {
        serverPath: mcpServerPath.trim() || undefined,
      });
      setMcpInsight({
        title: "本地标注同步结果",
        body: formatMcpResult(result) || `已提交 ${mcpAnnotationPayload.length} 条本地标注。`,
        generatedAt: Date.now(),
      });
    } catch (err) {
      console.error("Failed to sync local notes to MCP:", err);
      setError("同步本地标注到 MCP 失败，请检查 MCP 服务路径和 sync_notes 工具。");
    } finally {
      setMcpInsightLoading(null);
    }
  }, [mcpAnnotationPayload, mcpServerPath]);

  const handleAnalyzeLocalAnnotations = useCallback(async () => {
    if (mcpAnnotationPayload.length === 0) {
      setError("当前书籍还没有可分析的划线或笔记。");
      return;
    }

    setMcpInsightLoading("analysis");
    setError(null);
    setMessage(null);
    try {
      const result = await mcpApiClient.analyzeReading(mcpAnnotationPayload, {
        serverPath: mcpServerPath.trim() || undefined,
      });
      setMcpInsight({
        title: "阅读分析",
        body: formatMcpResult(result),
        generatedAt: Date.now(),
      });
    } catch (err) {
      console.error("Failed to analyze local annotations:", err);
      setError("生成阅读分析失败，请检查 MCP 服务路径和 analyze_reading 工具。");
    } finally {
      setMcpInsightLoading(null);
    }
  }, [mcpAnnotationPayload, mcpServerPath]);

  const handleClassifyLocalAnnotations = useCallback(async () => {
    if (mcpAnnotationPayload.length === 0) {
      setError("当前书籍还没有可分类的划线或笔记。");
      return;
    }

    setMcpInsightLoading("classify");
    setError(null);
    setMessage(null);
    try {
      const result = await mcpApiClient.classifyNotes(mcpAnnotationPayload, {
        serverPath: mcpServerPath.trim() || undefined,
      });
      setMcpInsight({
        title: "笔记分类",
        body: formatMcpResult(result),
        generatedAt: Date.now(),
      });
    } catch (err) {
      console.error("Failed to classify local annotations:", err);
      setError("分类笔记失败，请检查 MCP 服务路径和 classify_notes 工具。");
    } finally {
      setMcpInsightLoading(null);
    }
  }, [mcpAnnotationPayload, mcpServerPath]);

  const handleBuildKnowledgeConnections = useCallback(() => {
    if (mcpAnnotationPayload.length < 2) {
      setError("至少需要两条划线或笔记才能建立知识关联。");
      return;
    }

    const connections = buildKnowledgeConnections(mcpAnnotationPayload);
    setError(null);
    setMcpInsight({
      title: "知识关联",
      body:
        connections.length > 0
          ? undefined
          : "暂未发现明显关联。可以先同步更多微信读书划线或补充本地笔记。",
      connections,
      generatedAt: Date.now(),
    });
  }, [mcpAnnotationPayload]);

  const handleLibrarySearch = useCallback(async () => {
    const query = librarySearchQuery.trim();
    if (!query) {
      setLibrarySearchResults([]);
      return;
    }

    setLibrarySearchLoading(true);
    setError(null);
    try {
      const results = await storageManager.searchLibrary(query, {
        scope: librarySearchScope,
        limit: 80,
      });
      setLibrarySearchResults(results);
      setMessage(results.length > 0 ? `找到 ${results.length} 条结果。` : "没有找到匹配结果。");
    } catch (err) {
      console.error("Failed to search library:", err);
      setError("全库搜索失败，请稍后重试。");
    } finally {
      setLibrarySearchLoading(false);
    }
  }, [librarySearchQuery, librarySearchScope, storageManager]);

  const handleOpenSearchResult = useCallback(
    (result: LibrarySearchResult) => {
      const book = books.find((item) => item.id === result.bookId);
      if (!book) return;
      setSelectedBookId(book.id);
      if (result.type === "chapter" || result.chapterId) {
        onOpenBook(book, {
          chapterId: result.chapterId,
        });
      }
    },
    [books, onOpenBook]
  );

  const handleBuildCrossBookGraph = useCallback(async () => {
    setKnowledgeLoading(true);
    setError(null);
    try {
      const graph = await storageManager.buildKnowledgeGraph({ limit: 96 });
      setKnowledgeGraph(graph);
      setMessage(
        graph.nodes.length > 0
          ? `已生成 ${graph.themes.length} 个主题、${graph.edges.length} 条关联。`
          : "还没有足够的划线或笔记生成知识图谱。"
      );
    } catch (err) {
      console.error("Failed to build knowledge graph:", err);
      setError("生成知识图谱失败，请确认已有本地或微信读书标注。");
    } finally {
      setKnowledgeLoading(false);
    }
  }, [storageManager]);

  const handleExportKnowledgeMindMap = useCallback(
    async (scope: "all" | "book") => {
      setKnowledgeLoading(true);
      setError(null);
      try {
        const content = await storageManager.exportKnowledgeGraphMindMap(
          scope === "book" ? selectedBookId ?? undefined : undefined
        );
        downloadTextFile(
          content,
          scope === "book" && selectedBook
            ? `${selectedBook.title}-知识图谱思维导图.json`
            : "跨书知识图谱思维导图.json"
        );
        setMessage("知识图谱思维导图已导出。");
      } catch (err) {
        console.error("Failed to export knowledge mind map:", err);
        setError("导出知识图谱思维导图失败。");
      } finally {
        setKnowledgeLoading(false);
      }
    },
    [selectedBook, selectedBookId, storageManager]
  );

  const highlightCount = useMemo(() => {
    if (!organized) return 0;
    const uniqueHighlightIds = new Set<string>();
    organized.byTag.forEach((bucket) =>
      bucket.highlights.forEach((highlight) => {
        uniqueHighlightIds.add(highlight.id);
      })
    );
    return uniqueHighlightIds.size;
  }, [organized]);

  const noteCount = useMemo(() => {
    if (!organized) return 0;
    const uniqueNoteIds = new Set<string>();
    organized.byTag.forEach((bucket) =>
      bucket.notes.forEach((note) => {
        uniqueNoteIds.add(note.id);
      })
    );
    return uniqueNoteIds.size;
  }, [organized]);

  const sourceCounts = useMemo(() => {
    const counts = { local: 0, wechat: 0 };
    if (!organized) return counts;

    organized.bySource.forEach((bucket) => {
      const uniqueHighlightIds = new Set(bucket.highlights.map((highlight) => highlight.id));
      if (bucket.key === "wechat") {
        counts.wechat += uniqueHighlightIds.size;
      } else if (bucket.key === "local") {
        counts.local += uniqueHighlightIds.size;
      }
    });

    return counts;
  }, [organized]);

  const graphThemeNodes = useMemo(
    () => knowledgeGraph?.nodes.filter((node) => node.type === "theme") ?? [],
    [knowledgeGraph]
  );

  const graphAnnotationNodes = useMemo(
    () => knowledgeGraph?.nodes.filter((node) => node.type === "annotation") ?? [],
    [knowledgeGraph]
  );

  return (
    <div className="library-container">
      <header className="library-header">
        <div>
          <h1>图书馆</h1>
          <p>管理已阅读的 EPUB 书籍、划线与笔记。</p>
        </div>
        <div className="library-actions">
          <button
            type="button"
            onClick={() => setShowTagCenter(true)}
            className="ghost-button"
            title="跨全部图书按标签整理"
          >
            标签中心
          </button>
          <button
            type="button"
            className="ghost-button danger"
            onClick={async () => {
              if (window.confirm("确定要重置所有本地数据吗？此操作不可恢复。")) {
                await storageManager.clearAll();
                await onRefresh();
                setSelectedBookId(null);
                setOrganized(null);
                setMessage("已重置所有数据。");
              }
            }}
          >
            重置所有数据
          </button>
          <button type="button" onClick={onBack} className="ghost-button">
            返回主页
          </button>
        </div>
      </header>

      <div className="library-layout">
        <aside className="library-sidebar">
          <div className="sidebar-search">
            <input
              type="search"
              placeholder="搜索书名或作者"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <ul className="sidebar-list">
            {filteredBooks.length === 0 && (
              <li className="sidebar-empty">暂无匹配的图书</li>
            )}
            {filteredBooks.map((book) => (
              <li
                key={book.id}
                className={[
                  "sidebar-item",
                  book.id === selectedBookId ? "active" : "",
                  book.id === activeBookId ? "reading" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => handleSelectBook(book.id)}
              >
                <div className="item-title">{book.title}</div>
                <div className="item-meta">
                  <span>{book.author || "未知作者"}</span>
                  <span>{(book.progress * 100).toFixed(1)}%</span>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <main className="library-main">
          {!selectedBook ? (
            <div className="library-empty-state">
              <h2>请选择一本书籍</h2>
              <p>从左侧列表中选择书籍，即可查看划线、笔记与分类。</p>
            </div>
          ) : (
            <>
              <section className="book-summary">
                {selectedBook.cover && (
                  <img
                    src={selectedBook.cover}
                    alt=""
                    className="book-cover"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <h2>{selectedBook.title}</h2>
                  <p className="book-author">{selectedBook.author || "未知作者"}</p>
                  <p className="book-meta">
                    最近阅读：
                    {selectedBook.lastReadAt
                      ? new Date(selectedBook.lastReadAt).toLocaleString("zh-CN")
                      : "未知"}
                    {" · "}
                    阅读进度：{(selectedBook.progress * 100).toFixed(1)}%
                  </p>
                  {selectedBook.tags && selectedBook.tags.length > 0 && (
                    <div className="book-tags">
                      {selectedBook.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="book-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onOpenBook(selectedBook)}
                  >
                    继续阅读
                  </button>
                  <button type="button" onClick={handleEditBook}>
                    编辑信息
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={handleDeleteBook}
                  >
                    删除书籍
                  </button>
                </div>
              </section>

              <section className="annotation-summary">
                <div className="summary-card">
                  <h3>划线</h3>
                  <p className="summary-number">{highlightCount}</p>
                  <p className="summary-desc">同步含微信读书数据</p>
                </div>
                <div className="summary-card">
                  <h3>笔记</h3>
                  <p className="summary-number">{noteCount}</p>
                  <p className="summary-desc">可按标签、章节自动聚合</p>
                </div>
                <div className="summary-card">
                  <h3>来源</h3>
                  <p className="summary-number">
                    {organized
                      ? organized.bySource.filter(
                          (bucket) => bucket.highlights.length + bucket.notes.length > 0
                        ).length
                      : 0}
                  </p>
                  <p className="summary-desc">本地划线 & 微信读书</p>
                </div>
                <div className="summary-card">
                  <h3>本地 / 微信划线</h3>
                  <p className="summary-number">
                    {sourceCounts.local} / {sourceCounts.wechat}
                  </p>
                  <p className="summary-desc">统一进入标签、章节和来源整理</p>
                </div>
                <div className="summary-card">
                  <h3>导入微信读书</h3>
                  <button
                    type="button"
                    className="import-button"
                    onClick={handleImportWeRead}
                    disabled={importing}
                  >
                    {importing ? "导入中..." : "导入 JSON / TXT"}
                  </button>
                </div>
              </section>

              <section className="library-search-panel">
                <div className="library-search-header">
                  <div>
                    <h3>全库搜索</h3>
                    <p>书名、全书正文、划线和笔记可统一检索。</p>
                  </div>
                  <span>{librarySearchResults.length} 条结果</span>
                </div>
                <div className="library-search-controls">
                  <input
                    type="search"
                    value={librarySearchQuery}
                    placeholder="搜索全库内容"
                    aria-label="搜索全库内容"
                    onChange={(e) => setLibrarySearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleLibrarySearch();
                      }
                    }}
                  />
                  <select
                    value={librarySearchScope}
                    onChange={(e) => setLibrarySearchScope(e.target.value as LibrarySearchScope)}
                    aria-label="选择搜索范围"
                  >
                    <option value="all">全部</option>
                    <option value="fullText">只搜正文</option>
                    <option value="annotations">只搜划线/笔记</option>
                    <option value="books">只搜书籍</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleLibrarySearch}
                    disabled={librarySearchLoading || !librarySearchQuery.trim()}
                  >
                    {librarySearchLoading ? "检索中..." : "搜索"}
                  </button>
                </div>
                {librarySearchResults.length > 0 && (
                  <ul className="library-search-results">
                    {librarySearchResults.map((result) => (
                      <li key={result.id}>
                        <button type="button" onClick={() => handleOpenSearchResult(result)}>
                          <strong>
                            {result.type === "book"
                              ? result.bookTitle
                              : `${result.bookTitle} · ${result.title}`}
                          </strong>
                          <span>
                            {result.type === "highlight"
                              ? "划线"
                              : result.type === "note"
                              ? "笔记"
                              : result.type === "chapter"
                              ? "正文"
                              : "书籍"}
                            {result.chapterTitle ? ` · ${result.chapterTitle}` : ""}
                            {result.source === "wechat" ? " · 微信读书" : ""}
                          </span>
                          <em>{result.snippet}</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="knowledge-graph-panel">
                <div className="knowledge-graph-header">
                  <div>
                    <h3>跨书知识图谱</h3>
                    <p>按主题把不同书中的划线和笔记聚成可导出的思维导图。</p>
                  </div>
                  <span>
                    {knowledgeGraph
                      ? `${knowledgeGraph.nodes.length} 节点 · ${knowledgeGraph.edges.length} 关联`
                      : "尚未生成"}
                  </span>
                </div>
                <div className="knowledge-graph-actions">
                  <button
                    type="button"
                    onClick={handleBuildCrossBookGraph}
                    disabled={knowledgeLoading}
                  >
                    {knowledgeLoading ? "生成中..." : "生成图谱"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportKnowledgeMindMap("all")}
                    disabled={knowledgeLoading}
                  >
                    导出跨书思维导图
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportKnowledgeMindMap("book")}
                    disabled={knowledgeLoading || !selectedBookId}
                  >
                    导出本书思维导图
                  </button>
                </div>
                {knowledgeGraph && (
                  <div className="knowledge-graph-preview">
                    <div className="knowledge-node-cloud" aria-label="知识主题">
                      {graphThemeNodes.slice(0, 18).map((node) => (
                        <span key={node.id}>
                          {node.label}
                          <small>{node.weight}</small>
                        </span>
                      ))}
                    </div>
                    {graphAnnotationNodes.length > 0 && (
                      <ul className="knowledge-annotation-list">
                        {graphAnnotationNodes.slice(0, 8).map((node) => (
                          <li key={node.id}>
                            <strong>{node.bookTitle}</strong>
                            <span>{node.source === "wechat" ? "微信读书" : "本地"}</span>
                            <p>{node.snippet}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              <section className="weread-sync-panel">
                <div className="weread-sync-header">
                  <div>
                    <h3>微信读书 MCP 同步</h3>
                    <p>
                      {mcpBooks.length > 0
                        ? `${mcpBooks.length} 本候选`
                        : "等待匹配微信读书书籍"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="import-button"
                    onClick={handleSearchWeReadBooks}
                    disabled={mcpLoading}
                  >
                    {mcpLoading ? "搜索中..." : "搜索微信读书"}
                  </button>
                </div>
                <div className="weread-sync-controls">
                  <input
                    type="text"
                    value={mcpServerPath}
                    onChange={(e) => setMcpServerPath(e.target.value)}
                    placeholder="MCP 服务命令，留空使用 mcp-server"
                    aria-label="MCP 服务命令"
                  />
                  <input
                    type="text"
                    value={mcpQuery}
                    onChange={(e) => setMcpQuery(e.target.value)}
                    placeholder="微信读书搜索关键词"
                    aria-label="微信读书搜索关键词"
                  />
                </div>
                {mcpBooks.length > 0 && (
                  <div className="weread-result-row">
                    <select
                      value={selectedMcpBookId}
                      onChange={(e) => setSelectedMcpBookId(e.target.value)}
                      aria-label="选择微信读书书籍"
                    >
                      {mcpBooks.map((book) => (
                        <option key={book.id} value={book.id}>
                          {book.title}
                          {book.author ? ` · ${book.author}` : ""}
                          {typeof book.notesCount === "number" ? ` · ${book.notesCount} 条` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleSyncWeReadHighlights}
                      disabled={mcpSyncing || !selectedMcpBookId}
                    >
                      {mcpSyncing ? "同步中..." : "同步划线"}
                    </button>
                  </div>
                )}
              </section>

              <section className="mcp-insight-panel">
                <div className="mcp-insight-header">
                  <div>
                    <h3>MCP 阅读整理</h3>
                    <p>
                      本地 {sourceCounts.local} 条 · 微信 {sourceCounts.wechat} 条
                    </p>
                  </div>
                  <span>{mcpAnnotationPayload.length} 条标注</span>
                </div>
                <div className="mcp-insight-actions">
                  <button
                    type="button"
                    onClick={handleSyncLocalNotesToMcp}
                    disabled={mcpInsightLoading !== null || mcpAnnotationPayload.length === 0}
                  >
                    {mcpInsightLoading === "sync" ? "同步中..." : "同步本地标注"}
                  </button>
                  <button
                    type="button"
                    onClick={handleAnalyzeLocalAnnotations}
                    disabled={mcpInsightLoading !== null || mcpAnnotationPayload.length === 0}
                  >
                    {mcpInsightLoading === "analysis" ? "分析中..." : "阅读分析"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClassifyLocalAnnotations}
                    disabled={mcpInsightLoading !== null || mcpAnnotationPayload.length === 0}
                  >
                    {mcpInsightLoading === "classify" ? "分类中..." : "笔记分类"}
                  </button>
                  <button
                    type="button"
                    onClick={handleBuildKnowledgeConnections}
                    disabled={mcpInsightLoading !== null || mcpAnnotationPayload.length < 2}
                  >
                    知识关联
                  </button>
                </div>
                {mcpInsight && (
                  <div className="mcp-insight-result">
                    <div className="mcp-insight-result-header">
                      <strong>{mcpInsight.title}</strong>
                      <span>
                        {new Date(mcpInsight.generatedAt).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {mcpInsight.body && <pre>{mcpInsight.body}</pre>}
                    {mcpInsight.connections && mcpInsight.connections.length > 0 && (
                      <ul className="knowledge-list">
                        {mcpInsight.connections.map((connection) => {
                          const source = mcpAnnotationById.get(connection.source);
                          const target = mcpAnnotationById.get(connection.target);
                          return (
                            <li key={`${connection.source}-${connection.target}`}>
                              <span>{source?.content.slice(0, 36) || connection.source}</span>
                              <strong>{Math.round(connection.weight * 100)}%</strong>
                              <span>{target?.content.slice(0, 36) || connection.target}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              {message && (
                <div className="library-message" role="status">
                  {message}
                  <button
                    type="button"
                    onClick={() => setMessage(null)}
                    aria-label="关闭提示"
                  >
                    ×
                  </button>
                </div>
              )}
              {error && (
                <div className="library-error" role="alert">
                  {error}
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    aria-label="关闭错误提示"
                  >
                    ×
                  </button>
                </div>
              )}

              <section className="annotation-section">
                <h3>按标签分类</h3>
                {loadingBuckets ? (
                  <div className="section-loading">正在整理标签...</div>
                ) : organized && organized.byTag.length > 0 ? (
                  <div className="bucket-grid">
                    {organized.byTag.map((bucket) => (
                      <div key={bucket.key} className="bucket-card">
                        <div className="bucket-header">
                          <h4>{bucket.title}</h4>
                          <span>
                            {bucket.highlights.length} 划线 · {bucket.notes.length} 笔记
                          </span>
                        </div>
                        {renderBucketPreview(bucket, "highlights")}
                        {renderBucketPreview(bucket, "notes")}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="section-empty">暂无标签分类数据。</p>
                )}
              </section>

              <section className="annotation-section">
                <h3>按章节整理</h3>
                {loadingBuckets ? (
                  <div className="section-loading">正在整理章节...</div>
                ) : organized && organized.byChapter.length > 0 ? (
                  <div className="bucket-grid">
                    {organized.byChapter.map((bucket) => (
                      <div key={bucket.key} className="bucket-card">
                        <div className="bucket-header">
                          <h4>{bucket.title}</h4>
                          <span>
                            {bucket.highlights.length} 划线 · {bucket.notes.length} 笔记
                          </span>
                        </div>
                        {renderBucketPreview(bucket, "highlights")}
                        {renderBucketPreview(bucket, "notes")}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="section-empty">暂无章节分类数据。</p>
                )}
              </section>

              <section className="annotation-section">
                <h3>按来源整理</h3>
                {loadingBuckets ? (
                  <div className="section-loading">正在整理来源...</div>
                ) : organized && organized.bySource.length > 0 ? (
                  <div className="bucket-grid">
                    {organized.bySource.map((bucket) => (
                      <div key={bucket.key} className="bucket-card">
                        <div className="bucket-header">
                          <h4>
                            {bucket.title === "wechat"
                              ? "微信读书"
                              : bucket.title === "local"
                              ? "本地标注"
                              : bucket.title}
                          </h4>
                          <span>
                            {bucket.highlights.length} 划线 · {bucket.notes.length} 笔记
                          </span>
                        </div>
                        {renderBucketPreview(bucket, "highlights")}
                        {renderBucketPreview(bucket, "notes")}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="section-empty">暂无来源分类数据。</p>
                )}
              </section>
            </>
          )}
        </main>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept=".json,.txt,.md"
        className="hidden-file-input"
        onChange={handleFileSelected}
      aria-label="导入微信读书文件"
      />

      {showTagCenter && (
        <Suspense fallback={null}>
          <TagCenter
            storageManager={storageManager}
            onClose={() => setShowTagCenter(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default LibraryView;
