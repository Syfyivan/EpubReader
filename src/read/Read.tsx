import { useState, useEffect, useRef, useCallback } from 'react';
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

  // 监听章节内容变化，自动恢复划线
  useEffect(() => {
    if (!chapterContent || !currentChapter || !contentRef.current || !highlightSystemRef.current) {
      return;
    }

    // 延迟执行，确保 dangerouslySetInnerHTML 已完成
    const timer = setTimeout(() => {
      if (contentRef.current && highlightSystemRef.current) {
        // 获取当前章节的所有划线
        const chapterHighlights = highlights.filter((h) => {
          const stored = h as StoredHighlight;
          return stored.chapterId === currentChapter.id;
        });

        if (chapterHighlights.length > 0) {
          console.log(`🔄 章节内容更新，恢复 ${chapterHighlights.length} 个划线`);
          
          // 设置容器
          highlightSystemRef.current.setContainer(contentRef.current);
          
          // 清空并重新添加划线
          highlightSystemRef.current.highlights.clear();
          chapterHighlights.forEach((h) => {
            highlightSystemRef.current!.highlights.set(h.id, h);
          });
          
          // 渲染划线（不清除已有划线，避免闪现）
          highlightSystemRef.current.renderHighlights(contentRef.current, false);
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [chapterContent, currentChapter, highlights]);

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

      // 计算提示框位置（在选择文本的下方）
      const rect = range.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

      setTooltipPosition({
        x: rect.left + scrollLeft + rect.width / 2,
        y: rect.bottom + scrollTop + 10,
      });

      setShowHighlightTooltip(true);
    } catch (error) {
      console.error('❌ 保存选中范围时出错:', error);
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
    }
  }, []);

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

      // 保存到 IndexedDB
      storageRef.current.saveHighlight(storedHighlight);
      console.log(`💾 已保存到 IndexedDB: ${highlight.id}`);
      
      // 不需要重新渲染，因为已经通过 wrapRangeWithHighlight 直接应用了样式
      // 如果重新渲染会清除刚创建的划线，导致闪现

      // 清除选择和提示框
      selection.removeAllRanges();
      setShowHighlightTooltip(false);
      selectedRangeDataRef.current = null;
    }
  }, [currentChapter, bookId]);

  // 点击外部区域关闭提示框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showHighlightTooltip) {
        const target = e.target as HTMLElement;
        if (!target.closest('.highlight-tooltip') && !target.closest('.epub-highlight')) {
          setShowHighlightTooltip(false);
          selectedRangeDataRef.current = null;
          window.getSelection()?.removeAllRanges();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHighlightTooltip]);

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
            
            {/* 划线提示框 */}
            {showHighlightTooltip && (
              <div
                className="highlight-tooltip"
                style={{
                  position: 'absolute',
                  left: `${tooltipPosition.x}px`,
                  top: `${tooltipPosition.y}px`,
                  transform: 'translateX(-50%)',
                  zIndex: 1000,
                }}
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
