import { useState, useEffect, useRef, useCallback } from 'react';
import type { EpubChapter } from '../parse/Parse';
import type { Highlight } from '../highlight/HighlightSystem';
import type { StoredHighlight } from '../storage/StorageManager';
import { EpubParser } from '../parse/Parse';
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
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const highlightSystemRef = useRef<HighlightSystem | null>(null);
  const virtualRendererRef = useRef<VirtualHighlightRenderer | null>(null);
  const storageRef = useRef<StorageManager | null>(null);
  const scrollObserverCleanupRef = useRef<(() => void) | null>(null);

  const loadChapter = useCallback(async (chapterId: string, epubParser?: EpubParser) => {
    const parserToUse = epubParser || parser;
    if (!parserToUse) return;

    setLoading(true);
    try {
      const chapter = parserToUse.getChapter(chapterId);
      if (!chapter) return;

      setCurrentChapter(chapter);
      const content = await parserToUse.loadChapter(chapterId);
      setChapterContent(content);

      // 渲染已保存的划线（使用虚拟滚动优化）
      if (virtualRendererRef.current && contentRef.current) {
        // 使用函数式更新来获取最新的 highlights，避免依赖
        setHighlights((currentHighlights) => {
          const chapterHighlights = currentHighlights.filter(
            (h) => h.position.elementPath.includes(chapterId)
          );
          virtualRendererRef.current?.setHighlights(chapterHighlights);
          return currentHighlights; // 不改变状态，只是用来获取最新值
        });
        
        // 设置虚拟滚动观察器
        if (scrollObserverCleanupRef.current) {
          scrollObserverCleanupRef.current();
        }
        scrollObserverCleanupRef.current = createVirtualScrollObserver(
          contentRef.current,
          virtualRendererRef.current,
          document
        );
      }
    } catch (error) {
      console.error('Failed to load chapter:', error);
    } finally {
      setLoading(false);
    }
  }, [parser]);

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

        // 初始化虚拟渲染器
        const virtualRenderer = new VirtualHighlightRenderer(highlightSystem);
        virtualRendererRef.current = virtualRenderer;

        // AI 助手现在通过后端 API 调用，无需初始化

        // 加载 EPUB
        const epubParser = new EpubParser();
        await epubParser.load(file);
        setParser(epubParser);

        const chapters = epubParser.getChapters();
        setChapters(chapters);

        if (chapters.length > 0) {
          await loadChapter(chapters[0].id, epubParser);
        }

        // 加载已保存的划线
        const savedHighlights = await storage.getHighlightsByBook(bookId);
        // 转换 StoredHighlight 为 Highlight（去掉 bookId 和 chapterId）
        setHighlights(savedHighlights);
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

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    if (highlightSystemRef.current && storageRef.current && currentChapter) {
      const highlight = highlightSystemRef.current.createHighlight(
        selection,
        document,
        '#ffeb3b'
      );

      if (highlight) {
        setHighlights([...highlights, highlight]);

        // 保存到 IndexedDB（添加 bookId 和 chapterId）
        const storedHighlight: StoredHighlight = {
          ...highlight,
          bookId,
          chapterId: currentChapter.id,
        };
        storageRef.current.saveHighlight(storedHighlight);

        // 清除选择
        selection.removeAllRanges();
      }
    }
  };

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
          {chapters.map((chapter) => (
            <li
              key={chapter.id}
              className={currentChapter?.id === chapter.id ? 'active' : ''}
              onClick={() => loadChapter(chapter.id)}
            >
              {chapter.title}
            </li>
          ))}
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
              {highlights.map((highlight) => (
                <li key={highlight.id}>
                  <div className="highlight-text">{highlight.text}</div>
                  {highlight.note && (
                    <div className="highlight-note">{highlight.note}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="read-content">
        {currentChapter && (
          <>
            <div className="chapter-header">
              <h1>{currentChapter.title}</h1>
            </div>
            <div
              ref={contentRef}
              className="chapter-content"
              dangerouslySetInnerHTML={{ __html: chapterContent }}
              onMouseUp={handleTextSelection}
            />
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
