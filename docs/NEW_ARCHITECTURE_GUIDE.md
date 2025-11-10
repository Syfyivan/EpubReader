# 新架构使用指南

## 📦 已创建的新组件

### 1. **UnifiedHighlightManager** 
   - 位置：`src/highlight/UnifiedHighlightManager.ts`
   - 功能：统一管理划线状态和DOM操作
   - 核心方法：
     - `addHighlight()` - 添加划线（自动渲染到DOM）
     - `removeHighlight()` - 删除划线（自动从DOM移除）
     - `updateHighlight()` - 更新划线
     - `setContainer()` - 设置容器（自动恢复所有划线）

### 2. **useHighlighter Hook**
   - 位置：`src/hooks/useHighlighter.ts`
   - 功能：简化React集成
   - 返回：
     - `highlights` - 所有划线
     - `createHighlight()` - 创建划线
     - `removeHighlight()` - 删除划线
     - `updateHighlight()` - 更新划线
     - `setContainer()` - 设置容器ref
     - `contentRef` - 内容容器ref

### 3. **SmartTooltipPositioner**
   - 位置：`src/highlight/SmartTooltipPositioner.ts`
   - 功能：智能计算tooltip位置
   - 方法：`calculatePosition(range, container)`

### 4. **CrossParagraphHighlighter**
   - 位置：`src/highlight/CrossParagraphHighlighter.ts`
   - 功能：处理跨段落划线
   - 方法：`wrapCrossParagraphRange(range, highlightId, color)`

### 5. **SmartTooltip 组件**
   - 位置：`src/components/SmartTooltip.tsx`
   - 功能：智能工具提示（根据是否存在划线显示不同选项）

## 🚀 快速开始

### 在 Read.tsx 中使用新架构

```typescript
import { useHighlighter } from '../hooks/useHighlighter';
import { SmartTooltip } from '../components/SmartTooltip';
import { SmartTooltipPositioner } from '../highlight/SmartTooltipPositioner';
import { StorageManager } from '../storage/StorageManager';

export default function Read({ file, bookId }: ReadProps) {
  // ... 其他状态 ...
  
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

  // 使用新架构的 Hook
  const {
    highlights,
    createHighlight,
    removeHighlight,
    setContainer,
    contentRef,
  } = useHighlighter({
    bookId,
    storageManager: storageManagerRef.current,
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
      return;
    }

    const range = selection.getRangeAt(0);
    const text = range.toString().trim();

    if (!text || !contentRef.current?.contains(range.commonAncestorContainer)) {
      setShowTooltip(false);
      return;
    }

    setSelectedRange(range);

    // 检查是否已存在划线
    const existing = highlights.find(h => 
      h.text.trim() === text && h.chapterId === currentChapter?.id
    );
    setExistingHighlight(existing || null);

    // 计算tooltip位置
    if (contentRef.current) {
      const position = SmartTooltipPositioner.calculatePosition(range, contentRef.current);
      setTooltipPosition(position);
    }

    setShowTooltip(true);
  }, [highlights, currentChapter]);

  // 创建划线
  const handleCreateHighlight = useCallback(async () => {
    if (!selectedRange || !currentChapter) return;
    await createHighlight(selectedRange, currentChapter.id);
    setShowTooltip(false);
    setSelectedRange(null);
    window.getSelection()?.removeAllRanges();
  }, [selectedRange, currentChapter, createHighlight]);

  // 删除划线
  const handleRemoveHighlight = useCallback(async () => {
    if (!existingHighlight) return;
    await removeHighlight(existingHighlight.id);
    setShowTooltip(false);
    setExistingHighlight(null);
  }, [existingHighlight, removeHighlight]);

  return (
    <div className="read-container">
      {/* ... */}
      <div
        ref={setContainer}  // 使用 setContainer 而不是直接 ref
        className="chapter-content"
        dangerouslySetInnerHTML={{ __html: chapterContent }}
        onMouseUp={handleTextSelection}
      />
      
      {showTooltip && (
        <SmartTooltip
          position={tooltipPosition}
          existingHighlight={existingHighlight}
          onCreate={handleCreateHighlight}
          onRemove={handleRemoveHighlight}
        />
      )}
    </div>
  );
}
```

## ✨ 核心优势

### 1. **解决状态管理与DOM操作冲突**
   - ✅ 统一管理器自动处理DOM操作
   - ✅ React状态更新不会清除划线
   - ✅ 不再需要复杂的恢复逻辑

### 2. **简化时机处理**
   - ✅ 不再需要多层 `setTimeout` + `MutationObserver`
   - ✅ 管理器自动在容器设置时恢复划线
   - ✅ 创建划线时立即渲染，无需等待

### 3. **功能完整**
   - ✅ 支持创建、删除、更新划线
   - ✅ 支持跨段落划线
   - ✅ 支持笔记功能
   - ✅ 支持划线关系检测

### 4. **性能优化**
   - ✅ 避免不必要的重新渲染
   - ✅ 智能跳过已存在的划线
   - ✅ 批量操作优化

## 🔄 迁移建议

### 方案A：完全迁移（推荐）
1. 备份当前 `Read.tsx`
2. 使用新架构重写 `Read.tsx`
3. 测试所有功能
4. 删除旧代码

### 方案B：渐进式迁移
1. 保留现有代码
2. 在新功能中使用新架构
3. 逐步替换旧代码
4. 最终完全迁移

## 📝 注意事项

1. **StorageManager 初始化**：确保在使用 `useHighlighter` 前初始化 `StorageManager`
2. **容器设置**：使用 `setContainer` 而不是直接 `ref`，确保管理器能正确恢复划线
3. **章节切换**：管理器会在容器变化时自动恢复所有划线，无需手动处理

## 🎯 下一步

1. 测试新架构的基本功能
2. 集成到现有 `Read.tsx` 中
3. 添加删除划线的UI
4. 完善笔记功能
5. 测试跨段落划线

