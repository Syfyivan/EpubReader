import { useState, useCallback, useMemo } from 'react';
import type { HighlightNote } from '../highlight/HighlightSystem';
import './NoteManager.css';

interface NoteManagerProps {
  notes: HighlightNote[];
  onAdd: (content: string, tags: string[]) => void;
  onEdit: (noteId: string, content: string) => void;
  onDelete: (noteIds: string[]) => void;
  onUpdateTags: (noteId: string, tags: string[]) => void;
  onClose: () => void;
  allTags?: string[]; // 用于联想提示的标签列表
}

export function NoteManager({
  notes,
  onAdd,
  onEdit,
  onDelete,
  onUpdateTags,
  onClose,
  allTags = [],
}: NoteManagerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [newNoteContent, setNewNoteContent] = useState<string>('');
  const [tagInput, setTagInput] = useState('');
  const [newNoteTags, setNewNoteTags] = useState<string[]>([]);
  const [perNoteTagInput, setPerNoteTagInput] = useState<Record<string, string>>({});

  const suggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [] as string[];
    return allTags.filter(t => t.toLowerCase().includes(q) && !newNoteTags.includes(t)).slice(0, 8);
  }, [tagInput, allTags, newNoteTags]);

  const addTag = useCallback((tag: string) => {
    const t = tag.trim();
    if (!t) return;
    setNewNoteTags(prev => Array.from(new Set([...prev, t])));
    setTagInput('');
  }, []);

  const removeTag = useCallback((tag: string) => {
    setNewNoteTags(prev => prev.filter(x => x !== tag));
  }, []);

  const toggleSelect = useCallback((noteId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

  const toggleExpand = useCallback((noteId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

  const handleStartEdit = useCallback((note: HighlightNote) => {
    setEditingId(note.id);
    setEditingContent(note.content);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingId && editingContent.trim()) {
      onEdit(editingId, editingContent.trim());
      setEditingId(null);
      setEditingContent('');
    }
  }, [editingId, editingContent, onEdit]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingContent('');
  }, []);

  const handleAddNote = useCallback(() => {
    if (newNoteContent.trim()) {
      onAdd(newNoteContent.trim(), newNoteTags);
      setNewNoteContent('');
      setNewNoteTags([]);
      setTagInput('');
    }
  }, [newNoteContent, newNoteTags, onAdd]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size > 0) {
      onDelete(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  }, [selectedIds, onDelete]);

  const getFirstLine = (content: string): string => {
    const firstLine = content.split('\n')[0];
    return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
  };

  return (
    <div
      className="note-manager-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      tabIndex={-1}
    >
      <div className="note-manager-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="note-manager-header">
          <h3>笔记管理</h3>
          <button className="close-button" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="note-manager-content">
          {/* 新增笔记 */}
          <div className="add-note-section">
            <textarea
              className="new-note-input"
              placeholder="输入新笔记..."
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              rows={3}
            />

            <div className="tag-input">
              <div className="tag-list">
                {newNoteTags.map(tag => (
                  <span className="tag-chip" key={tag} onClick={() => removeTag(tag)}>{tag} ×</span>
                ))}
              </div>
              <input
                type="text"
                placeholder="输入标签后回车，或从下方选择"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
              />
              {suggestions.length > 0 && (
                <ul className="tag-suggestions">
                  {suggestions.map(s => (
                    <li key={s} onMouseDown={() => addTag(s)}>{s}</li>
                  ))}
                </ul>
              )}
            </div>

            <button
              className="add-note-button"
              onClick={handleAddNote}
              disabled={!newNoteContent.trim()}
            >
              添加笔记
            </button>
          </div>

          {/* 笔记列表 */}
          <div className="notes-list">
            {notes.length === 0 ? (
              <div className="empty-notes">暂无笔记</div>
            ) : (
              <>
                {selectedIds.size > 0 && (
                  <div className="batch-actions">
                    <span>已选择 {selectedIds.size} 条</span>
                    <button
                      className="delete-selected-button"
                      onClick={handleDeleteSelected}
                    >
                      删除选中
                    </button>
                  </div>
                )}
                {notes.map((note) => {
                  const isExpanded = expandedIds.has(note.id);
                  const isSelected = selectedIds.has(note.id);
                  const isEditing = editingId === note.id;
                  const noteTags = Array.isArray(note.tags) ? note.tags : [];
                  const inputVal = perNoteTagInput[note.id] ?? "";
                  const noteSuggestions = allTags
                    .filter(t => t.toLowerCase().includes(inputVal.toLowerCase()) && !noteTags.includes(t))
                    .slice(0, 8);

                  const addNoteTag = (tag: string) => {
                    const t = tag.trim();
                    if (!t) return;
                    const next = Array.from(new Set([...noteTags, t]));
                    onUpdateTags(note.id, next);
                    setPerNoteTagInput(prev => ({ ...prev, [note.id]: "" }));
                  };
                  const removeNoteTag = (tag: string) => {
                    const next = noteTags.filter(x => x !== tag);
                    onUpdateTags(note.id, next);
                  };

                  return (
                    <div
                      key={note.id}
                      className={`note-item ${isSelected ? 'selected' : ''}`}
                    >
                      <div className="note-item-header">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(note.id)}
                          className="note-checkbox"
                        />
                        <div
                          className="note-content-wrapper"
                          onClick={() => !isEditing && toggleExpand(note.id)}
                        >
                          {isEditing ? (
                            <textarea
                              className="note-edit-input"
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              autoFocus
                              rows={3}
                            />
                          ) : (
                            <div className="note-preview">
                              {isExpanded ? (
                                <div className="note-full-content">{note.content}</div>
                              ) : (
                                <div className="note-first-line">{getFirstLine(note.content)}</div>
                              )}
                            </div>
                          )}
                          {/* 标签行 */}
                          <div className="tag-input" onClick={(e) => e.stopPropagation()}>
                            <div className="tag-list">
                              {noteTags.map(tag => (
                                <span className="tag-chip" key={tag} onClick={() => removeNoteTag(tag)}>{tag} ×</span>
                              ))}
                            </div>
                            <input
                              type="text"
                              placeholder="为该笔记添加标签后回车，或从下方选择"
                              value={inputVal}
                              onChange={(e) => setPerNoteTagInput(prev => ({ ...prev, [note.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addNoteTag(inputVal);
                                }
                              }}
                            />
                            {inputVal && noteSuggestions.length > 0 && (
                              <ul className="tag-suggestions">
                                {noteSuggestions.map(s => (
                                  <li key={s} onMouseDown={() => addNoteTag(s)}>{s}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                        <div className="note-actions">
                          {isEditing ? (
                            <>
                              <button
                                className="save-button"
                                onClick={handleSaveEdit}
                                disabled={!editingContent.trim()}
                              >
                                保存
                              </button>
                              <button
                                className="cancel-button"
                                onClick={handleCancelEdit}
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="edit-button"
                                onClick={() => handleStartEdit(note)}
                              >
                                编辑
                              </button>
                              <button
                                className="delete-button"
                                onClick={() => onDelete([note.id])}
                              >
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

