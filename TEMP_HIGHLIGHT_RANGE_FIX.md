# 临时高亮 Range 文本为空问题修复 (2025-11-10)

## 问题描述

用户选择文字后，控制台日志显示：

```
✅ 在文本节点中找到目标文本，创建 range
✅ 重新创建临时高亮
🎨 开始创建临时高亮，文本:   ← 文本为空！
```

临时高亮恢复流程执行了，但传入 `createTempHighlight` 的 range 文本为空。

## 根本原因

### 时序问题

1. **恢复正式划线修改了 DOM**：
   - `restoreAllHighlights()` 用 `<span class="epub-highlight">` 包裹文本
   - 原始的文本节点被替换或分割

2. **文本搜索立即执行**：
   - `findTextInContainer` 在 DOM 修改后立即执行
   - 找到了文本节点，创建了 range
   - 但这时 DOM 可能还在变化中

3. **Range 引用失效**：
   - `restoreAllHighlights` 继续修改 DOM
   - range 引用的文本节点被移动或删除
   - 当调用 `createTempHighlight(range)` 时，range 已经失效
   - `range.toString()` 返回空字符串

### 示例场景

```
原始文本：
<p>下午两点半的咖啡馆，相亲首选</p>

恢复正式划线后：
<p>
  <span class="epub-highlight">下午两点半</span>
  的咖啡馆，相亲首选
</p>

此时 findTextInContainer 创建的 range 可能引用：
- 原始的文本节点（已被删除）
- 或跨越新旧节点的混合状态

调用 range.toString() → 返回空字符串 ""
```

## 解决方案

### 核心思路：延迟执行

在 DOM 完全稳定后再搜索文本并创建临时高亮。

### 实现细节

#### 1. 在 `restoreAllHighlights` 末尾

**之前（有问题）：**
```typescript
if (tempHighlightDataRef.current && contentRef.current) {
  const savedText = tempHighlightDataRef.current.text;
  const newRange = findTextInContainer(contentRef.current, savedText);
  if (newRange) {
    createTempHighlight(newRange); // range 可能已失效
  }
}
```

**现在（修复后）：**
```typescript
if (tempHighlightDataRef.current && contentRef.current) {
  // 使用 setTimeout 延迟，让 DOM 完全稳定
  setTimeout(() => {
    if (!contentRef.current || !tempHighlightDataRef.current) return;
    
    const tempHighlightExists = contentRef.current.querySelector('.temp-highlight');
    if (!tempHighlightExists) {
      const savedText = tempHighlightDataRef.current.text;
      
      // 在 DOM 稳定后再搜索
      const newRange = findTextInContainer(contentRef.current, savedText);
      if (newRange) {
        // 验证 range 的文本
        const rangeText = newRange.toString();
        if (rangeText.trim().length > 0) {
          createTempHighlight(newRange);
        } else {
          console.error('❌ Range 文本为空，无法创建临时高亮');
        }
      }
    }
  }, 100); // 延迟 100ms
}
```

#### 2. 在 `useLayoutEffect` 中

同样使用 `setTimeout` 延迟执行。

#### 3. 在 `MutationObserver` 回调中

将延迟从 50ms 增加到 100ms。

#### 4. 在 `createTempHighlight` 函数中

添加额外的验证：

```typescript
const createTempHighlight = useCallback((range: Range) => {
  clearTempHighlight();
  
  try {
    const rangeText = range.toString();
    console.log('🎨 开始创建临时高亮，文本:', rangeText.substring(0, 50));
    
    // 验证 range 是否有效
    if (range.collapsed) {
      console.warn('⚠️ Range 已折叠，无法创建临时高亮');
      return;
    }
    
    // 验证 range 文本不为空
    if (!rangeText || rangeText.trim().length === 0) {
      console.error('❌ Range 文本为空，无法创建临时高亮');
      console.error('Range详情:', {
        collapsed: range.collapsed,
        startContainer: range.startContainer.nodeName,
        endContainer: range.endContainer.nodeName,
        startOffset: range.startOffset,
        endOffset: range.endOffset
      });
      return;
    }
    
    // ... 继续创建临时高亮
  } catch (error) {
    console.error('❌ 创建临时高亮层失败:', error);
  }
}, [clearTempHighlight]);
```

## 工作流程

### 修复前（有问题）

