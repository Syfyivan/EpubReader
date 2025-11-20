import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  StorageManager,
  OrganizedAnnotations,
  StoredHighlight,
  BookNote,
  AnnotationBucket,
} from "../storage/StorageManager";
import "./TagCenter.css";

type NoteWithMeta = BookNote & {
  highlightId?: string;
  metadata?: {
    highlightId?: string;
  };
};

type TagSummary = {
  highlightNotesMap: Map<string, BookNote[]>;
  orphanNotes: BookNote[];
};

const extractHighlightId = (note: NoteWithMeta): string | null => {
  if (note.id.includes("::")) {
    return note.id.split("::")[0];
  }
  if (typeof note.highlightId === "string" && note.highlightId.length > 0) {
    return note.highlightId;
  }
  if (
    note.metadata &&
    typeof note.metadata.highlightId === "string" &&
    note.metadata.highlightId.length > 0
  ) {
    return note.metadata.highlightId;
  }
  return null;
};

const summarizeBucketNotes = (bucket: AnnotationBucket): TagSummary => {
  const highlightNotesMap = new Map<string, BookNote[]>();
  const orphanNotes: BookNote[] = [];

  (bucket.notes || []).forEach((note) => {
    const highlightId = extractHighlightId(note as NoteWithMeta);
    if (highlightId) {
      if (!highlightNotesMap.has(highlightId)) {
        highlightNotesMap.set(highlightId, []);
      }
      highlightNotesMap.get(highlightId)!.push(note);
    } else {
      orphanNotes.push(note);
    }
  });

  return { highlightNotesMap, orphanNotes };
};

interface TagCenterProps {
  storageManager: StorageManager;
  onClose: () => void;
}

