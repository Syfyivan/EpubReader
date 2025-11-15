import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnnotationBucket,
  BookMetadata,
  BookNote,
  OrganizedAnnotations,
  StoredHighlight,
} from "../storage/StorageManager";
import type { StorageManager } from "../storage/StorageManager";
import "./LibraryView.css";
import TagCenter from "./TagCenter";

interface LibraryViewProps {
  books: BookMetadata[];
  storageManager: StorageManager;
  onOpenBook: (book: BookMetadata) => void;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  activeBookId?: string;
}

interface ImportResult {
  addedNotes: number;
  addedHighlights: number;
}

const GROUP_PREVIEW_LIMIT = 3;

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId]
  );

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

  const parseWeReadText = (content: string) => {
    const lines = content.split(/\r?\n/).map((line) => line.trim());
    const notes: Array<{ chapter?: string; content: string }> = [];
    let currentChapter: string | undefined;
    lines.forEach((line) => {
      if (!line) return;
      if (line.startsWith("#")) {
        currentChapter = line.replace(/^#+\s*/, "").trim();
      } else {
        notes.push({ chapter: currentChapter, content: line });
      }
    });
    return notes;
  };

  const importWeReadData = async (
    file: File,
    book: BookMetadata
  ): Promise<ImportResult> => {
    const text = await file.text();
    try {
      const parsed = JSON.parse(text) as {
        highlights?: Array<{
          id: string;
          content: string;
          chapter?: string;
          createdAt?: number;
          tags?: string[];
        }>;
        notes?: Array<{
          id: string;
          content: string;
          chapter?: string;
          createdAt?: number;
          tags?: string[];
        }>;
      };

      const highlightList = parsed.highlights ?? [];
      const noteList = parsed.notes ?? [];

      const mergedNotes = [
        ...highlightList.map((item) => ({
          id: `wechat-highlight-${item.id}`,
          content: item.content,
          chapter: item.chapter,
          createdAt: item.createdAt,
          tags: Array.isArray(item.tags)
            ? [...item.tags, "微信读书", "划线"]
            : ["微信读书", "划线"],
        })),
        ...noteList.map((item) => ({
          id: `wechat-note-${item.id}`,
          content: item.content,
          chapter: item.chapter,
          createdAt: item.createdAt,
          tags: Array.isArray(item.tags)
            ? [...item.tags, "微信读书"]
            : ["微信读书"],
        })),
      ];

      await Promise.all(
        mergedNotes.map((item) =>
          storageManager.saveNote({
            id: item.id,
            bookId: book.id,
            title: item.chapter ?? book.title,
            content: item.content,
            chapter: item.chapter,
            tags: item.tags,
            createdAt: item.createdAt ?? Date.now(),
            updatedAt: item.createdAt ?? Date.now(),
            source: "wechat",
          })
        )
      );

      return {
        addedHighlights: highlightList.length,
        addedNotes: mergedNotes.length,
      };
    } catch {
      const notes = parseWeReadText(text);
      await Promise.all(
        notes.map((item, index) =>
          storageManager.saveNote({
            id: `wechat-manual-${Date.now()}-${index}`,
            bookId: book.id,
            title: item.chapter ?? book.title,
            content: item.content,
            chapter: item.chapter,
            tags: ["微信读书"],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: "wechat",
          })
        )
      );
      return {
        addedHighlights: 0,
        addedNotes: notes.length,
      };
    }
  };

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
    [selectedBook, selectedBookId, loadAnnotations, onRefresh]
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
        <TagCenter
          storageManager={storageManager}
          onClose={() => setShowTagCenter(false)}
        />
      )}
    </div>
  );
};

export default LibraryView;
