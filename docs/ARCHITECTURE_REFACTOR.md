# 架构重构说明

## 新的架构设计

### 核心组件

1. **UnifiedHighlightManager** (`src/highlight/UnifiedHighlightManager.ts`)
   - 统一管理划线状态和DOM操作
   - 解决状态管理与DOM操作冲突的问题
   - 提供完整的CRUD操作

2. **useHighlighter Hook** (`src/hooks/useHighlighter.ts`)
   - 简化React集成
   - 自动处理持久化
   - 提供类型安全的API

3. **SmartTooltipPositioner** (`src/highlight/SmartTooltipPositioner.ts`)
   - 智能计算tooltip位置
   - 支持占满一行时的居中显示

4. **CrossParagraphHighlighter** (`src/highlight/CrossParagraphHighlighter.ts`)
   - 处理跨段落划线
   - 支持多段落选区

5. **SmartTooltip** (`src/components/SmartTooltip.tsx`)
   - 智能工具提示组件
   - 根据是否存在划线显示不同选项

## 使用示例

### 在 Read.tsx 中使用新架构

```typescript
import { useHighlighter } from '../hooks/useHighlighter';
import { SmartTooltip } from '../components/SmartTooltip';
import { SmartTooltipPositioner } from '../highlight/SmartTooltipPositioner';
import { StorageManager } from '../storage/StorageManager';

export default function Read({ file, bookId }: ReadProps) {
  const [parser, setParser] = useState<EpubParser | null>(null);
  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<EpubChapter | null>(null);
  const [chapterContent, setChapterContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  
  // 初始化存储管理器
  const storageManagerRef = useRef<StorageManager | null>(null);
  useEffect(() => {
    const init = async () => {
      const storage = new StorageManager();
      await storage.init();
      storageManagerRef.current = storage;
    };
    init();
  }, []);

  // 使用简化的划线Hook
  const {
    highlights,
    createHighlight,
    removeHighlight,
    setContainer,
    contentRef,
  } = useHighlighter({
    bookId,
    storageManager: storageManagerRef.current!,
  });

  // 工具提示状态
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [selectedRange, setSelectedRange] = useState<Range | null>(null);
  const [existingHighlight, setExistingHighlight] = useState<StoredHighlight | null>(null);

  // 文本选择处理
  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setShowTooltip(false);
      setSelectedRange(null);
      setExistingHighlight(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const text = range.toString().trim();

    if (!text || !contentRef.current?.contains(range.commonAncestorContainer)) {
      setShowTooltip(false);
      setSelectedRange(null);
      setExistingHighlight(null);
      return;
    }

    setSelectedRange(range);

    // 检查是否已存在划线
    const existing = findExistingHighlight(range, highlights);
    setExistingHighlight(existing);

    // 计算tooltip位置
    if (contentRef.current) {
      const position = SmartTooltipPositioner.calculatePosition(range, contentRef.current);
      setTooltipPosition(position);
    }

    setShowTooltip(true);
  }, [highlights]);

  // 创建划线
  const handleCreateHighlight = useCallback(async () => {
    if (!selectedRange || !currentChapter) return;

    const highlight = await createHighlight(selectedRange, currentChapter.id);
    if (highlight) {
      setShowTooltip(false);
      setSelectedRange(null);
      setExistingHighlight(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [selectedRange, currentChapter, createHighlight]);

  // 删除划线
  const handleRemoveHighlight = useCallback(async () => {
    if (!existingHighlight) return;

    await removeHighlight(existingHighlight.id);
    setShowTooltip(false);
    setSelectedRange(null);
    setExistingHighlight(null);
  }, [existingHighlight, removeHighlight]);

  // 查找已存在的划线
  const findExistingHighlight = (range: Range, highlights: StoredHighlight[]): StoredHighlight | null => {
    // 简化实现：通过文本匹配查找
    const selectedText = range.toString().trim();
    return highlights.find(h => h.text.trim() === selectedText) || null;
  };

  return (
    <div className="read-container">
      {/* ... 其他内容 ... */}
      
      <div className="read-content">
        {currentChapter && (
          <>
            <div className="chapter-header">
              <h1>{currentChapter.title}</h1>
            </div>
            
            <div
              ref={setContainer}
              className="chapter-content"
              dangerouslySetInnerHTML={{ __html: chapterContent }}
              onMouseUp={handleTextSelection}
            />
            
            {/* 智能工具提示 */}
            {showTooltip && (
              <SmartTooltip
                position={tooltipPosition}
                existingHighlight={existingHighlight}
                onCreate={handleCreateHighlight}
                onRemove={handleRemoveHighlight}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

## 迁移步骤

1. **保留现有代码**：新架构与旧代码可以并存
2. **逐步迁移**：可以先在新功能中使用新架构
3. **测试验证**：确保功能正常后再完全迁移

## 优势

1. **单一数据源**：UnifiedHighlightManager 统一管理状态和DOM
2. **简化时机处理**：不再需要复杂的恢复逻辑
3. **功能完整**：支持创建、删除、跨段落、笔记等
4. **性能优化**：避免不必要的重新渲染和DOM操作
5. **易于维护**：清晰的职责分离，代码更易理解

## 注意事项

- 新架构需要确保 `StorageManager` 已初始化
- `setContainer` 需要在 DOM 渲染后调用
- 跨段落划线功能需要进一步测试

