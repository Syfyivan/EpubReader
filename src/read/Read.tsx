import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { EpubChapter } from '../parse/parse';
import type { Highlight, HighlightPosition } from '../highlight/HighlightSystem';
import type { StoredHighlight } from '../storage/StorageManager';
import { EpubParser } from '../parse/parse';
import { HighlightSystem } from '../highlight/HighlightSystem';
import { VirtualHighlightRenderer, createVirtualScrollObserver } from '../highlight/VirtualHighlightRenderer';
import { StorageManager } from '../storage/StorageManager';
import { aiClient, type AIAnalysis } from '../api/aiClient';
import './Read.css';

interface ReadProps {
  file: File | string;
  bookId: string;
}

export default function Read({ file, bookId }: ReadProps) {
  const [parser, setParser] = useState<EpubParser | null>(null);
  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<EpubChapter | null>(null);
  const [chapterContent, setChapterContent] = useState<string>('');
  const [chapterRenderKey, setChapterRenderKey] = useState<number>(0); // 强制重新渲染的key
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightChapterMap, setHighlightChapterMap] = useState<Map<string, string>>(new Map()); // 存储 highlightId -> chapterId 的映射
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  
  // 划线提示框状态
  const [showHighlightTooltip, setShowHighlightTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  
  // 使用 ref 保存 range 数据，避免 React 重新渲染导致的问题
  interface RangeData {
    range: Range;
    position: HighlightPosition;
  }
  const selectedRangeDataRef = useRef<RangeData | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const highlightSystemRef = useRef<HighlightSystem | null>(null);
  const virtualRendererRef = useRef<VirtualHighlightRenderer | null>(null);
  const storageRef = useRef<StorageManager | null>(null);
  const scrollObserverCleanupRef = useRef<(() => void) | null>(null);
  const selectionIntervalRef = useRef<number | null>(null); // 用于保持选中文本高亮的定时器
  const selectionRAFRef = useRef<number | null>(null); // 用于保持选中文本高亮的 RAF
  const stickySelectionRef = useRef<HTMLSpanElement | null>(null); // 粘性高亮（旧方案兜底）
  const tempSelectionRef = useRef<HTMLSpanElement | null>(null); // 临时高亮（虚拟选区可视化）
  const removeStickySelection = useCallback(() => {
    if (stickySelectionRef.current && stickySelectionRef.current.parentNode) {
      const wrap = stickySelectionRef.current;
      const parent = wrap.parentNode as Node;
      while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
      parent.removeChild(wrap);
      stickySelectionRef.current = null;
    }
  }, []);

  // 临时高亮（跨文本节点）：对 Range 覆盖的每个文本片段进行 splitText 包装
  const applyTemporaryHighlight = useCallback((range: Range): HTMLSpanElement | null => {
    if (!contentRef.current) return null;
    // 先移除旧的临时高亮
    const cleanup = () => {
      if (!contentRef.current) return;
      const olds = contentRef.current.querySelectorAll('span.temporary-selection');
      olds.forEach(el => {
        const parent = el.parentNode as Node;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      });
      tempSelectionRef.current = null;
    };
    cleanup();

    const container = contentRef.current;
    const createdSpans: HTMLSpanElement[] = [];

    // 遍历容器中的文本节点，找到与 range 相交的片段
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let node: Node | null = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      if (textNode.length > 0) {
        // 判断该文本节点是否与 range 相交
        let start = 0;
        let end = textNode.length;
        // 如果文本节点在选区之前，comparePoint 会抛错，使用 try/catch
        try {
          const atStart = range.startContainer === textNode;
          const atEnd = range.endContainer === textNode;
          if (atStart || atEnd || range.intersectsNode(textNode)) {
            if (atStart) start = range.startOffset;
            if (atEnd) end = range.endOffset;
            // 规范化范围
            start = Math.max(0, Math.min(start, textNode.length));
            end = Math.max(0, Math.min(end, textNode.length));
            if (end > start) {
              // splitText: [0,start)[start,start+len)[after...]
              const first = start > 0 ? textNode.splitText(start) : textNode;
              const len = end - start;
              const middle = len < first.length ? first.splitText(len) : null;
              const target = middle ? first : first; // first 即选中片段
              const span = document.createElement('span');
              span.className = 'temporary-selection';
              target.parentNode?.insertBefore(span, target);
              span.appendChild(target);
              createdSpans.push(span);
              // 修正 walker 位置（避免跳过）
            }
          }
        } catch {
          // 忽略无法比较的节点
        }
      }
      node = walker.nextNode();
    }

    if (createdSpans.length === 0) return null;
    // 缓存第一个 span 作为定位参考
    tempSelectionRef.current = createdSpans[0];
    return createdSpans[0];
  }, []);

  const removeTemporaryHighlight = useCallback(() => {
    if (!contentRef.current) return;
    const spans = contentRef.current.querySelectorAll('span.temporary-selection');
    spans.forEach(span => {
      const parent = span.parentNode as Node;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    });
    tempSelectionRef.current = null;
  }, []);

  const loadChapter = useCallback(async (chapterId: string, epubParser?: EpubParser) => {
    const parserToUse = epubParser || parser;
    if (!parserToUse) {
      console.warn('Parser not ready, cannot load chapter:', chapterId);
      return;
    }

    console.log('🔄 Loading chapter:', chapterId);
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
  }, [parser, chapterRenderKey]);

  // 恢复划线的函数（提取出来，供多个地方使用）
  const restoreAllHighlights = useCallback(() => {
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
    }
  }, [chapterContent, currentChapter, restoreAllHighlights, highlights]);

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
      // 检查是否有文本内容，确保 DOM 已渲染
      if (contentRef.current && contentRef.current.textContent && contentRef.current.textContent.trim().length > 0) {
        // 检查是否已有划线，如果数量不对就恢复
        const existingHighlights = contentRef.current.querySelectorAll('span.epub-highlight');
        
        // 如果划线数量少于应该有的数量，立即恢复
        if (existingHighlights.length < chapterHighlights.length) {
          console.log(`⚠️ 检测到划线被清除，当前 ${existingHighlights.length} 个，应该 ${chapterHighlights.length} 个，立即恢复`);
          restoreAllHighlights();
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
  }, [chapterContent, currentChapter, restoreAllHighlights, highlights]);

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
        const storage = new StorageManager();
        await storage.init();
        storageRef.current = storage;

        // 初始化划线系统
        const highlightSystem = new HighlightSystem();
        highlightSystemRef.current = highlightSystem;
        
        // 等待DOM渲染后设置container
        setTimeout(() => {
          if (contentRef.current && highlightSystemRef.current) {
            highlightSystemRef.current.setContainer(contentRef.current);
          }
        }, 100);

        // 初始化虚拟渲染器
        const virtualRenderer = new VirtualHighlightRenderer(highlightSystem);
        virtualRendererRef.current = virtualRenderer;

        // AI 助手现在通过后端 API 调用，无需初始化

        // 加载 EPUB
        const epubParser = new EpubParser();
        await epubParser.load(file);
        setParser(epubParser);

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
          await loadChapter(chapters[0].id, epubParser);
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

  // 已不再需要第一行定位的辅助方法（保留位置以便后续扩展）

  // 处理文本选择，显示划线提示框
  const handleTextSelection = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
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
      // 设置容器
      highlightSystemRef.current.setContainer(contentRef.current);
      
      // 序列化 range
      const position = highlightSystemRef.current.serializeRange(range, contentRef.current);
      if (!position) {
        console.warn('⚠️ 无法序列化 range');
        setShowHighlightTooltip(false);
        selectedRangeDataRef.current = null;
        return;
      }

      // 保存序列化的 position 和原始的 range（作为备份）
      // 使用一个对象同时保存两者
      const rangeData: RangeData = {
        range: range.cloneRange(),
        position: position,
      };
      
      // 使用 ref 保存，避免 React 状态更新导致的问题
      selectedRangeDataRef.current = rangeData;

      console.log('✅ 保存选中范围，文本:', text.substring(0, 30));

      // 保持选中文本高亮：持续检查并重新应用选择
      // 先清理之前的定时器和 RAF（如果有）
      if (selectionIntervalRef.current) {
        clearInterval(selectionIntervalRef.current);
        selectionIntervalRef.current = null;
      }
      if (selectionRAFRef.current) {
        cancelAnimationFrame(selectionRAFRef.current);
        selectionRAFRef.current = null;
      }
      
      // 立即设置选择状态，确保高亮显示
      const currentSelection = window.getSelection();
      if (currentSelection && range) {
        try {
          currentSelection.removeAllRanges();
          currentSelection.addRange(range.cloneRange());
        } catch (e) {
          console.warn('⚠️ 设置选择状态失败:', e);
        }
      }
      
      // 保存 range 的副本，用于持续恢复
      const savedRange = range.cloneRange();
      
      // 立即创建“临时高亮”（替代原生选区视觉），并清空原生 selection，避免后续干扰
      const tempWrapper = applyTemporaryHighlight(savedRange);
      try {
        selection.removeAllRanges();
      } catch { /* noop */ }

      // 使用 requestAnimationFrame 来更及时地保持选择（每帧检查，约 60fps）
      const keepSelectionWithRAF = () => {
        const sel = window.getSelection();
        // 检查提示框是否仍然显示
        if (sel && savedRange && selectedRangeDataRef.current) {
          // 检查当前选择是否有效
          let needsRestore = false;
          
          if (sel.rangeCount === 0) {
            // 选择被完全清除
            needsRestore = true;
          } else {
            // 检查选择是否匹配
            try {
              const currentRange = sel.getRangeAt(0);
              const currentText = currentRange.toString();
              const savedText = savedRange.toString();
              
              // 如果文本不匹配，或者 range 的边界不匹配，需要恢复
              if (currentText !== savedText) {
                needsRestore = true;
              } else {
                // 检查边界节点是否匹配
                if (currentRange.startContainer !== savedRange.startContainer ||
                    currentRange.startOffset !== savedRange.startOffset ||
                    currentRange.endContainer !== savedRange.endContainer ||
                    currentRange.endOffset !== savedRange.endOffset) {
                  needsRestore = true;
                }
              }
            } catch {
              needsRestore = true;
            }
          }
          
          // 如果需要恢复，立即恢复
          if (needsRestore) {
            try {
              sel.removeAllRanges();
              // 验证 savedRange 的节点是否仍在 DOM 中
              if (document.contains(savedRange.startContainer) && 
                  document.contains(savedRange.endContainer)) {
                sel.addRange(savedRange.cloneRange());
              } else {
                // 如果节点不在 DOM 中，尝试从 position 恢复
                if (selectedRangeDataRef.current?.position && highlightSystemRef.current && contentRef.current) {
                  const restoredRange = highlightSystemRef.current.restoreRange(
                    selectedRangeDataRef.current.position,
                    contentRef.current
                  );
                  if (restoredRange && !restoredRange.collapsed) {
                    sel.addRange(restoredRange);
                  }
                }
              }
            } catch {
              // 选择可能已被清除，忽略错误
            }
          }
          
          // 继续下一帧检查
          selectionRAFRef.current = requestAnimationFrame(keepSelectionWithRAF);
        } else {
          // 如果提示框已关闭，停止 RAF
          if (selectionRAFRef.current) {
            cancelAnimationFrame(selectionRAFRef.current);
            selectionRAFRef.current = null;
          }
        }
      };
      
      // 启动 RAF 循环，持续保持选中文本高亮
      selectionRAFRef.current = requestAnimationFrame(keepSelectionWithRAF);
      
      // 同时使用 setInterval 作为备用机制（每 100ms 检查一次）
      const keepSelectionAlive = () => {
        const sel = window.getSelection();
        if (sel && savedRange && selectedRangeDataRef.current) {
          if (sel.rangeCount === 0) {
            try {
              // 验证节点是否仍在 DOM 中
              if (document.contains(savedRange.startContainer) && 
                  document.contains(savedRange.endContainer)) {
                sel.addRange(savedRange.cloneRange());
              }
            } catch {
              // 忽略错误
            }
          }
        } else {
          // 如果提示框已关闭，清理定时器和 RAF
          if (selectionIntervalRef.current) {
            clearInterval(selectionIntervalRef.current);
            selectionIntervalRef.current = null;
          }
          if (selectionRAFRef.current) {
            cancelAnimationFrame(selectionRAFRef.current);
            selectionRAFRef.current = null;
          }
        }
      };
      
      // 启动定时器作为备用机制
      selectionIntervalRef.current = setInterval(keepSelectionAlive, 100);
      
      // 30秒后自动清理定时器和 RAF（防止内存泄漏）
      setTimeout(() => {
        if (selectionIntervalRef.current) {
          clearInterval(selectionIntervalRef.current);
          selectionIntervalRef.current = null;
        }
        if (selectionRAFRef.current) {
          cancelAnimationFrame(selectionRAFRef.current);
          selectionRAFRef.current = null;
        }
        // 超时后移除粘性选择
        if (stickySelectionRef.current && stickySelectionRef.current.parentNode) {
          const wrap = stickySelectionRef.current;
          const parent = wrap.parentNode as Node;
          while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
          parent.removeChild(wrap);
          stickySelectionRef.current = null;
        }
      }, 30000);

      // 优化 tooltip 定位逻辑：优先使用临时高亮的包裹元素几何信息
      const baseRect: DOMRect = tempWrapper
        ? (tempWrapper.getBoundingClientRect() as DOMRect)
        : ((range.getClientRects().length > 0 ? (range.getClientRects()[0] as DOMRect) : (range.getBoundingClientRect() as DOMRect)));
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      
      const TOOLTIP_OFFSET = 10; // tooltip 距离划线第一行的固定距离（像素）
      
      let tooltipX: number;
      // 垂直方向由 tooltipYConst 计算
      
      // 判断是否占满一行（宽度接近容器宽度）
      const containerWidth = contentRef.current?.clientWidth || window.innerWidth;
      const isFullLine = baseRect.width >= containerWidth * 0.9;
      
      if (isFullLine) {
        // 如果占满一行，水平位置固定在屏幕中心
        tooltipX = scrollLeft + window.innerWidth / 2;
      } else {
        // 否则保持在勾选区域中心
        tooltipX = baseRect.left + scrollLeft + baseRect.width / 2;
      }
      
      // 垂直方向：在所选文本的上方固定距离
      const tooltipYConst = baseRect.top + scrollTop - TOOLTIP_OFFSET;

      setTooltipPosition({ x: tooltipX, y: tooltipYConst });

      setShowHighlightTooltip(true);
    } catch (error) {
      console.error('❌ 保存选中范围时出错:', error);
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
    }
  }, []);

  // 渲染后自动恢复临时高亮（防止组件重渲染把 DOM 包裹清掉）
  useEffect(() => {
    if (!showHighlightTooltip || !contentRef.current || !highlightSystemRef.current) return;
    if (!selectedRangeDataRef.current) return;
    try {
      // 先移除可能被清空/半残留的临时高亮
      removeTemporaryHighlight();
      // 用 XPath 反序列化 range
      const restored = highlightSystemRef.current.restoreRange(
        selectedRangeDataRef.current.position,
        contentRef.current
      );
      if (restored && !restored.collapsed) {
        applyTemporaryHighlight(restored);
      }
    } catch {
      // 忽略恢复失败
    }
  }, [chapterContent, chapterRenderKey, showHighlightTooltip, removeTemporaryHighlight, applyTemporaryHighlight]);

  // 创建划线
  const handleCreateHighlight = useCallback(() => {
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

      // 清理定时器和 RAF（划线已创建，不再需要保持选中状态）
      if (selectionIntervalRef.current) {
        clearInterval(selectionIntervalRef.current);
        selectionIntervalRef.current = null;
      }
      if (selectionRAFRef.current) {
        cancelAnimationFrame(selectionRAFRef.current);
        selectionRAFRef.current = null;
      }
      
      // 清除选择和提示框
      selection.removeAllRanges();
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
      // 移除粘性选择
      removeStickySelection();
      // 移除临时高亮
      removeTemporaryHighlight();
    }
  }, [currentChapter, bookId, restoreAllHighlights, removeStickySelection, removeTemporaryHighlight]);

  // 在 tooltip 展示期间，监听 selection 变化并强制保持选区不消失
  useEffect(() => {
    const handleSelectionChange = () => {
      // 仅在我们已有保存的 range 且 tooltip 仍显示时处理
      if (!selectedRangeDataRef.current || !showHighlightTooltip) return;
      const sel = window.getSelection();
      const saved = selectedRangeDataRef.current.range;
      if (!sel) return;
      try {
        const needRestore =
          sel.rangeCount === 0 ||
          sel.getRangeAt(0).toString() !== saved.toString();
        if (needRestore) {
          // 如果原生 selection 消失，则兜底创建“粘性高亮”
          if ((!sel || sel.rangeCount === 0) && contentRef.current) {
            // 先移除旧的粘性选择
            if (stickySelectionRef.current && stickySelectionRef.current.parentNode) {
              const wrap = stickySelectionRef.current;
              const parent = wrap.parentNode as Node;
              while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
              parent.removeChild(wrap);
              stickySelectionRef.current = null;
            }
            try {
              const wrapper = document.createElement('span');
              wrapper.className = 'sticky-selection';
              const tryRange = saved.cloneRange();
              try {
                tryRange.surroundContents(wrapper);
              } catch {
                const contents = tryRange.cloneContents();
                wrapper.appendChild(contents);
                tryRange.deleteContents();
                tryRange.insertNode(wrapper);
              }
              stickySelectionRef.current = wrapper;
            } catch {
              // 忽略粘性选择失败
            }
          }
          // 验证节点仍在 DOM 中；否则尝试用 position 恢复
          if (document.contains(saved.startContainer) && document.contains(saved.endContainer)) {
            sel.removeAllRanges();
            sel.addRange(saved.cloneRange());
          } else if (selectedRangeDataRef.current.position && highlightSystemRef.current && contentRef.current) {
            const restored = highlightSystemRef.current.restoreRange(
              selectedRangeDataRef.current.position,
              contentRef.current
            );
            if (restored && !restored.collapsed) {
              sel.removeAllRanges();
              sel.addRange(restored);
            }
          }
        }
      } catch {
        // 忽略偶发错误
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [showHighlightTooltip, removeStickySelection, removeTemporaryHighlight]);

  // 点击外部区域关闭提示框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showHighlightTooltip) {
        const target = e.target as HTMLElement;
        if (!target.closest('.highlight-tooltip') && !target.closest('.epub-highlight')) {
          // 清理定时器和 RAF
          if (selectionIntervalRef.current) {
            clearInterval(selectionIntervalRef.current);
            selectionIntervalRef.current = null;
          }
          if (selectionRAFRef.current) {
            cancelAnimationFrame(selectionRAFRef.current);
            selectionRAFRef.current = null;
          }
          setShowHighlightTooltip(false);
          selectedRangeDataRef.current = null;
          window.getSelection()?.removeAllRanges();
          // 移除粘性选择
          removeStickySelection();
          // 移除临时高亮
          removeTemporaryHighlight();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHighlightTooltip, removeStickySelection, removeTemporaryHighlight]);

  const handleAnalyzeContent = async () => {
    if (!currentChapter) return;

    setLoading(true);
    try {
      const analysis = await aiClient.analyzeContent(chapterContent);
      setAiAnalysis(analysis);
      setShowAnalysis(true);
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

  if (loading && !parser) {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="read-container">
      <div className="read-sidebar">
        <h2>目录</h2>
        <ul className="chapter-list">
          {chapters
            .filter(chapter => chapter.title && chapter.title.trim().length > 0) // 再次过滤，确保不显示空标题
            .map((chapter, index) => {
              const level = chapter.level || 0;
              const paddingLeft = level * 20; // 每级缩进20px
              
              return (
                <li
                  key={`${chapter.id}-${index}`}
                  className={currentChapter?.id === chapter.id ? 'active' : ''}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('📖 TOC Chapter clicked:', chapter.id, chapter.title);
                    if (parser) {
                      console.log('🔄 Calling loadChapter for:', chapter.id);
                      loadChapter(chapter.id);
                    } else {
                      console.error('❌ Parser not initialized yet');
                    }
                  }}
                  style={{ 
                    cursor: 'pointer',
                    paddingLeft: `${paddingLeft}px`,
                    fontWeight: level === 0 ? 'bold' : 'normal',
                    fontSize: level === 0 ? '1em' : level === 1 ? '0.95em' : '0.9em',
                  }}
                >
                  <span>{chapter.title}</span>
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

        {highlights.length > 0 && (
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
                    style={{ cursor: chapterId ? 'pointer' : 'default' }}
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
        )}
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
            
            {/* 划线提示框（使用 Portal 渲染到 body，避免影响正文 DOM） */}
            {showHighlightTooltip &&
              createPortal(
                <div
                  className="highlight-tooltip"
                  style={{
                    position: 'fixed',
                    left: `${tooltipPosition.x}px`,
                    top: `${tooltipPosition.y}px`,
                    transform: 'translateX(-50%)',
                    zIndex: 10000,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                >
                  {/* 评论/注释组 */}
                  <div className="tooltip-group">
                    <button className="tooltip-button" title="评论" onMouseDown={(e) => e.preventDefault()}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2.5a1 1 0 0 1 .8.4l1.5 1.5a.5.5 0 0 0 .8-.4v-1a1 1 0 0 1 .4-.8l1.5-1.5H14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H2z"/>
                      </svg>
                      <span>评论</span>
                    </button>
                    <button className="tooltip-button" title="添加表情" onMouseDown={(e) => e.preventDefault()}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                        <path d="M4.285 9.567a.5.5 0 0 1 .683.183A3.498 3.498 0 0 0 8 11.5a3.498 3.498 0 0 0 3.032-1.75.5.5 0 1 1 .866.5A4.498 4.498 0 0 1 8 12.5a4.498 4.498 0 0 1-3.898-2.25.5.5 0 0 1 .183-.683zM7 6.5C7 7.328 6.552 8 6 8s-1-.672-1-1.5S5.448 5 6 5s1 .672 1 1.5zm4 0c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S9.448 5 10 5s1 .672 1 1.5z"/>
                      </svg>
                    </button>
                    <button className="tooltip-button" title="绘图" onMouseDown={(e) => e.preventDefault()}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
                      </svg>
                    </button>
                  </div>

                  <div className="tooltip-separator"></div>

                  {/* 代码组 */}
                  <div className="tooltip-group">
                    <button className="tooltip-button" title="代码" onMouseDown={(e) => e.preventDefault()}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8l-3.147-3.146z"/>
                      </svg>
                      <span>代码</span>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 9L1 4l1.5-1.5L6 6l3.5-3.5L11 4z"/>
                      </svg>
                    </button>
                  </div>

                  <div className="tooltip-separator"></div>

                  {/* 格式化组 */}
                  <div className="tooltip-group">
                    <button className="tooltip-button" title="粗体" onMouseDown={(e) => e.preventDefault()}>
                      <strong>B</strong>
                    </button>
                    <button className="tooltip-button" title="斜体" onMouseDown={(e) => e.preventDefault()}>
                      <em>I</em>
                    </button>
                    <button className="tooltip-button" title="下划线" onMouseDown={(e) => e.preventDefault()}>
                      <u>U</u>
                    </button>
                    <button className="tooltip-button" title="删除线" onMouseDown={(e) => e.preventDefault()}>
                      <s>S</s>
                    </button>
                    <button className="tooltip-button" title="数学公式" onMouseDown={(e) => e.preventDefault()}>
                      <span>√x</span>
                    </button>
                    <button className="tooltip-button" title="链接" onMouseDown={(e) => e.preventDefault()}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 0 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
                        <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-1.829 1.828a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
                      </svg>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 9L1 4l1.5-1.5L6 6l3.5-3.5L11 4z"/>
                      </svg>
                    </button>
                  </div>

                  <div className="tooltip-separator"></div>

                  {/* 颜色/更多选项组 */}
                  <div className="tooltip-group">
                    <button className="tooltip-button" title="颜色" onMouseDown={(e) => e.preventDefault()}>
                      <span className="color-icon">A</span>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 9L1 4l1.5-1.5L6 6l3.5-3.5L11 4z"/>
                      </svg>
                    </button>
                    <div className="tooltip-separator-vertical"></div>
                    <button className="tooltip-button" title="更多" onMouseDown={(e) => e.preventDefault()}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
                      </svg>
                    </button>
                  </div>

                  <div className="tooltip-separator"></div>

                  {/* 划线按钮 */}
                  <button
                    className="highlight-button"
                    onClick={handleCreateHighlight}
                    onMouseDown={(e) => e.preventDefault()}
                    title="添加下划线"
                  >
                    <span className="underline-icon">⎺</span>
                    <span>划线</span>
                  </button>
                </div>,
                document.body
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

        {showAnalysis && aiAnalysis && (
          <div className="ai-analysis">
            <h2>AI 分析</h2>
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
            <button onClick={() => setShowAnalysis(false)}>关闭</button>
          </div>
        )}
      </div>
    </div>
  );
}
