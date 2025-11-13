import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import type { EpubChapter } from '../parse/parse';
import type { Highlight, HighlightPosition, HighlightNote } from '../highlight/HighlightSystem';
import type { StoredHighlight } from '../storage/StorageManager';
import { EpubParser } from '../parse/parse';
import { HighlightSystem } from '../highlight/HighlightSystem';
import { VirtualHighlightRenderer, createVirtualScrollObserver } from '../highlight/VirtualHighlightRenderer';
import { StorageManager } from '../storage/StorageManager';
import type { BookMetadata } from '../storage/StorageManager';
import { aiClient, type AIAnalysis } from '../api/aiClient';
import { NoteManager } from '../components/NoteManager';
import { SmartTooltipPositioner } from '../highlight/SmartTooltipPositioner';
import './Read.css';

interface ReadProps {
  file: File | string;
  bookId: string;
  storageManager?: StorageManager;
  onExit?: () => void;
  onMetadataChange?: (bookId: string) => void;
  initialChapterId?: string;
  initialScrollTop?: number;
}

export default function Read({
  file,
  bookId,
  storageManager,
  onExit,
  onMetadataChange,
  initialChapterId,
  initialScrollTop,
}: ReadProps) {
  const [parser, setParser] = useState<EpubParser | null>(null);
  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<EpubChapter | null>(null);
  const [chapterContent, setChapterContent] = useState<string>('');
  const [chapterRenderKey, setChapterRenderKey] = useState<number>(0); // 强制重新渲染的key
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightChapterMap, setHighlightChapterMap] = useState<Map<string, string>>(new Map()); // 存储 highlightId -> chapterId 的映射
  const [bookMetadata, setBookMetadata] = useState<BookMetadata | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiStreamingText, setAiStreamingText] = useState<string>('');
  const [aiPanelPos, setAiPanelPos] = useState<{x:number;y:number}>({x: 100, y: 100});
  const aiDragRef = useRef<{dragging:boolean;offsetX:number;offsetY:number}>({dragging:false, offsetX:0, offsetY:0});
  const [loading, setLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  
  // 划线提示框状态
  const [showHighlightTooltip, setShowHighlightTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  
  // 使用 ref 保存 range 数据，避免 React 重新渲染导致的问题
  interface RangeData {
    range: Range;
    position: HighlightPosition;
    text: string; // 保存文本，用于恢复
  }
  const selectedRangeDataRef = useRef<RangeData | null>(null);

  // 临时高亮覆盖层（使用绝对定位，不修改DOM结构）
  const tempHighlightOverlayRef = useRef<HTMLDivElement | null>(null);
  const tempHighlightRangeRef = useRef<Range | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const highlightSystemRef = useRef<HighlightSystem | null>(null);
  const virtualRendererRef = useRef<VirtualHighlightRenderer | null>(null);
  const storageRef = useRef<StorageManager | null>(storageManager ?? null);
  const scrollObserverCleanupRef = useRef<(() => void) | null>(null);
  const initialChapterIdRef = useRef<string | undefined>(initialChapterId);
  const initialScrollTopRef = useRef<number | undefined>(initialScrollTop);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [showManageTooltip, setShowManageTooltip] = useState(false);
  const [manageTooltipPos, setManageTooltipPos] = useState<{x:number;y:number}>({x:0,y:0});
  const [manageHighlightId, setManageHighlightId] = useState<string | null>(null);
  const suppressRestoreRef = useRef<boolean>(false);
  const [showNoteManager, setShowNoteManager] = useState(false);
  const [noteManagerHighlightId, setNoteManagerHighlightId] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (storageManager) {
      storageRef.current = storageManager;
    }
  }, [storageManager]);

  useEffect(() => {
    initialChapterIdRef.current = initialChapterId;
  }, [bookId, initialChapterId]);

  useEffect(() => {
    initialScrollTopRef.current = initialScrollTop;
  }, [bookId, initialScrollTop]);

  // 清除临时高亮覆盖层
  const clearTempHighlightOverlay = useCallback(() => {
    if (tempHighlightOverlayRef.current) {
      // 清理事件监听器
      const overlay = tempHighlightOverlayRef.current as HTMLElement & { _cleanup?: () => void };
      if (overlay._cleanup && typeof overlay._cleanup === 'function') {
        overlay._cleanup();
      }
      tempHighlightOverlayRef.current.remove();
      tempHighlightOverlayRef.current = null;
    }
    tempHighlightRangeRef.current = null;
  }, []);

  // 创建临时高亮覆盖层（使用绝对定位，不修改DOM结构）
  const createTempHighlightOverlay = useCallback((range: Range) => {
    // 先清除之前的覆盖层
    clearTempHighlightOverlay();

    try {
      // 验证 range 是否仍然有效
      if (!range || range.collapsed) {
        console.warn('⚠️ createTempHighlightOverlay: Range 无效或已折叠');
        return;
      }

      // 先保存 range 的克隆，用于滚动时更新位置（在获取 rects 之前保存，避免 range 失效）
      tempHighlightRangeRef.current = range.cloneRange();

      // 获取 range 的所有矩形区域（可能跨多行）
      const rects = range.getClientRects();
      if (rects.length === 0) {
        console.warn('⚠️ createTempHighlightOverlay: 无法获取 range 的矩形区域');
        return;
      }

      const rangeText = range.toString().substring(0, 30);
      console.log('🎨 创建临时高亮，矩形数量:', rects.length, 'range文本:', rangeText);

      // 创建覆盖层容器
      const overlay = document.createElement('div');
      overlay.className = 'temp-highlight-overlay';
      overlay.style.position = 'absolute';
      overlay.style.pointerEvents = 'none'; // 不阻止点击
      overlay.style.zIndex = '10'; // 确保在文本上方，但在 tooltip (z-index: 1000) 下方
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.overflow = 'visible'; // 确保内容可见

      // 获取容器的位置
      const container = contentRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();

      // 为每个矩形区域创建与最终划线一致的“下划线”样式（2px线条）
      Array.from(rects).forEach((rect) => {
        const highlightDiv = document.createElement('div');
        highlightDiv.className = 'temp-highlight-item';
        highlightDiv.style.position = 'absolute';
        // 使用下划线效果：在文本矩形底部画2px高的横条
        highlightDiv.style.backgroundColor = '#3b82f6';
        highlightDiv.style.borderRadius = '1px';
        highlightDiv.style.pointerEvents = 'none';
        highlightDiv.style.zIndex = '10';
        
        // 计算相对于容器的位置
        const top = rect.top - containerRect.top + container.scrollTop;
        const left = rect.left - containerRect.left + container.scrollLeft;
        
        // 将横条放在该行底部 (-2px 高度)
        const underlineHeight = 2;
        highlightDiv.style.top = `${top + rect.height - underlineHeight}px`;
        highlightDiv.style.left = `${left}px`;
        highlightDiv.style.width = `${rect.width}px`;
        highlightDiv.style.height = `${underlineHeight}px`;

        overlay.appendChild(highlightDiv);
      });

      // 将覆盖层添加到容器
      if (container.style.position !== 'relative' && container.style.position !== 'absolute' && container.style.position !== 'fixed') {
        container.style.position = 'relative'; // 确保容器是定位上下文
      }
      container.appendChild(overlay);
      tempHighlightOverlayRef.current = overlay;

      // 验证覆盖层是否成功添加到 DOM
      if (document.contains(overlay)) {
        console.log('✅ 临时高亮覆盖层已成功添加到 DOM');
      } else {
        console.error('❌ 临时高亮覆盖层未成功添加到 DOM');
      }

      // 监听滚动和窗口大小变化，更新位置
      const updatePosition = () => {
        if (!tempHighlightOverlayRef.current || !container) return;
        
        // 尝试使用保存的 range 获取新的位置
        let newRects: DOMRectList | DOMRect[] = [];
        try {
          // 检查 range 是否仍然有效
          const savedRange = tempHighlightRangeRef.current;
          if (savedRange && !savedRange.collapsed) {
            newRects = savedRange.getClientRects();
          }
        } catch {
          // range 可能已失效，清除覆盖层
          clearTempHighlightOverlay();
          return;
        }
        
        if (newRects.length === 0) {
          clearTempHighlightOverlay();
          return;
        }

        const newContainerRect = container.getBoundingClientRect();
        const highlightItems = tempHighlightOverlayRef.current.querySelectorAll('.temp-highlight-item');
        const underlineHeight = 2;
        
        Array.from(newRects).forEach((rect, index) => {
          const item = highlightItems[index] as HTMLElement;
          if (item) {
            const top = rect.top - newContainerRect.top + container.scrollTop + rect.height - underlineHeight;
            const left = rect.left - newContainerRect.left + container.scrollLeft;
            item.style.top = `${top}px`;
            item.style.left = `${left}px`;
            item.style.width = `${rect.width}px`;
            item.style.height = `${underlineHeight}px`;
          }
        });
      };

      // 添加滚动监听
      const scrollHandler = () => updatePosition();
      const resizeHandler = () => updatePosition();
      
      window.addEventListener('scroll', scrollHandler, true);
      window.addEventListener('resize', resizeHandler);
      container.addEventListener('scroll', scrollHandler, true);

      // 保存清理函数
      (overlay as HTMLElement & { _cleanup?: () => void })._cleanup = () => {
        window.removeEventListener('scroll', scrollHandler, true);
        window.removeEventListener('resize', resizeHandler);
        container.removeEventListener('scroll', scrollHandler, true);
      };

      // 立即确保覆盖层可见，避免闪烁
      overlay.style.visibility = 'visible';
      console.log('✅ 创建临时高亮覆盖层，矩形数量:', rects.length);
    } catch (error) {
      console.error('❌ 创建临时高亮覆盖层失败:', error);
    }
  }, [clearTempHighlightOverlay]);

  const loadChapter = useCallback(async (chapterId: string, epubParser?: EpubParser) => {
    const parserToUse = epubParser || parser;
    if (!parserToUse) {
      console.warn('Parser not ready, cannot load chapter:', chapterId);
      return;
    }

    console.log('🔄 Loading chapter:', chapterId);
    
    // 清除临时高亮和选中状态
    clearTempHighlightOverlay();
    setShowHighlightTooltip(false);
    selectedRangeDataRef.current = null;
    
    setLoading(true);

    try {
      const chapter = parserToUse.getChapter(chapterId);
      if (!chapter) {
        console.warn('Chapter not found:', chapterId);
        return; // loading会在finally中设置为false
      }

      console.log('Found chapter:', chapter.title);

      // 加载内容
      const content = await parserToUse.loadChapter(chapterId);
      console.log('Chapter content loaded, length:', content.length);

      // 一次性更新所有状态 - 强制重新渲染
      setCurrentChapter(chapter);
      setChapterContent(content);
      setChapterRenderKey(prev => prev + 1); // 强制重新渲染
      // 注意：不再使用 restoredChapterRef，因为每次 highlights 更新都会自动恢复
      console.log('✅ Chapter and content set in state, renderKey:', chapterRenderKey + 1);

      if (storageRef.current) {
        const percent = parserToUse.getProgress(chapterId);
        const updated = await storageRef.current.updateBookMetadata(bookId, {
          currentChapterId: chapterId,
          progress: Number.isFinite(percent) ? percent / 100 : 0,
          lastReadAt: Date.now(),
        });
        if (updated) {
          setBookMetadata(updated);
          onMetadataChange?.(bookId);
        }
      }

      // 恢复划线的辅助函数
      const restoreHighlightsForChapter = (chId: string) => {
        if (!contentRef.current || !highlightSystemRef.current) return;

        console.log('🔄 开始恢复划线，container:', contentRef.current);
        
        // 设置容器
        highlightSystemRef.current.setContainer(contentRef.current);

        // 获取当前章节的所有划线
        setHighlights((currentHighlights) => {
          const chapterHighlights = currentHighlights.filter(
            (h) => {
              const stored = h as StoredHighlight;
              return stored.chapterId === chId;
            }
          );

          console.log(`📝 找到 ${chapterHighlights.length} 个当前章节的划线`);

          // 将当前章节的划线添加到HighlightSystem
          if (highlightSystemRef.current) {
            // 先清空HighlightSystem中的划线
            highlightSystemRef.current.highlights.clear();
            
            chapterHighlights.forEach((h) => {
              highlightSystemRef.current!.highlights.set(h.id, h);
              console.log(`✅ 添加划线到系统: ${h.id} - "${h.text.substring(0, 30)}..."`);
            });

            // 渲染所有划线（不清除已有划线，避免闪现）
            if (contentRef.current) {
              console.log('🎨 开始渲染划线到DOM');
              highlightSystemRef.current.renderHighlights(contentRef.current, false);
              
              // 渲染所有笔记
              highlightSystemRef.current.renderAllNotes(contentRef.current);
              console.log('✅ 划线渲染完成');
            }
          }

          return currentHighlights;
        });

        // 设置虚拟滚动观察器
        if (virtualRendererRef.current) {
          setHighlights((currentHighlights) => {
            const chapterHighlights = currentHighlights.filter(
              (h) => {
                const stored = h as StoredHighlight;
                return stored.chapterId === chId;
              }
            );
            virtualRendererRef.current?.setHighlights(chapterHighlights);
            return currentHighlights;
          });
        }

        if (scrollObserverCleanupRef.current) {
          scrollObserverCleanupRef.current();
        }
        if (virtualRendererRef.current && contentRef.current) {
          scrollObserverCleanupRef.current = createVirtualScrollObserver(
            contentRef.current,
            virtualRendererRef.current,
            document
          );
        }
      };

      // 等待React重新渲染后恢复已保存的划线
      // 使用双重延迟确保DOM完全准备好
      setTimeout(() => {
        // 再次延迟，确保dangerouslySetInnerHTML的内容已完全渲染
        setTimeout(() => {
          if (contentRef.current && highlightSystemRef.current) {
            // 检查DOM是否已准备好（有文本内容）
            const hasText = contentRef.current.textContent && contentRef.current.textContent.trim().length > 0;
            if (!hasText) {
              console.warn('⚠️ DOM内容尚未准备好，延迟恢复划线');
              setTimeout(() => {
                if (contentRef.current && highlightSystemRef.current) {
                  restoreHighlightsForChapter(chapterId);
                }
              }, 200);
              return;
            }

            restoreHighlightsForChapter(chapterId);

            if (
              initialScrollTopRef.current !== undefined &&
              contentRef.current
            ) {
              contentRef.current.scrollTop = initialScrollTopRef.current;
              initialScrollTopRef.current = undefined;
            }
          }
        }, 150);
      }, 100);

    } catch (error) {
      console.error('Failed to load chapter:', error);
    } finally {
      // 确保loading状态在最后设置，但不要阻塞渲染
      setTimeout(() => {
        setLoading(false);
        console.log('Loading set to false');
      }, 50);
    }
  }, [parser, chapterRenderKey, clearTempHighlightOverlay, bookId, onMetadataChange]);

  // 恢复划线的函数（提取出来，供多个地方使用）
  const restoreAllHighlights = useCallback(() => {
    if (suppressRestoreRef.current) {
      return;
    }
    if (!chapterContent || !currentChapter || !contentRef.current || !highlightSystemRef.current) {
      return;
    }

    // 获取当前章节的所有划线
    const chapterHighlights = highlights.filter((h) => {
      const stored = h as StoredHighlight;
      return stored.chapterId === currentChapter.id;
    });

    // 如果没有该章节的划线，直接返回
    if (chapterHighlights.length === 0) {
      return;
    }

    if (!contentRef.current || !highlightSystemRef.current) return;

    console.log(`🔄 恢复当前章节的所有划线: ${chapterHighlights.length} 个`);
    
    // 设置容器
    highlightSystemRef.current.setContainer(contentRef.current);
    
    // 先保存当前 HighlightSystem 中已有的划线（可能包含其他章节的）
    const existingHighlights = new Map(highlightSystemRef.current.highlights);
    
    // 更新当前章节的划线到 HighlightSystem（合并，不清空其他章节的）
    chapterHighlights.forEach((h) => {
      highlightSystemRef.current!.highlights.set(h.id, h);
    });
    
    // 只渲染当前章节的划线（通过检查是否在 chapterHighlights 中）
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    
    chapterHighlights.forEach((highlight) => {
      // 检查是否已存在（避免重复渲染）
      const existing = contentRef.current!.querySelector(
        `span.epub-highlight[data-highlight-id="${highlight.id}"]`
      );
      if (existing) {
        console.log(`⏭️ 划线已存在，跳过: ${highlight.id}`);
        skipCount++;
        return;
      }

      console.log(`🔍 尝试恢复划线: ${highlight.id}`);
      if (!highlightSystemRef.current) {
        failCount++;
        return;
      }
      
      const range = highlightSystemRef.current.restoreRange(
        highlight.position,
        contentRef.current!,
        highlight.text
      );
      
      if (range) {
        // 检查 range 是否在 container 内
        if (!contentRef.current!.contains(range.commonAncestorContainer)) {
          console.warn(`⚠️ Range不在container内: ${highlight.id}`);
          failCount++;
          return;
        }

        try {
          const result = highlightSystemRef.current.wrapRangeWithHighlight(
            range,
            highlight.id,
            highlight.color
          );
          if (result) {
            console.log(`✅ 划线渲染成功: ${highlight.id}`);
            successCount++;
            
            // 如果有笔记，插入笔记
            if (highlight.notes && highlight.notes.length > 0 && highlightSystemRef.current) {
              highlightSystemRef.current.insertNoteAfterHighlight(highlight.id, contentRef.current!);
            }
          } else {
            console.warn(`⚠️ wrapRangeWithHighlight返回null: ${highlight.id}`);
            failCount++;
          }
        } catch (e) {
          console.error(`❌ 恢复高亮失败: ${highlight.id}`, e);
          failCount++;
        }
      } else {
        console.warn(`⚠️ Range恢复失败: ${highlight.id}`);
        failCount++;
      }
    });

    console.log(`📊 划线恢复完成: 成功 ${successCount}, 跳过 ${skipCount}, 失败 ${failCount}`);
    
    // 恢复其他章节的划线到 HighlightSystem（保持状态一致）
    existingHighlights.forEach((h, id) => {
      const stored = h as StoredHighlight;
      if (stored.chapterId !== currentChapter.id) {
        highlightSystemRef.current!.highlights.set(id, h);
      }
    });
  }, [chapterContent, currentChapter, highlights]);

  // 使用 useLayoutEffect 在 DOM 更新后立即恢复划线（同步执行，避免闪现）
  useLayoutEffect(() => {
    if (!chapterContent || !currentChapter || !contentRef.current || !highlightSystemRef.current) {
      return;
    }

    // 关键修复：立即设置容器，确保首次选择时 HighlightSystem 已准备好
    highlightSystemRef.current.setContainer(contentRef.current);

    // 立即尝试恢复（在浏览器绘制之前）
    if (contentRef.current.textContent && contentRef.current.textContent.trim().length > 0) {
      // 检查是否已有划线，如果没有或数量不对，立即恢复
      const existingHighlights = contentRef.current.querySelectorAll('span.epub-highlight');
      const chapterHighlights = highlights.filter((h) => {
        const stored = h as StoredHighlight;
        return stored.chapterId === currentChapter.id;
      });
      
      // 如果已有划线数量少于应该有的数量，立即恢复
      if (existingHighlights.length < chapterHighlights.length) {
        restoreAllHighlights();
      }
      
      // 检查临时高亮是否被清除，如果是则恢复
      // 延迟检查，等待 DOM 完全稳定
      if (selectedRangeDataRef.current && tempHighlightRangeRef.current) {
        const overlayExists = tempHighlightOverlayRef.current && 
                              document.contains(tempHighlightOverlayRef.current) &&
                              contentRef.current.contains(tempHighlightOverlayRef.current);
        
        if (!overlayExists) {
          console.log('🔄 useLayoutEffect: 检测到临时高亮被清除，尝试恢复...');
          // 延迟恢复，确保 DOM 完全稳定
          setTimeout(() => {
            if (!selectedRangeDataRef.current || !contentRef.current || !highlightSystemRef.current) return;
            
            try {
              const rangeData = selectedRangeDataRef.current;
              
              // 优先使用 position 恢复 range（更可靠，因为 DOM 可能已改变）
              let restoredRange: Range | null = null;
              if (rangeData.position) {
                highlightSystemRef.current.setContainer(contentRef.current);
                restoredRange = highlightSystemRef.current.restoreRange(
                  rangeData.position,
                  contentRef.current,
                  rangeData.text
                );
              }
              
              // 如果 position 恢复失败，尝试使用保存的 range
              if (!restoredRange && tempHighlightRangeRef.current) {
                const savedRange = tempHighlightRangeRef.current;
                try {
                  if (!savedRange.collapsed) {
                    const testRects = savedRange.getClientRects();
                    if (testRects.length > 0) {
                      restoredRange = savedRange;
                    }
                  }
                } catch {
                  // range 已失效
                }
              }
              
              if (restoredRange && !restoredRange.collapsed) {
                console.log('✅ useLayoutEffect: 临时高亮 range 恢复成功，重新创建覆盖层');
                createTempHighlightOverlay(restoredRange);
              } else {
                console.warn('⚠️ useLayoutEffect: 临时高亮 range 已失效，无法恢复');
              }
            } catch (e) {
              console.warn('⚠️ useLayoutEffect: 恢复临时高亮失败:', e);
            }
          }, 150);
        }
      }
    }
  }, [chapterContent, currentChapter, restoreAllHighlights, highlights, createTempHighlightOverlay]);

  // 使用 useEffect 作为备用方案（处理异步情况）
  // 监听 DOM 变化，一旦发现划线被清除就立即恢复
  useEffect(() => {
    if (!chapterContent || !currentChapter || !contentRef.current || !highlightSystemRef.current) {
      return;
    }

    // 获取当前章节应该有的划线数量
    const chapterHighlights = highlights.filter((h) => {
      const stored = h as StoredHighlight;
      return stored.chapterId === currentChapter.id;
    });

    if (chapterHighlights.length === 0) {
      return;
    }

    // 使用 MutationObserver 监听 DOM 变化，一旦发现划线被清除就立即恢复
    const observer = new MutationObserver(() => {
      if (suppressRestoreRef.current) {
        return;
      }
      // 检查是否有文本内容，确保 DOM 已渲染
      if (contentRef.current && contentRef.current.textContent && contentRef.current.textContent.trim().length > 0) {
        // 检查是否已有划线，如果数量不对就恢复
        const existingHighlights = contentRef.current.querySelectorAll('span.epub-highlight');
        
        // 如果划线数量少于应该有的数量，立即恢复
        if (existingHighlights.length < chapterHighlights.length) {
          console.log(`⚠️ 检测到划线被清除，当前 ${existingHighlights.length} 个，应该 ${chapterHighlights.length} 个，立即恢复`);
          restoreAllHighlights();
        }
        
        // 检查临时高亮是否被清除，如果是则恢复
        if (selectedRangeDataRef.current && tempHighlightRangeRef.current) {
          const overlayExists = tempHighlightOverlayRef.current && 
                                document.contains(tempHighlightOverlayRef.current) &&
                                contentRef.current.contains(tempHighlightOverlayRef.current);
          
          if (!overlayExists) {
            console.log('🔄 MutationObserver: 检测到临时高亮被清除，尝试恢复...');
            // 延迟恢复，确保 DOM 完全稳定
            setTimeout(() => {
              if (!selectedRangeDataRef.current || !contentRef.current || !highlightSystemRef.current) return;
              
              try {
                const rangeData = selectedRangeDataRef.current;
                
                // 优先使用 position 恢复 range（更可靠，因为 DOM 可能已改变）
                let restoredRange: Range | null = null;
                if (rangeData.position) {
                  highlightSystemRef.current.setContainer(contentRef.current);
                  restoredRange = highlightSystemRef.current.restoreRange(
                    rangeData.position,
                    contentRef.current,
                    rangeData.text
                  );
                }
                
                // 如果 position 恢复失败，尝试使用保存的 range
                if (!restoredRange && tempHighlightRangeRef.current) {
                  const savedRange = tempHighlightRangeRef.current;
                  try {
                    if (!savedRange.collapsed) {
                      const testRects = savedRange.getClientRects();
                      if (testRects.length > 0) {
                        restoredRange = savedRange;
                      }
                    }
                  } catch {
                    // range 已失效
                  }
                }
                
                if (restoredRange && !restoredRange.collapsed) {
                  console.log('✅ MutationObserver: 临时高亮 range 恢复成功，重新创建覆盖层');
                  createTempHighlightOverlay(restoredRange);
                } else {
                  console.warn('⚠️ MutationObserver: 临时高亮 range 已失效，无法恢复');
                }
              } catch (e) {
                console.warn('⚠️ MutationObserver: 恢复临时高亮失败:', e);
              }
            }, 150);
          }
        }
      }
    });

    // 开始观察 DOM 变化
    if (contentRef.current) {
      observer.observe(contentRef.current, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    // 初始检查：如果划线数量不对，立即恢复
    const checkAndRestore = () => {
      if (contentRef.current) {
        const existingHighlights = contentRef.current.querySelectorAll('span.epub-highlight');
        if (existingHighlights.length < chapterHighlights.length) {
          console.log(`⚠️ 初始检查：划线数量不对，立即恢复`);
          restoreAllHighlights();
        }
      }
    };

    // 延迟检查，确保 DOM 已渲染
    const checkTimer = setTimeout(checkAndRestore, 100);

    return () => {
      observer.disconnect();
      clearTimeout(checkTimer);
    };
  }, [chapterContent, currentChapter, restoreAllHighlights, highlights, createTempHighlightOverlay]);

  // 确保章节内容渲染后立即设置 HighlightSystem 容器（修复首次选择无高亮）
  useLayoutEffect(() => {
    if (contentRef.current && highlightSystemRef.current && chapterContent) {
      // 确保 DOM 内容已完全渲染（有文本内容）
      const hasText = contentRef.current.textContent && contentRef.current.textContent.trim().length > 0;
      if (hasText) {
        highlightSystemRef.current.setContainer(contentRef.current);
        console.log('✅ useLayoutEffect: 已设置 HighlightSystem 容器，文本长度:', contentRef.current.textContent.length);
      } else {
        // 如果还没有文本，延迟设置
        const timer = setTimeout(() => {
          if (contentRef.current && highlightSystemRef.current) {
            highlightSystemRef.current.setContainer(contentRef.current);
            console.log('✅ useLayoutEffect (延迟): 已设置 HighlightSystem 容器');
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [chapterContent, chapterRenderKey]);

  // 翻页功能
  const goToPreviousChapter = useCallback(() => {
    if (!parser || !currentChapter) return;
    
    const currentIndex = chapters.findIndex(ch => ch.id === currentChapter.id);
    if (currentIndex > 0) {
      const prevChapter = chapters[currentIndex - 1];
      loadChapter(prevChapter.id);
    }
  }, [parser, currentChapter, chapters, loadChapter]);

  const goToNextChapter = useCallback(() => {
    if (!parser || !currentChapter) return;
    
    const currentIndex = chapters.findIndex(ch => ch.id === currentChapter.id);
    if (currentIndex < chapters.length - 1) {
      const nextChapter = chapters[currentIndex + 1];
      loadChapter(nextChapter.id);
    }
  }, [parser, currentChapter, chapters, loadChapter]);

  // 键盘快捷键支持
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // 忽略在输入框中的按键
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goToPreviousChapter();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goToNextChapter();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [goToPreviousChapter, goToNextChapter]);

  useEffect(() => {
    // 初始化组件
    const init = async () => {
      setLoading(true);
      try {
        // 初始化存储管理器
        let storage = storageRef.current;
        if (!storage) {
          storage = new StorageManager();
          await storage.init();
          storageRef.current = storage;
        } else {
          await storage.init();
        }

        const meta = await storage.getBook(bookId);
        if (meta) {
          setBookMetadata(meta);
          if (!initialChapterIdRef.current && meta.currentChapterId) {
            initialChapterIdRef.current = meta.currentChapterId;
          }
          if (
            initialScrollTopRef.current === undefined &&
            typeof meta.scrollTop === "number"
          ) {
            initialScrollTopRef.current = meta.scrollTop;
          }
        }

        // 初始化划线系统
        const highlightSystem = new HighlightSystem();
        highlightSystemRef.current = highlightSystem;

        // 初始化虚拟渲染器
        const virtualRenderer = new VirtualHighlightRenderer(highlightSystem);
        virtualRendererRef.current = virtualRenderer;

        // AI 助手现在通过后端 API 调用，无需初始化

        // 加载 EPUB
        const epubParser = new EpubParser();
        await epubParser.load(file);
        setParser(epubParser);

        const epubMeta = epubParser.getMetadata();
        if (storageRef.current) {
          const updates: Partial<BookMetadata> = {};
          if (epubMeta.title && epubMeta.title !== meta?.title) {
            updates.title = epubMeta.title;
          }
          if (epubMeta.author && epubMeta.author !== meta?.author) {
            updates.author = epubMeta.author;
          }
          if (Object.keys(updates).length > 0) {
            const updated = await storageRef.current.updateBookMetadata(
              bookId,
              updates
            );
            if (updated) {
              setBookMetadata(updated);
              onMetadataChange?.(bookId);
            }
          }
        }

        const chapters = epubParser.getChapters();
        console.log('📚 Chapters loaded:', chapters.map(ch => `${ch.id}: ${ch.title}`));

        // 检查章节ID是否唯一
        const chapterIds = chapters.map(ch => ch.id);
        const uniqueIds = new Set(chapterIds);
        if (chapterIds.length !== uniqueIds.size) {
          console.warn('⚠️ 发现重复的章节ID:', chapterIds.filter((id, index) => chapterIds.indexOf(id) !== index));
        }

        setChapters(chapters);

        if (chapters.length > 0) {
          let targetChapterId = chapters[0].id;
          if (initialChapterIdRef.current) {
            const exists = chapters.find(
              (chapter) => chapter.id === initialChapterIdRef.current
            );
            if (exists) {
              targetChapterId = initialChapterIdRef.current;
            }
          }
          await loadChapter(targetChapterId, epubParser);
          initialChapterIdRef.current = undefined;
        }

        // 加载已保存的划线
        const savedHighlights = await storage.getHighlightsByBook(bookId);
        // 转换 StoredHighlight 为 Highlight（去掉 bookId 和 chapterId）
        setHighlights(savedHighlights);
        // 创建 highlightId -> chapterId 的映射
        const chapterMap = new Map<string, string>();
        savedHighlights.forEach((h) => {
          const stored = h as StoredHighlight;
          if (stored.chapterId) {
            chapterMap.set(h.id, stored.chapterId);
          }
        });
        setHighlightChapterMap(chapterMap);
      } catch (error) {
        console.error('Failed to initialize:', error);
      } finally {
        setLoading(false);
      }
    };

    init();

    // 清理函数
    return () => {
      if (scrollObserverCleanupRef.current) {
        scrollObserverCleanupRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, bookId]); // 移除 loadChapter 依赖，避免无限循环

  // 获取 Range 第一行的位置信息
  const getFirstLineRect = (range: Range): DOMRect | null => {
    try {
      // 创建 Range 的副本
      const firstLineRange = range.cloneRange();
      
      // 获取第一个文本节点
      let node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) {
        // 如果是元素节点，查找第一个文本节点
        const walker = document.createTreeWalker(
          node,
          NodeFilter.SHOW_TEXT,
          null
        );
        const textNode = walker.nextNode();
        if (!textNode) return null;
        node = textNode;
      }
      
      // 设置范围从开始位置到第一行结束
      firstLineRange.setStart(node, range.startOffset);
      
      // 尝试找到第一行的结束位置
      // 通过检查字符位置和换行符来确定
      const textNode = node as Text;
      const text = textNode.textContent || '';
      const startOffset = range.startOffset;
      
      // 查找第一个换行符或段落边界
      let endOffset = text.indexOf('\n', startOffset);
      if (endOffset === -1) {
        // 如果没有换行符，检查是否到达节点末尾
        endOffset = text.length;
      }
      
      // 如果第一行超出了当前节点，需要扩展到下一个节点
      if (endOffset > textNode.length) {
        endOffset = textNode.length;
      }
      
      firstLineRange.setEnd(node, Math.min(endOffset, textNode.length));
      
      // 获取第一行的边界框
      return firstLineRange.getBoundingClientRect();
    } catch (error) {
      console.warn('⚠️ 获取第一行位置失败:', error);
      return null;
    }
  };

  // 处理文本选择，显示划线提示框
  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
      return;
    }

    // 检查是否真正选择了文本
    const text = selection.toString().trim();
    if (!text || text.length === 0) {
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
      return;
    }

    // 确保选择的内容在章节内容区域内
    if (!contentRef.current || !highlightSystemRef.current) {
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
      return;
    }

    const range = selection.getRangeAt(0);
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
      return;
    }

    // 验证 range 是否有效
    if (range.collapsed) {
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
      return;
    }

    // 立即序列化 range 为 XPath，避免 React 重新渲染后失效
    try {
      // 强制设置容器（确保首次选择时也能工作）
      if (highlightSystemRef.current && contentRef.current) {
        highlightSystemRef.current.setContainer(contentRef.current);
      }
      
      // 序列化 range（如果失败，仍然尝试创建临时高亮）
      let position: HighlightPosition | null = null;
      if (highlightSystemRef.current && contentRef.current) {
        position = highlightSystemRef.current.serializeRange(range, contentRef.current);
        if (!position) {
          console.warn('⚠️ 无法序列化 range，但将继续创建临时高亮');
        }
      }

      // 保存序列化的 position、原始的 range 和文本（作为备份）
      // 使用一个对象同时保存三者
      const rangeData: RangeData = {
        range: range.cloneRange(),
        position: position || {
          start: { xpath: '', offset: 0 },
          end: { xpath: '', offset: 0 },
          timestamp: Date.now(),
        },
        text: text, // 保存文本，用于恢复
      };
      
      // 使用 ref 保存，避免 React 状态更新导致的问题
      selectedRangeDataRef.current = rangeData;

      console.log('✅ 保存选中范围，文本:', text.substring(0, 30), 'position:', position ? '已序列化' : '使用备用方案');

      // 使用统一的智能定位器，确保 SmartTooltipPositioner 中的常量生效
      const scrollContainer = (scrollContainerRef.current || contentRef.current?.parentElement) as HTMLElement | null;
      if (!scrollContainer) {
        console.warn('⚠️ 无法找到滚动容器');
        return;
      }
      const pos = SmartTooltipPositioner.calculatePosition(range, scrollContainer);
      setTooltipPosition(pos);

      setShowHighlightTooltip(true);
      
      // 创建临时高亮覆盖层（不修改DOM，使用绝对定位）
      // 先创建临时高亮，然后再清除浏览器默认选择
      // 立即创建，不等待动画帧，确保在章节重新渲染前创建
      createTempHighlightOverlay(range);
      
      // 延迟清除浏览器选择，确保临时高亮已经完全创建并渲染
      setTimeout(() => {
        window.getSelection()?.removeAllRanges();
        console.log('🧹 已清除浏览器选择，临时高亮应该已显示');
      }, 50);
    } catch (error) {
      console.error('❌ 保存选中范围时出错:', error);
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
    }
  }, [createTempHighlightOverlay]);

  // 创建划线
  const handleCreateHighlight = useCallback(() => {
    // 先清除临时高亮覆盖层
    clearTempHighlightOverlay();
    
    if (!selectedRangeDataRef.current || !highlightSystemRef.current || !storageRef.current || !currentChapter || !contentRef.current) {
      console.warn('⚠️ 创建划线缺少必要参数');
      return;
    }

    // 获取有效的 range
    let rangeToUse: Range | null = null;
    try {
      // 从 ref 中获取 range 数据
      const rangeData = selectedRangeDataRef.current;
      
      // 优先使用序列化的 position 恢复 range（更可靠）
      if (rangeData.position && highlightSystemRef.current) {
        highlightSystemRef.current.setContainer(contentRef.current);
        const restoredRange = highlightSystemRef.current.restoreRange(rangeData.position, contentRef.current);
        if (restoredRange && !restoredRange.collapsed) {
          const text = restoredRange.toString().trim();
          if (text.length > 0) {
            rangeToUse = restoredRange;
            console.log('✅ 使用序列化的 position 恢复 range，文本长度:', text.length);
          }
        }
      }
      
      // 如果 position 恢复失败，尝试使用保存的 range
      if (!rangeToUse && rangeData.range) {
        const savedRange = rangeData.range as Range;
        // 检查节点是否仍在 DOM 中
        if (document.contains(savedRange.startContainer) && 
            document.contains(savedRange.endContainer)) {
          try {
            const testRange = savedRange.cloneRange();
            if (!testRange.collapsed && testRange.toString().trim().length > 0) {
              rangeToUse = testRange;
              console.log('✅ 使用保存的 range');
            }
          } catch (e) {
            console.warn('⚠️ 保存的 range 验证失败:', e);
          }
        }
      }
      
      // 如果都失败，尝试使用当前 selection
      if (!rangeToUse) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const currentRange = selection.getRangeAt(0);
          if (!currentRange.collapsed && 
              currentRange.toString().trim().length > 0 &&
              contentRef.current.contains(currentRange.commonAncestorContainer)) {
            rangeToUse = currentRange.cloneRange();
            console.log('✅ 使用当前 selection 中的 range');
          }
        }
      }
      
      if (!rangeToUse) {
        console.error('❌ 无法获取有效的 range，请重新选择文字');
        setShowHighlightTooltip(false);
        selectedRangeDataRef.current = null;
        return;
      }
      
      // 验证 range 文本
      const rangeText = rangeToUse.toString().trim();
      if (rangeText.length === 0) {
        console.error('❌ Range 文本为空，无法创建划线');
        setShowHighlightTooltip(false);
        selectedRangeDataRef.current = null;
        return;
      }
      
      console.log('✅ 获取到有效的 range，文本:', rangeText.substring(0, 50));
    } catch (error) {
      console.error('❌ 获取 range 时出错:', error);
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
      return;
    }

    // 创建 Selection 对象用于 createHighlight（需要 Selection 接口）
    const selection = window.getSelection();
    if (!selection) {
      console.error('❌ 无法获取 Selection 对象');
      return;
    }
    
    // 临时设置 selection（用于 createHighlight）
    try {
      selection.removeAllRanges();
      selection.addRange(rangeToUse);
    } catch (e) {
      console.warn('⚠️ 设置 selection 失败，但继续创建划线:', e);
    }

    // 创建划线
    const highlight = highlightSystemRef.current.createHighlight(
      selection,
      contentRef.current || undefined,
      '#3b82f6' // 蓝色下划线
    );

    if (highlight) {
      // 创建带 chapterId 的存储对象
      const storedHighlight: StoredHighlight = {
        ...highlight,
        bookId,
        chapterId: currentChapter.id,
      };

      // 在DOM中应用下划线样式（在状态更新之前，避免被清除）
      // 直接使用已验证的 rangeToUse
      if (contentRef.current && highlightSystemRef.current && rangeToUse) {
        try {
          // 验证 range 是否有效
          if (rangeToUse.collapsed) {
            console.warn('⚠️ Range已折叠，无法应用划线样式');
            return;
          }
          
          // 验证 range 是否在 contentRef 内
          if (!contentRef.current.contains(rangeToUse.commonAncestorContainer)) {
            console.warn('⚠️ Range不在contentRef内，无法应用划线样式');
            return;
          }
          
          const rangeText = rangeToUse.toString().trim();
          console.log('🎨 准备应用划线样式，range文本:', rangeText.substring(0, 50), '长度:', rangeText.length);
          const result = highlightSystemRef.current.wrapRangeWithHighlight(rangeToUse, highlight.id, highlight.color);
          if (result) {
            console.log('✅ 划线样式应用成功:', highlight.id);
          } else {
            console.warn('⚠️ 划线样式应用失败，返回null:', highlight.id);
            return;
          }
        } catch (error) {
          console.error('❌ 应用划线样式时出错:', error);
          return;
        }
      } else {
        console.warn('⚠️ 无法应用划线样式:', {
          hasContentRef: !!contentRef.current,
          hasHighlightSystem: !!highlightSystemRef.current,
          hasRange: !!rangeToUse
        });
        return;
      }

      // 更新状态 - 使用 storedHighlight 而不是 highlight，这样恢复时才能正确过滤
      console.log(`✨ 创建划线: ${highlight.id}, chapterId: ${currentChapter.id}, text: "${highlight.text.substring(0, 30)}..."`);
      
      // 先将划线添加到 HighlightSystem，这样即使重新渲染也能恢复
      if (highlightSystemRef.current) {
        highlightSystemRef.current.highlights.set(highlight.id, storedHighlight);
      }
      
      // 保存到 IndexedDB（先保存，避免状态更新导致的问题）
      storageRef.current.saveHighlight(storedHighlight);
      console.log(`💾 已保存到 IndexedDB: ${highlight.id}`);
      
      // 更新状态（这可能会触发重新渲染，但我们已经保存了划线到 HighlightSystem）
      setHighlights((prev) => {
        const newHighlights = [...prev, storedHighlight];
        console.log(`📦 状态更新: 总共有 ${newHighlights.length} 个划线`);
        return newHighlights;
      });
      
      // 更新章节映射
      setHighlightChapterMap((prev) => {
        const newMap = new Map(prev);
        newMap.set(highlight.id, currentChapter.id);
        return newMap;
      });

      // 创建新划线后，立即恢复所有划线（包括新创建的和已存在的）
      // 使用 requestAnimationFrame 确保在 DOM 更新后执行
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // 立即恢复所有划线，确保新创建的划线立即显示，已存在的划线不被清除
          restoreAllHighlights();
        });
      });

      // 清除选择和提示框
      selection.removeAllRanges();
      clearTempHighlightOverlay();
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
    }
  }, [currentChapter, bookId, restoreAllHighlights, clearTempHighlightOverlay]);

  // 创建划线并添加一条笔记
  const handleAddNote = useCallback(async () => {
    // 先基于当前选择创建划线（与 handleCreateHighlight 相同的准备阶段）
    clearTempHighlightOverlay();
    if (!selectedRangeDataRef.current || !highlightSystemRef.current || !storageRef.current || !currentChapter || !contentRef.current) {
      console.warn('⚠️ 创建笔记缺少必要参数');
      return;
    }
    // 复用创建流程以拿到 highlight
    // 获取有效的 range
    let rangeToUse: Range | null = null;
    try {
      const rangeData = selectedRangeDataRef.current;
      if (rangeData.position && highlightSystemRef.current) {
        highlightSystemRef.current.setContainer(contentRef.current);
        const restoredRange = highlightSystemRef.current.restoreRange(rangeData.position, contentRef.current);
        if (restoredRange && !restoredRange.collapsed) {
          const text = restoredRange.toString().trim();
          if (text.length > 0) {
            rangeToUse = restoredRange;
          }
        }
      }
      if (!rangeToUse && rangeData.range) {
        const savedRange = rangeData.range as Range;
        if (document.contains(savedRange.startContainer) && document.contains(savedRange.endContainer)) {
          try {
            const testRange = savedRange.cloneRange();
            if (!testRange.collapsed && testRange.toString().trim().length > 0) {
              rangeToUse = testRange;
            }
    } catch {/* ignore */}
        }
      }
      if (!rangeToUse) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const currentRange = selection.getRangeAt(0);
          if (!currentRange.collapsed && currentRange.toString().trim().length > 0 && contentRef.current.contains(currentRange.commonAncestorContainer)) {
            rangeToUse = currentRange.cloneRange();
          }
        }
      }
      if (!rangeToUse) {
        console.warn('❌ 无法获取有效的 range，请重新选择文字');
        setShowHighlightTooltip(false);
        selectedRangeDataRef.current = null;
        return;
      }
    } catch (error) {
      console.error('❌ 获取 range 时出错:', error);
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
      return;
    }

    // 临时设置 selection 以复用 createHighlight
    const selection = window.getSelection();
    if (selection) {
      try {
        selection.removeAllRanges();
        selection.addRange(rangeToUse);
          } catch {/* ignore */}
    }

    // 先创建划线
    const highlight = highlightSystemRef.current.createHighlight(
      window.getSelection() as Selection,
      contentRef.current || undefined,
      '#3b82f6'
    );

    if (!highlight) {
      console.warn('❌ 创建划线失败，无法添加笔记');
      return;
    }

    // 打开笔记管理对话框
    setNoteManagerHighlightId(highlight.id);
    // 预取标签联想
    if (storageRef.current) {
      storageRef.current.getAllTags().then(setAllTags).catch(() => {});
    }
    setShowNoteManager(true);
    // 清除选择和提示框
    selection?.removeAllRanges();
    clearTempHighlightOverlay();
    setShowHighlightTooltip(false);
    selectedRangeDataRef.current = null;
    
    // 先保存划线（即使没有笔记）
    const storedHighlight: StoredHighlight = {
      ...highlight,
      bookId,
      chapterId: currentChapter.id,
    };
    highlightSystemRef.current.highlights.set(highlight.id, storedHighlight);
    storageRef.current.saveHighlight(storedHighlight);
    setHighlights((prev) => {
      const idx = prev.findIndex((h) => h.id === highlight.id);
      if (idx === -1) return [...prev, storedHighlight];
      const next = [...prev];
      next[idx] = storedHighlight;
      return next;
    });
    setHighlightChapterMap((prev) => {
      const newMap = new Map(prev);
      newMap.set(highlight.id, currentChapter.id);
      return newMap;
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreAllHighlights();
      });
    });
    return;
  }, [currentChapter, bookId, restoreAllHighlights, clearTempHighlightOverlay]);

  // 处理笔记管理对话框的回调
  const handleNoteManagerAdd = useCallback((content: string, tags: string[]) => {
    if (!noteManagerHighlightId || !highlightSystemRef.current || !storageRef.current || !contentRef.current) return;
    
    const highlight = highlightSystemRef.current.highlights.get(noteManagerHighlightId) as StoredHighlight | undefined;
    if (!highlight) return;
    
    const now = Date.now();
    const noteObj: HighlightNote = {
      id: `note-${now}-${Math.random().toString(36).slice(2, 6)}`,
      content,
      createdAt: now,
      updatedAt: now,
      tags: Array.from(new Set((tags || []).filter(Boolean)))
    };
    
    const mergedTags = Array.from(new Set([...(highlight.tags || []), ...((noteObj.tags)||[])]));

    const updatedHighlight: StoredHighlight = {
      ...highlight,
      tags: mergedTags,
      notes: [...(highlight.notes || []), noteObj],
    };
    
    highlightSystemRef.current.highlights.set(noteManagerHighlightId, updatedHighlight);
    highlightSystemRef.current.insertNoteAfterHighlight(noteManagerHighlightId, contentRef.current);
    storageRef.current.saveHighlight(updatedHighlight);
    
    setHighlights((prev) => {
      const idx = prev.findIndex((h) => h.id === noteManagerHighlightId);
      if (idx === -1) return [...prev, updatedHighlight];
      const next = [...prev];
      next[idx] = updatedHighlight;
      return next;
    });
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreAllHighlights();
      });
    });
  }, [noteManagerHighlightId, restoreAllHighlights]);

  const handleNoteManagerEdit = useCallback((noteId: string, content: string) => {
    if (!noteManagerHighlightId || !highlightSystemRef.current || !storageRef.current || !contentRef.current) return;
    
    const highlight = highlightSystemRef.current.highlights.get(noteManagerHighlightId) as StoredHighlight | undefined;
    if (!highlight || !highlight.notes) return;
    
    const updatedNotes = highlight.notes.map((n) =>
      n.id === noteId ? { ...n, content, updatedAt: Date.now() } : n
    );
    
    const updatedHighlight: StoredHighlight = {
      ...highlight,
      notes: updatedNotes,
    };
    
    highlightSystemRef.current.highlights.set(noteManagerHighlightId, updatedHighlight);
    // 重新插入所有笔记
    const existingNotes = contentRef.current.querySelectorAll(`[data-note-id="${noteManagerHighlightId}"]`);
    existingNotes.forEach((el) => el.remove());
    highlightSystemRef.current.insertNoteAfterHighlight(noteManagerHighlightId, contentRef.current);
    storageRef.current.saveHighlight(updatedHighlight);
    
    setHighlights((prev) => {
      const idx = prev.findIndex((h) => h.id === noteManagerHighlightId);
      if (idx === -1) return [...prev, updatedHighlight];
      const next = [...prev];
      next[idx] = updatedHighlight;
      return next;
    });
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreAllHighlights();
      });
    });
  }, [noteManagerHighlightId, restoreAllHighlights]);

  const handleNoteManagerDelete = useCallback((noteIds: string[]) => {
    if (!noteManagerHighlightId || !highlightSystemRef.current || !storageRef.current || !contentRef.current) return;
    
    const highlight = highlightSystemRef.current.highlights.get(noteManagerHighlightId) as StoredHighlight | undefined;
    if (!highlight || !highlight.notes) return;
    
    const updatedNotes = highlight.notes.filter((n) => !noteIds.includes(n.id));
    
    const updatedHighlight: StoredHighlight = {
      ...highlight,
      notes: updatedNotes.length > 0 ? updatedNotes : undefined,
    };
    
    highlightSystemRef.current.highlights.set(noteManagerHighlightId, updatedHighlight);
    // 删除对应的笔记元素
    noteIds.forEach((noteId) => {
      const noteEl = contentRef.current?.querySelector(`[data-note-id="${noteId}"]`);
      noteEl?.remove();
    });
    // 如果还有笔记，重新插入
    if (updatedNotes.length > 0) {
      highlightSystemRef.current.insertNoteAfterHighlight(noteManagerHighlightId, contentRef.current);
    }
    storageRef.current.saveHighlight(updatedHighlight);
    
    setHighlights((prev) => {
      const idx = prev.findIndex((h) => h.id === noteManagerHighlightId);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = updatedHighlight;
      return next;
    });
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreAllHighlights();
      });
    });
  }, [noteManagerHighlightId, restoreAllHighlights]);

  // 处理点击已有划线，打开笔记管理
  const handleHighlightClick = useCallback((e: React.MouseEvent, highlightId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const highlight = highlightSystemRef.current?.highlights.get(highlightId) as StoredHighlight | undefined;
    if (!highlight) return;
    
    // 计算 tooltip 位置
    const highlightEl = contentRef.current?.querySelector(`span.epub-highlight[data-highlight-id="${highlightId}"]`);
    if (highlightEl) {
      const rect = highlightEl.getBoundingClientRect();
      const scrollContainer = scrollContainerRef.current || contentRef.current?.parentElement;
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        setManageTooltipPos({
          x: (rect.left - containerRect.left) + (rect.width / 2),
          y: (rect.top - containerRect.top) - 10,
        });
      }
    }
    
    setManageHighlightId(highlightId);
    setShowManageTooltip(true);
  }, []);

  // 打开笔记管理对话框（从管理 tooltip）
  const handleOpenNoteManager = useCallback(() => {
    if (!manageHighlightId) return;
    setNoteManagerHighlightId(manageHighlightId);
    setShowNoteManager(true);
    setShowManageTooltip(false);
  }, [manageHighlightId]);

  // 旧的 handleAddNote 函数需要更新，但先保留原有逻辑作为备用


  // AI 启发：基于当前选择文本进行分析
  const handleAIInspire = useCallback(async () => {
    const data = selectedRangeDataRef.current;
    const selectedText = data?.text?.trim() || '';
    if (!selectedText) return;
    // 先展示面板并显示“正在生成...”，立即可见
    setShowAnalysis(true);
    setAiStreamingText('正在生成...\n');
    setLoading(true);
    try {
      const analysis = await aiClient.analyzeContent(selectedText);
      setAiAnalysis(analysis);
      // 流式展示
      const parts: string[] = [];
      if (analysis.summary) parts.push(`【摘要】\n${analysis.summary}\n\n`);
      if (analysis.insights?.length) parts.push(`【洞察】\n- ${analysis.insights.join('\n- ')}\n\n`);
      if (analysis.questions?.length) parts.push(`【启发式问题】\n- ${analysis.questions.join('\n- ')}\n\n`);
      if (analysis.connections?.length) parts.push(`【知识关联】\n- ${analysis.connections.join('\n- ')}\n\n`);
      const fullText = parts.join('');
      setAiStreamingText(''); // 清空占位
      let idx = 0;
      const tick = () => {
        const step = Math.max(1, Math.floor(fullText.length / 120));
        setAiStreamingText((prev) => prev + fullText.slice(idx, idx + step));
        idx += step;
        if (idx < fullText.length) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (e) {
      console.error('AI 启发失败:', e);
      alert('AI 启发失败，请检查后端与 API 配置');
    } finally {
      setLoading(false);
      // 不强制清除选择，保持用户上下文
    }
  }, []);

  // 点击外部区域关闭提示框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showHighlightTooltip) {
        const target = e.target as HTMLElement;
        if (!target.closest('.highlight-tooltip') && !target.closest('.epub-highlight')) {
          setShowHighlightTooltip(false);
          selectedRangeDataRef.current = null;
          window.getSelection()?.removeAllRanges();
          clearTempHighlightOverlay();
        }
      }
      if (showManageTooltip) {
        const target = e.target as HTMLElement;
        if (!target.closest('.highlight-manage-tooltip') && !target.closest('.epub-highlight')) {
          setShowManageTooltip(false);
          setManageHighlightId(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHighlightTooltip, showManageTooltip, clearTempHighlightOverlay]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container || !storageRef.current) return;
    let timer: number | undefined;

    const persistScroll = async () => {
      if (!storageRef.current) return;
      const updated = await storageRef.current.updateBookMetadata(bookId, {
        scrollTop: container.scrollTop,
        lastReadAt: Date.now(),
      });
      if (updated) {
        setBookMetadata(updated);
        onMetadataChange?.(bookId);
      }
    };

    const handleScroll = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(persistScroll, 400);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (timer) window.clearTimeout(timer);
    };
  }, [bookId, onMetadataChange]);

  useEffect(() => {
    if (!tooltipRef.current) return;
    tooltipRef.current.style.left = `${tooltipPosition.x}px`;
    tooltipRef.current.style.top = `${tooltipPosition.y}px`;
  }, [tooltipPosition, showHighlightTooltip]);

  const handleAnalyzeContent = async () => {
    if (!currentChapter) return;

    setLoading(true);
    try {
      // 启动面板并清空流式文本
      setShowAnalysis(true);
      setAiStreamingText('');
      // 先请求完整结果，再以打字机方式流式呈现
      const analysis = await aiClient.analyzeContent(chapterContent);
      setAiAnalysis(analysis);
      // 将摘要与关键信息拼接为流式文本
      const parts: string[] = [];
      if (analysis.summary) parts.push(`【摘要】\n${analysis.summary}\n\n`);
      if (analysis.insights?.length) parts.push(`【洞察】\n- ${analysis.insights.join('\n- ')}\n\n`);
      if (analysis.questions?.length) parts.push(`【启发式问题】\n- ${analysis.questions.join('\n- ')}\n\n`);
      if (analysis.connections?.length) parts.push(`【知识关联】\n- ${analysis.connections.join('\n- ')}\n\n`);
      const fullText = parts.join('');
      let idx = 0;
      const tick = () => {
        const step = Math.max(1, Math.floor(fullText.length / 120));
        setAiStreamingText((prev) => prev + fullText.slice(idx, idx + step));
        idx += step;
        if (idx < fullText.length) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    } catch (error) {
      console.error('Failed to analyze content:', error);
      alert('AI 分析失败，请确保后端服务已启动（运行 npm run backend）');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: 'json' | 'markdown' | 'mindmap') => {
    if (!storageRef.current) return;

    try {
      let content = '';
      let filename = '';
      let mimeType = '';

      switch (format) {
        case 'json':
          content = await storageRef.current.exportToJSON();
          filename = `epub-notes-${Date.now()}.json`;
          mimeType = 'application/json';
          break;
        case 'markdown':
          content = await storageRef.current.exportToMarkdown(bookId);
          filename = `epub-report-${Date.now()}.md`;
          mimeType = 'text/markdown';
          break;
        case 'mindmap':
          content = await storageRef.current.exportToMindMap(bookId);
          filename = `epub-mindmap-${Date.now()}.json`;
          mimeType = 'application/json';
          break;
      }

      // 下载文件
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export:', error);
    }
  };

  const progressDisplay = Math.min(
    100,
    Math.max(0, (bookMetadata?.progress ?? 0) * 100)
  ).toFixed(1);

  if (loading && !parser) {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="read-shell">
      <div className="read-topbar">
        <div className="topbar-left">
          {onExit && (
            <button
              className="topbar-back"
              onClick={onExit}
              type="button"
            >
              ← 返回图书馆
            </button>
          )}
          <div className="topbar-title">
            {bookMetadata?.title || "正在阅读"}
          </div>
        </div>
        <div className="topbar-meta">
          <span>进度 {progressDisplay}%</span>
          {bookMetadata?.lastReadAt && (
            <span>
              最近阅读 {new Date(bookMetadata.lastReadAt).toLocaleString("zh-CN")}
            </span>
          )}
        </div>
      </div>
      <div className="read-container">
      <div className="read-sidebar">
        <h2>目录</h2>
        <ul className="chapter-list">
          {chapters
            .map((chapter, index) => {
              const level = chapter.level || 0;
              const levelClass =
                level >= 3 ? 'chapter-level-3' : `chapter-level-${level}`;
              const isActive = currentChapter?.id === chapter.id;
              const displayTitle = (() => {
                const t = (chapter.title || '').trim();
                if (t && !/^id\d{3,}$/.test(t)) return t;
                // 退化为根据 href 文件名
                const href = chapter.href || '';
                const base = href.split('/').pop() || chapter.id;
                return decodeURIComponent(base).replace(/\.[^.]+$/, '') || chapter.id;
              })();
              return (
                <li
                  key={`${chapter.id}-${index}`}
                  className={`chapter-item ${levelClass} ${isActive ? 'active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('📖 TOC Chapter clicked:', chapter.id, displayTitle);
                    if (parser) {
                      console.log('🔄 Calling loadChapter for:', chapter.id);
                      loadChapter(chapter.id);
                    } else {
                      console.error('❌ Parser not initialized yet');
                    }
                  }}>
                  <span>{displayTitle}</span>
                </li>
              );
            })}
        </ul>

        <div className="sidebar-actions">
          <button onClick={handleAnalyzeContent} disabled={!currentChapter}>
            AI 分析
          </button>
          <button onClick={() => handleExport('json')}>导出 JSON</button>
          <button onClick={() => handleExport('markdown')}>导出 Markdown</button>
          <button onClick={() => handleExport('mindmap')}>导出思维导图</button>
        </div>

        {/* {highlights.length > 0 && (
          <div className="highlights-list">
            <h3>划线 ({highlights.length})</h3>
            <ul>
              {highlights.map((highlight) => {
                // 从 storedHighlight 中获取 chapterId（更可靠）
                const stored = highlight as StoredHighlight;
                const chapterId = stored.chapterId || highlightChapterMap.get(highlight.id);
                return (
                <li
                  key={highlight.id}
                  className={`highlight-item ${chapterId ? 'clickable' : ''}`}
                  onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      
                      // 跳转到对应章节
                      if (chapterId && parser) {
                        console.log('Highlight clicked, jumping to chapter:', chapterId);
                        loadChapter(chapterId);
                      } else if (!chapterId) {
                        console.warn('No chapter ID found for highlight:', highlight.id);
                      } else {
                        console.warn('Parser not ready');
                      }
                  }}
                  onMouseDown={(e) => {
                      e.preventDefault();
                  }}
                  title={chapterId ? '点击跳转到该章节' : ''}
                >
                    <div className="highlight-text">{highlight.text}</div>
                    {highlight.note && (
                      <div className="highlight-note">{highlight.note}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )} */}
      </div>

      <div className="read-content">
        {loading && <div className="loading-indicator">加载中...</div>}
        {currentChapter && chapterContent && (
          <>
            {console.log('🎨 Rendering chapter:', currentChapter.title, 'key:', `chapter-${currentChapter.id}-${chapterRenderKey}`)}
            <div className="chapter-header">
              <h1>{currentChapter.title}</h1>
            </div>
            <div
              key={`chapter-${currentChapter.id}-${chapterRenderKey}`}
              ref={contentRef}
              className="chapter-content"
              dangerouslySetInnerHTML={{ __html: chapterContent }}
              onMouseUp={handleTextSelection}
              onClick={(e) => {
                // 处理内容中的链接点击
                const target = e.target as HTMLElement;
                
                // 如果点击的是划线元素，检查内部是否有链接
                let link: HTMLAnchorElement | null = null;
                if (target.classList.contains('epub-highlight')) {
                  // 打开管理 tooltip
                  const hl = target.closest('.epub-highlight') as HTMLElement | null;
                  const hid = hl?.getAttribute('data-highlight-id') || null;
                  if (hid) {
                    const mev = e as unknown as MouseEvent;
                    const rect = (mev && typeof mev.clientX === 'number')
                      ? { x: mev.clientX, y: mev.clientY }
                      : { x: 0, y: 0 };
                    setManageHighlightId(hid);
                    setManageTooltipPos({ x: rect.x, y: rect.y });
                    setShowManageTooltip(true);
                  }
                  // 点击的是划线元素，查找内部的链接
                  link = target.querySelector('a') as HTMLAnchorElement;
                  if (!link) {
                    // 如果划线元素本身没有链接，检查父级是否有链接
                    link = target.closest('a') as HTMLAnchorElement;
                  }
                } else {
                  // 正常查找链接
                  link = target.tagName === 'A' ? target as HTMLAnchorElement : target.closest('a') as HTMLAnchorElement;
                }
                
                if (link) {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  const href = link.getAttribute('href');
                  if (!href) return false;

                  console.log('🔗 Link clicked:', href, 'from highlight:', target.classList.contains('epub-highlight'));

                  // 检查是否是内部章节链接（相对路径或锚点）
                  if (href.startsWith('#') || !href.startsWith('http')) {
                    // 移除锚点，获取文件名
                    const cleanHref = href.split('#')[0];
                    
                    // 查找对应的章节
                    if (parser) {
                      const chapters = parser.getChapters();
                      const targetChapter = chapters.find(ch => {
                        // 完全匹配
                        if (ch.href === cleanHref || ch.href.endsWith(cleanHref)) return true;
                        // 文件名匹配
                        const chFileName = ch.href.split('/').pop();
                        const hrefFileName = cleanHref.split('/').pop();
                        return chFileName === hrefFileName;
                      });

                      if (targetChapter) {
                        console.log('✅ 跳转到章节:', targetChapter.title, targetChapter.id);
                        loadChapter(targetChapter.id);
                        return false;
                      } else {
                        console.warn('⚠️ 未找到对应章节:', cleanHref);
                      }
                    }
                  } else {
                    // 外部链接，阻止导航
                    console.log('🚫 阻止外部链接:', href);
                  }
                  
                  return false;
                }
              }}
            />
            
            {/* 划线提示框 */}
            {showHighlightTooltip && (
              <div
                className="highlight-tooltip"
                ref={tooltipRef}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="highlight-button"
                  onClick={handleCreateHighlight}
                  title="添加下划线"
                >
                  <span className="underline-icon">⎺</span>
                  <span>划线</span>
                </button>
                <button
                  className="highlight-button"
                  onClick={handleAddNote}
                  title="添加笔记"
                >
                  <span>📝</span>
                  <span>记笔记</span>
                </button>
                <button
                  className="highlight-button"
                  onClick={handleAIInspire}
                  title="AI 启发思考"
                >
                  <span>✨</span>
                  <span>AI 启发</span>
                </button>
              </div>
            )}
            
            {/* 管理已存在划线的 tooltip */}
            {showManageTooltip && manageHighlightId && (
              <div
                className="highlight-manage-tooltip"
                style={{ left: `${manageTooltipPos.x}px`, top: `${manageTooltipPos.y}px` }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="highlight-button danger"
                  onClick={async () => {
                    if (!storageRef.current || !contentRef.current || !highlightSystemRef.current) return;
                    const container = contentRef.current;
                    const hs = highlightSystemRef.current;
                    const toDeleteId = manageHighlightId;
                    // 进入抑制恢复窗口
                    suppressRestoreRef.current = true;
                    // 先同步更新 React 状态，防止观察器用旧数据恢复
                    flushSync(() => {
                      setHighlights((prev) => prev.filter((h) => h.id !== toDeleteId));
                    });
                    // 持久化删除
                    await storageRef.current.deleteHighlight(toDeleteId);
                    // 删除内存
                    hs.highlights.delete(toDeleteId);
                    // 展开并移除所有该高亮的 span 片段（保留文本）
                    const spans = container.querySelectorAll(`span.epub-highlight[data-highlight-id="${toDeleteId}"]`);
                    spans.forEach((spanEl) => {
                      const span = spanEl as HTMLElement;
                      const parent = span.parentNode;
                      if (!parent) return;
                      while (span.firstChild) parent.insertBefore(span.firstChild, span);
                      parent.removeChild(span);
                    });
                    // 移除关联的笔记块
                    const noteBlocks = container.querySelectorAll(`.highlight-note-block[data-highlight-id="${toDeleteId}"]`);
                    noteBlocks.forEach((n) => n.parentElement?.removeChild(n));
                    // 强制刷新当前章节的渲染（清空再按当前内存重绘，确保立即消失）
                    hs.renderHighlights(container, true);
                    hs.renderAllNotes(container);
                    // 同步虚拟渲染器
                    if (virtualRendererRef.current && currentChapter) {
                      const remaining = Array.from(hs.highlights.values()).filter((h) => (h as StoredHighlight).chapterId === currentChapter.id);
                      virtualRendererRef.current.setHighlights(remaining as Highlight[]);
                    }
                    // 关闭管理浮层
                    setShowManageTooltip(false);
                    setManageHighlightId(null);
                    // 读强制回流，确保浏览器立即应用渲染
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    container.offsetHeight;
                    // 退出抑制窗口
                    suppressRestoreRef.current = false;
                  }}
                >
                  删除划线
                </button>
                <button
                  className="highlight-button"
                  onClick={async () => {
                    if (!highlightSystemRef.current || !contentRef.current || !manageHighlightId) return;
                    const text = window.prompt('输入新增笔记内容：', '');
                    if (text === null) return;
                    const h = highlightSystemRef.current.highlights.get(manageHighlightId);
                    if (!h) return;
                    const now = Date.now();
                    const newNote = { id: `note-${now}-${Math.random().toString(36).slice(2,6)}`, content: text.trim(), createdAt: now, updatedAt: now };
                    const updated: StoredHighlight = { ...(h as StoredHighlight), notes: [...(h.notes || []), newNote] };
                    highlightSystemRef.current.highlights.set(manageHighlightId, updated);
                    highlightSystemRef.current.insertNoteAfterHighlight(manageHighlightId, contentRef.current);
                    if (storageRef.current) {
                      await storageRef.current.saveHighlight(updated);
                    }
                    setHighlights((prev) => {
                      const idx = prev.findIndex((x) => x.id === manageHighlightId);
                      if (idx === -1) return prev;
                      const next = [...prev];
                      next[idx] = updated;
                      return next;
                    });
                    setShowManageTooltip(false);
                    setManageHighlightId(null);
                  }}
                >
                  新增笔记
                </button>
                <button
                  className="highlight-button"
                  onClick={async () => {
                    if (!highlightSystemRef.current || !contentRef.current || !manageHighlightId) return;
                    const h = highlightSystemRef.current.highlights.get(manageHighlightId);
                    if (!h || !h.notes || h.notes.length === 0) {
                      alert('该划线暂无笔记');
                      return;
                    }
                    const summary = h.notes.map((n, i) => `${i + 1}. ${n.content}`).join('\n');
                    const input = window.prompt(`输入要修改/删除的笔记序号（1~${h.notes.length}），前缀 d 表示删除，例如 d2；直接输入新内容则为修改：\n${summary}`, '');
                    if (input === null) return;
                    const trimmed = input.trim();
                    let index = -1;
                    let mode: 'delete' | 'edit' = 'edit';
                    if (/^d\d+$/i.test(trimmed)) {
                      mode = 'delete';
                      index = parseInt(trimmed.slice(1), 10) - 1;
                    } else if (/^\d+$/.test(trimmed)) {
                      index = parseInt(trimmed, 10) - 1;
                    } else {
                      alert('输入格式不正确');
                      return;
                    }
                    if (index < 0 || index >= h.notes.length) {
                      alert('序号超出范围');
                      return;
                    }
                    const updated: StoredHighlight = { ...(h as StoredHighlight) };
                    if (mode === 'delete') {
                      updated.notes = [...h.notes.slice(0, index), ...h.notes.slice(index + 1)];
                    } else {
                      const newContent = window.prompt('输入新的笔记内容：', h.notes[index].content) || h.notes[index].content;
                      updated.notes = [...h.notes];
                      updated.notes[index] = { ...h.notes[index], content: newContent, updatedAt: Date.now() };
                    }
                    highlightSystemRef.current.highlights.set(manageHighlightId, updated);
                    // 重新插入笔记（先清除、再插入）
                    const oldNoteEls = contentRef.current.querySelectorAll(`.highlight-note-block[data-highlight-id="${manageHighlightId}"]`);
                    oldNoteEls.forEach(el => el.parentElement?.removeChild(el));
                    highlightSystemRef.current.insertNoteAfterHighlight(manageHighlightId, contentRef.current);
                    if (storageRef.current) {
                      await storageRef.current.saveHighlight(updated);
                    }
                    setHighlights((prev) => {
                      const idx = prev.findIndex((x) => x.id === manageHighlightId);
                      if (idx === -1) return prev;
                      const next = [...prev];
                      next[idx] = updated;
                      return next;
                    });
                    setShowManageTooltip(false);
                    setManageHighlightId(null);
                  }}
                >
                  管理笔记
                </button>
                <button
                  className="highlight-button"
                  onClick={() => {
                    setShowManageTooltip(false);
                    setManageHighlightId(null);
                  }}
                >
                  关闭
                </button>
              </div>
            )}
            
            {/* 翻页按钮 */}
            <div className="chapter-navigation">
              <button
                className="nav-button prev-button"
                onClick={goToPreviousChapter}
                disabled={!currentChapter || chapters.findIndex(ch => ch.id === currentChapter.id) === 0}
                title="上一章 (← 或 ↑)"
              >
                <span>←</span>
                <span>上一章</span>
              </button>
              
              <div className="chapter-info">
                {(() => {
                  const currentIndex = chapters.findIndex(ch => ch.id === currentChapter.id);
                  return `${currentIndex + 1} / ${chapters.length}`;
                })()}
              </div>
              
              <button
                className="nav-button next-button"
                onClick={goToNextChapter}
                disabled={!currentChapter || chapters.findIndex(ch => ch.id === currentChapter.id) === chapters.length - 1}
                title="下一章 (→ 或 ↓)"
              >
                <span>下一章</span>
                <span>→</span>
              </button>
            </div>
          </>
        )}

        {showAnalysis && (
          <div
            className="ai-analysis-draggable"
            style={{ left: `${aiPanelPos.x}px`, top: `${aiPanelPos.y}px` }}
            onMouseDown={(e) => {
              const target = e.target as HTMLElement;
              if (target.classList.contains('ai-drag-handle')) {
                aiDragRef.current.dragging = true;
                aiDragRef.current.offsetX = e.clientX - aiPanelPos.x;
                aiDragRef.current.offsetY = e.clientY - aiPanelPos.y;
                e.preventDefault();
              }
            }}
            onMouseMove={(e) => {
              if (aiDragRef.current.dragging) {
                setAiPanelPos({
                  x: e.clientX - aiDragRef.current.offsetX,
                  y: e.clientY - aiDragRef.current.offsetY,
                });
              }
            }}
            onMouseUp={() => {
              aiDragRef.current.dragging = false;
            }}
            onMouseLeave={() => {
              aiDragRef.current.dragging = false;
            }}
          >
            <div className="ai-panel-header ai-drag-handle">
              <div className="ai-title">AI 分析</div>
              <button
                className="ai-close"
                onClick={() => setShowAnalysis(false)}
                title="关闭"
              >
                ×
              </button>
            </div>
            <div className="ai-panel-body">
              {aiStreamingText ? (
                <pre className="ai-stream">{aiStreamingText}</pre>
              ) : aiAnalysis ? (
                <>
                  <div className="analysis-section">
                    <h3>摘要</h3>
                    <p>{aiAnalysis.summary}</p>
                  </div>
                  <div className="analysis-section">
                    <h3>洞察</h3>
                    <ul>
                      {aiAnalysis.insights.map((insight, index) => (
                        <li key={index}>{insight}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="analysis-section">
                    <h3>启发式问题</h3>
                    <ul>
                      {aiAnalysis.questions.map((question, index) => (
                        <li key={index}>{question}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="analysis-section">
                    <h3>知识关联</h3>
                    <ul>
                      {aiAnalysis.connections.map((connection, index) => (
                        <li key={index}>{connection}</li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <div className="analysis-loading">分析生成中...</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
