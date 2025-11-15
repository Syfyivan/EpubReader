import React, { useEffect, useMemo, useState } from "react";
import type { StorageManager, OrganizedAnnotations, StoredHighlight, BookNote } from "../storage/StorageManager";
import "./TagCenter.css";

interface TagCenterProps {
  storageManager: StorageManager;
  onClose: () => void;
}

export default function TagCenter({ storageManager, onClose }: TagCenterProps) {
  const [data, setData] = useState<OrganizedAnnotations | null>(null);
  const [activeTag, setActiveTag] = useState<string>("");
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="tag-center-overlay" onClick={onClose}>
      <div className="tag-center-dialog" onClick={e => e.stopPropagation()}>
        <div className="tc-header">
          <h3>标签中心</h3>
          <button className="tc-close" onClick={onClose}>×</button>
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

                  // 仅展示"同标签"的笔记（对内联转换出的 note：id = `${highlight.id}::${noteId}`）
                  const sameTagNotes: BookNote[] = (activeBucket.notes || []).filter(n =>
                    (n.id.startsWith(hl.id + "::")) && (n.tags?.includes(activeBucket.title))
                  );

                  return (
                    <div className="tc-hl-card" key={hl.id}>
                      <div className="tc-hl-text" title={hl.text}>{hl.text}</div>
                      <div className="tc-hl-meta">
                        <span className="tc-chapter">{hl.chapterTitle || hl.chapterId}</span>
                        <button className="tc-notes-btn" onClick={toggle}>
                          {expanded ? "收起笔记" : `查看同标签笔记 (${sameTagNotes.length})`}
                        </button>
                      </div>
                      {expanded && sameTagNotes.length > 0 && (
                        <ul className="tc-notes">
                          {sameTagNotes.map(n => (
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
    </div>
  );
}