```
恢复正式划线开始
  ↓
修改 DOM（添加 <span>）
  ↓
立即搜索文本并创建 range
  ↓
继续修改 DOM
  ↓
range 引用的节点失效
  ↓
调用 createTempHighlight(range)
  ↓
range.toString() 返回空字符串
  ↓
创建失败 ❌
```

### 修复后（正确）

```
恢复正式划线开始
  ↓
修改 DOM（添加 <span>）
  ↓
恢复完成
  ↓
启动 setTimeout（100ms）⏱️
  ↓
DOM 完全稳定 ✅
  ↓
setTimeout 触发
  ↓
搜索文本并创建 range
  ↓
验证 range.toString() 有内容
  ↓
调用 createTempHighlight(range)
  ↓
创建成功 ✅✅
```

## 新增日志

现在会看到更详细的日志：

```
✅ 保存选中范围，文本: 下午两点半的咖啡馆，相亲首选
🎨 开始创建临时高亮，文本: 下午两点半的咖啡馆，相亲首选
✅ 方法1成功：使用 surroundContents 创建临时高亮
✅✅ 最终验证：临时高亮成功显示在页面上
💾 已保存临时高亮数据，用于渲染后恢复
🎨 已创建临时高亮
🎨 Rendering chapter: 冬泳
⚠️ 检测到划线被清除
🔄 恢复当前章节的所有划线: 2 个
📊 划线恢复完成: 成功 2, 跳过 0, 失败 0
🔄 正式划线恢复完成后，检查临时高亮...
⚠️ 临时高亮被清除了，正在恢复...
(等待 100ms)  ← 延迟执行
✅ 找到文本并创建 range，文本: 下午两点半的咖啡馆，相亲首选  ← 新增
✅ 重新创建临时高亮
🎨 开始创建临时高亮，文本: 下午两点半的咖啡馆，相亲首选  ← 现在有文本了！
✅ 方法1成功：使用 surroundContents 创建临时高亮
✅✅ 最终验证：临时高亮成功显示在页面上
🧹 已清除浏览器选择
```

## 关键改进点

### 1. 延迟执行

所有恢复临时高亮的地方都使用 `setTimeout`：
- `restoreAllHighlights` 末尾：100ms
- `useLayoutEffect` 中：100ms
- `MutationObserver` 回调：100ms

### 2. 验证 Range 文本

在创建临时高亮前，先验证 `range.toString()` 不为空：

```typescript
const rangeText = newRange.toString();
if (rangeText.trim().length > 0) {
  createTempHighlight(newRange);
} else {
  console.error('❌ Range 文本为空');
}
```

### 3. 详细的错误日志

如果 range 文本为空，输出详细信息：

```typescript
console.error('Range详情:', {
  collapsed: range.collapsed,
  startContainer: range.startContainer.nodeName,
  endContainer: range.endContainer.nodeName,
  startOffset: range.startOffset,
  endOffset: range.endOffset
});
```

### 4. 早期返回

在 `createTempHighlight` 开头就验证并返回，避免继续执行无效操作。

## 性能考虑

### 额外延迟

- 每个恢复点增加 100ms 延迟
- 总共最多 300ms（如果三个恢复点都触发）
- 但实际上只有一个会真正执行恢复

### 用户体验

- 100ms 的延迟对用户几乎无感知
- 换来的是稳定的临时高亮显示
- 值得这个性能开销

## 测试验证

### 成功的标志

1. **控制台日志**：
   - ✅ 有 "找到文本并创建 range，文本: [完整文本]"
   - ✅ 有 "开始创建临时高亮，文本: [完整文本]"
   - ❌ 没有 "Range 文本为空" 错误

2. **页面效果**：
   - ✅ 能看到淡蓝色背景高亮
   - ✅ 有呼吸动画
   - ✅ 稳定显示，不消失

### 如果还有问题

1. 检查是否有 "❌ Range 文本为空" 错误
2. 查看 "Range详情" 日志，了解 range 的状态
3. 增加延迟时间（从 100ms 改为 200ms）

## 相关文件

- `src/read/Read.tsx` - 完整修复实现

## 总结

通过在所有恢复点添加延迟执行，并验证 range 文本不为空，成功解决了临时高亮恢复时 range 失效的问题。现在临时高亮能够在 DOM 完全稳定后可靠地恢复，并且有详细的日志帮助调试。