export default function TagCenter({ storageManager, onClose }: TagCenterProps) {
  const [data, setData] = useState<OrganizedAnnotations | null>(null);
  const [activeTag, setActiveTag] = useState<string>("");
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "csv" | "markdown" | "mindmap">("json");
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewMode, setPreviewMode] = useState<"markdown" | "mindmap" | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await storageManager.init?.();
        const d = await storageManager.getOrganizedAnnotationsAll();
        setData(d);
        if (d.byTag.length > 0) setActiveTag(d.byTag[0].key);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [storageManager]);

  const activeBucket = useMemo(() => {
    if (!data) return null;
    return data.byTag.find(b => b.key === activeTag) || null;
  }, [data, activeTag]);

  const tagSummaryMap = useMemo(() => {
    const map = new Map<string, TagSummary>();
    if (!data) return map;
    data.byTag.forEach((bucket) => {
      map.set(bucket.key, summarizeBucketNotes(bucket));
    });
    return map;
  }, [data]);

  const activeSummary = activeBucket ? tagSummaryMap.get(activeBucket.key) || null : null;

  const flattenRecords = useCallback(() => {
    if (!data) return [];
    const rows: Array<{
      tag: string;
      type: "highlight" | "highlight-note" | "note";
      highlightId: string;
      highlightText: string;
      noteId: string;
      noteContent: string;
      noteTags: string;
      chapter: string;
      bookId: string;
      source?: string;
      createdAt?: number;
      updatedAt?: number;
    }> = [];

    data.byTag.forEach(bucket => {
      const summary = tagSummaryMap.get(bucket.key);
      const noteMap = summary?.highlightNotesMap ?? new Map<string, BookNote[]>();
      bucket.highlights.forEach(hl => {
        const linkedNotes = noteMap.get(hl.id) || [];
        if (linkedNotes.length === 0) {
          rows.push({
            tag: bucket.title,
            type: "highlight",
            highlightId: hl.id,
            highlightText: hl.text || "",
            noteId: "",
            noteContent: "",
            noteTags: "",
            chapter: hl.chapterTitle || hl.chapterId || "",
            bookId: hl.bookId,
            source: hl.source,
            createdAt: hl.createdAt,
            updatedAt: hl.updatedAt,
          });
          return;
        }

        linkedNotes.forEach(note => {
          rows.push({
            tag: bucket.title,
            type: "highlight-note",
            highlightId: hl.id,
            highlightText: hl.text || "",
            noteId: note.id,
            noteContent: note.content || "",
            noteTags: (note.tags || []).join("|"),
            chapter: hl.chapterTitle || hl.chapterId || "",
            bookId: hl.bookId,
            source: note.source || hl.source,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          });
        });
      });

      if (summary?.orphanNotes.length) {
        summary.orphanNotes.forEach(note => {
          rows.push({
            tag: bucket.title,
            type: "note",
            highlightId: "",
            highlightText: "",
            noteId: note.id,
            noteContent: note.content || "",
            noteTags: (note.tags || []).join("|"),
            chapter: note.chapter || "",
            bookId: note.bookId,
            source: note.source,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          });
        });
      }
    });

    return rows;
  }, [data, tagSummaryMap]);

  const escapeCsv = (value: string | number | undefined | null) => {
    const str = value === undefined || value === null ? "" : String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const formatTimestamp = (ts?: number) => {
    if (!ts) return "";
    return new Date(ts).toISOString();
  };

  const downloadTextFile = (content: string, extension: string, mime: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `tag-center-${timestamp}.${extension}`;
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const buildMarkdown = useCallback(() => {
    if (!data) return "";
    const lines: string[] = [
      "# 标签中心导出",
      "",
      `> 导出时间：${new Date().toLocaleString()}`,
      "",
    ];

    data.byTag.forEach(bucket => {
      const summary = tagSummaryMap.get(bucket.key);
      const noteMap = summary?.highlightNotesMap ?? new Map<string, BookNote[]>();
      const orphanNotes = summary?.orphanNotes ?? [];

      lines.push(`## ${bucket.title}`);
      lines.push("");
      if (bucket.highlights.length === 0 && orphanNotes.length === 0) {
        lines.push("_该标签暂无记录_");
        lines.push("");
        return;
      }

      if (bucket.highlights.length > 0) {
        lines.push(`### 划线 (${bucket.highlights.length})`);
        bucket.highlights.forEach((hl, idx) => {
          lines.push(`${idx + 1}. **${hl.chapterTitle || hl.chapterId || "未知章节"}** — ${hl.text || ""}`);
          const linkedNotes = noteMap.get(hl.id) || [];
          if (linkedNotes.length === 0) {
            lines.push("   - （无同标签笔记）");
          } else {
            linkedNotes.forEach(note => {
              lines.push(`   - 笔记：${note.content || ""}`);
            });
          }
        });
        lines.push("");
      }

      if (orphanNotes.length > 0) {
        lines.push(`### 未关联笔记 (${orphanNotes.length})`);
        orphanNotes.forEach((note, idx) => {
          lines.push(`${idx + 1}. ${note.title || "未命名笔记"}`);
          lines.push("");
          lines.push(`   ${note.content || ""}`);
        });
        lines.push("");
      }
    });

    return lines.join("\n");
  }, [data, tagSummaryMap]);

  const escapeXml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const buildMindmap = useCallback(() => {
    if (!data) return "";
    const lines: string[] = ['<map version="1.0.1">', `  <node TEXT="标签中心">`];

    data.byTag.forEach(bucket => {
      const summary = tagSummaryMap.get(bucket.key);
      const noteMap = summary?.highlightNotesMap ?? new Map<string, BookNote[]>();
      const orphanNotes = summary?.orphanNotes ?? [];
      const totalCount = bucket.highlights.length + orphanNotes.length;
      lines.push(`    <node TEXT="${escapeXml(`${bucket.title} (${totalCount})`)}">`);
      bucket.highlights.forEach(hl => {
        const text = `${hl.chapterTitle || hl.chapterId || ""}：${hl.text || ""}`;
        lines.push(`      <node TEXT="${escapeXml(text)}">`);
        const linkedNotes = noteMap.get(hl.id) || [];
        linkedNotes.forEach(note => {
          const label = `${note.title || "笔记"}：${note.content || ""}`;
          lines.push(`        <node TEXT="${escapeXml(label)}" />`);
        });
        lines.push("      </node>");
      });
      if (orphanNotes.length > 0) {
        lines.push(`      <node TEXT="未关联笔记 (${orphanNotes.length})">`);
        orphanNotes.forEach(note => {
          const label = `${note.title || "未命名笔记"}：${note.content || ""}`;
          lines.push(`        <node TEXT="${escapeXml(label)}" />`);
        });
        lines.push("      </node>");
      }
      lines.push("    </node>");
    });

    lines.push("  </node>");
    lines.push("</map>");
    return lines.join("\n");
  }, [data, tagSummaryMap]);

  const handleExport = useCallback(() => {
    if (!data || data.byTag.length === 0) return;
    const rows = flattenRecords();

    if (exportFormat === "json") {
      const payload = {
        exportedAt: new Date().toISOString(),
        tagCount: data.byTag.length,
        recordCount: rows.length,
        tags: data.byTag.map(bucket => {
          const summary = tagSummaryMap.get(bucket.key);
          const noteMap = summary?.highlightNotesMap ?? new Map<string, BookNote[]>();
          return {
            tag: bucket.title,
            highlights: bucket.highlights.map(hl => ({
              ...hl,
              linkedNotes: noteMap.get(hl.id) || [],
            })),
            orphanNotes: summary?.orphanNotes ?? [],
          };
        }),
      };
      downloadTextFile(JSON.stringify(payload, null, 2), "json", "application/json");
      return;
    }

    if (exportFormat === "csv") {
      const headers = [
        "tag",
        "type",
        "highlightId",
        "highlightText",
        "noteId",
        "noteContent",
        "noteTags",
        "chapter",
        "bookId",
        "source",
        "createdAt",
        "updatedAt",
      ];
      const csv = [
        headers.join(","),
        ...rows.map(row =>
          headers
            .map(key => {
              if (key === "createdAt" || key === "updatedAt") {
                return escapeCsv(formatTimestamp(row[key as "createdAt" | "updatedAt"]));
              }
              return escapeCsv((row as Record<string, string | number | undefined>)[key]);
            })
            .join(",")
        ),
      ].join("\n");
      downloadTextFile(csv, "csv", "text/csv");
      return;
    }

    if (exportFormat === "markdown") {
      const markdown = buildMarkdown();
      downloadTextFile(markdown, "md", "text/markdown");
      return;
    }

    if (exportFormat === "mindmap") {
      const content = buildMindmap();
      downloadTextFile(content, "mm", "text/xml");
    }
  }, [data, exportFormat, flattenRecords, buildMarkdown, buildMindmap, tagSummaryMap]);

  const handlePreview = useCallback(() => {
    if (!data || data.byTag.length === 0) return;
    if (exportFormat === "markdown") {
      setPreviewMode("markdown");
      setPreviewTitle("Markdown 预览");
      setPreviewVisible(true);
      return;
    }
    if (exportFormat === "mindmap") {
      setPreviewMode("mindmap");
      setPreviewTitle("思维导图预览");
      setPreviewVisible(true);
    }
  }, [data, exportFormat]);

  const closePreview = () => {
    setPreviewVisible(false);
    setPreviewMode(null);
    setPreviewTitle("");
  };

  return (
    <div className="tag-center-overlay" onClick={onClose}>
      <div className="tag-center-dialog" onClick={e => e.stopPropagation()}>
        <div className="tc-header">
          <h3>标签中心</h3>
          <button className="tc-close" onClick={onClose}>×</button>
        </div>
        <div className="tc-toolbar">
          <label className="tc-toolbar-label" htmlFor="tc-export-format">导出格式</label>
          <select
            id="tc-export-format"
            className="tc-export-select"
            value={exportFormat}
            onChange={e => setExportFormat(e.target.value as typeof exportFormat)}
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="markdown">Markdown</option>
            <option value="mindmap">思维导图 (.mm)</option>
          </select>
          <button
            className="tc-preview-button"
            onClick={handlePreview}
            disabled={
              !data ||
              data.byTag.length === 0 ||
              (exportFormat !== "markdown" && exportFormat !== "mindmap")
            }
          >
            预览
          </button>
          <button
            className="tc-export-button"
            onClick={handleExport}
            disabled={!data || data.byTag.length === 0}
          >
            导出
          </button>
        </div>
        <div className="tc-body">
          <aside className="tc-tags">
            {loading && <div className="tc-loading">加载中...</div>}
            {!loading && data && data.byTag.length === 0 && (
              <div className="tc-empty">暂无标签</div>
            )}
            {!loading && data && data.byTag.map(tag => (
              <div
                key={tag.key}
                className={"tc-tag-item" + (activeTag === tag.key ? " active" : "")}
                onClick={() => setActiveTag(tag.key)}
                title={`${tag.title}（${tag.highlights.length} 划线 · ${tag.notes.length} 笔记）`}
              >
                <span className="tc-tag-name">{tag.title}</span>
                <span className="tc-tag-count">{tag.highlights.length}</span>
              </div>
            ))}
          </aside>
          <main className="tc-content">
            {loading && <div className="tc-loading">正在整理标签...</div>}
            {!loading && activeBucket && (
              <div className="tc-list">
                {activeBucket.highlights.length === 0 && (
                  <div className="tc-empty">该标签下暂无划线</div>
                )}
                {activeBucket.highlights.map((hl: StoredHighlight) => {
                  const expanded = !!expandedMap[hl.id];
                  const toggle = () => setExpandedMap(prev => ({ ...prev, [hl.id]: !prev[hl.id] }));
                  const linkedNotes = activeSummary?.highlightNotesMap.get(hl.id) || [];

                  return (
                    <div className="tc-hl-card" key={hl.id}>
                      <div className="tc-hl-text" title={hl.text}>{hl.text}</div>
                      <div className="tc-hl-meta">
                        <span className="tc-chapter">{hl.chapterTitle || hl.chapterId}</span>
                        <button className="tc-notes-btn" onClick={toggle}>
                          {expanded ? "收起笔记" : `查看同标签笔记 (${linkedNotes.length})`}
                        </button>
                      </div>
                      {expanded && linkedNotes.length > 0 && (
                        <ul className="tc-notes">
                          {linkedNotes.map(n => (
                            <li key={n.id} title={n.content}>{n.content}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>
      {previewVisible && (
        <div className="tc-preview-overlay" onClick={closePreview}>
          <div className="tc-preview-dialog" onClick={e => e.stopPropagation()}>
            <div className="tc-preview-header">
              <span>{previewTitle}</span>
              <button className="tc-preview-close" onClick={closePreview}>×</button>
            </div>
            <div className="tc-preview-body">
              {previewMode === "markdown" && (
                <div className="tc-markdown-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{buildMarkdown()}</ReactMarkdown>
                </div>
              )}
              {previewMode === "mindmap" && (
                <div className="tc-mindmap-preview">
                  <div className="tc-mindmap-center">标签中心</div>
                  <div className="tc-mindmap-branches">
                    {data?.byTag.map((bucket) => (
                      <div className="tc-mindmap-branch" key={bucket.key}>
                        {(() => {
                          const summary = tagSummaryMap.get(bucket.key);
                          const noteMap = summary?.highlightNotesMap ?? new Map<string, BookNote[]>();
                          const orphanNotes = summary?.orphanNotes ?? [];
                          return (
                            <>
                        <div className="tc-mindmap-node tag">{bucket.title}</div>
                        <div className="tc-mindmap-children">
                          {bucket.highlights.length > 0 && (
                            <div className="tc-mindmap-node group">划线</div>
                          )}
                          {bucket.highlights.map((hl) => {
                            const linkedNotes = noteMap.get(hl.id) || [];
                            return (
                              <div className="tc-mindmap-leaf" key={hl.id} title={hl.text}>
                                <span className="leaf-title">{hl.chapterTitle || hl.chapterId || "未知章节"}</span>
                                <span className="leaf-content">{hl.text}</span>
                                {linkedNotes.length > 0 && (
                                  <ul className="tc-mindmap-note-list">
                                    {linkedNotes.map(note => (
                                      <li key={note.id} title={note.content}>
                                        <span className="note-title">{note.title || "笔记"}</span>
                                        <span className="note-content">{note.content}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                          {orphanNotes.length > 0 && (
                            <>
                              <div className="tc-mindmap-node group">未关联笔记</div>
                              {orphanNotes.map(note => (
                                <div className="tc-mindmap-leaf" key={note.id} title={note.content}>
                                  <span className="leaf-title">{note.title || "未命名笔记"}</span>
                                  <span className="leaf-content">{note.content}</span>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                            </>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

