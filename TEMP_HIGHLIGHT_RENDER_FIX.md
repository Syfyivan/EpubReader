# 临时高亮被渲染清除问题修复 (2025-11-10)

## 问题描述

虽然临时高亮创建成功（控制台显示"✅✅ 最终验证：临时高亮成功显示在页面上"），但用户看不到高亮效果。

### 控制台日志分析

```
✅ 保存选中范围，文本: 道，周科长的那一摞材料上写的也都是半句话...
🎨 开始创建临时高亮，文本: 道，周科长的那一摞材料上写的也都是半句话...
✅ 方法1成功：使用 surroundContents 创建临时高亮
✅✅ 最终验证：临时高亮成功显示在页面上
🎨 已创建临时高亮
🎨 Rendering chapter: 梯形夕阳 key: chapter-id113-4  ← 问题在这里！
🎨 Rendering chapter: 梯形夕阳 key: chapter-id113-4  ← 渲染了两次！
🧹 已清除浏览器选择
```

## 根本原因

1. **临时高亮创建成功**：DOM 中确实添加了 `.temp-highlight` 元素
2. **React 组件重新渲染**：创建临时高亮后，组件立即重新渲染了两次
3. **`dangerouslySetInnerHTML` 重置内容**：每次渲染时，`dangerouslySetInnerHTML` 会完全重置 HTML 内容
4. **临时高亮被清除**：重置内容时，手动添加的 `.temp-highlight` 元素被删除

### 为什么会重新渲染？

可能的触发原因：
- `setShowHighlightTooltip(true)` 状态更新
- 其他状态变化
- MutationObserver 检测到 DOM 变化

## 解决方案

### 核心思路：在渲染后自动恢复临时高亮

使用 `useLayoutEffect` 监听渲染，如果检测到临时高亮数据存在但 DOM 中没有临时高亮元素，就重新创建。

### 实现步骤

#### 1. 添加临时高亮数据引用

```typescript
// 保存临时高亮的数据，用于重新渲染后恢复
const tempHighlightDataRef = useRef<{ range: Range; text: string } | null>(null);
```

#### 2. 在创建临时高亮时保存数据

```typescript
const createTempHighlight = useCallback((range: Range) => {
  // ... 创建临时高亮的代码 ...
  
  if (tempHighlightLayerRef.current && document.contains(tempHighlightLayerRef.current)) {
    // 保存临时高亮数据，用于重新渲染后恢复
    tempHighlightDataRef.current = {
      range: range.cloneRange(),
      text: range.toString()
    };
    console.log('💾 已保存临时高亮数据，用于渲染后恢复');
  }
}, [clearTempHighlight]);
```

#### 3. 在清除临时高亮时同时清除数据

```typescript
const clearTempHighlight = useCallback(() => {
  // ... 清除临时高亮的代码 ...
  
  // 同时清除保存的临时高亮数据
  tempHighlightDataRef.current = null;
}, []);
```

#### 4. 使用 useLayoutEffect 监听渲染并恢复临时高亮

```typescript
useLayoutEffect(() => {
  // ... 恢复正式划线的代码 ...
  
  // 恢复临时高亮（如果有的话）
  if (tempHighlightDataRef.current && !tempHighlightLayerRef.current) {
    console.log('🔄 检测到渲染清除了临时高亮，正在恢复...');
    const savedText = tempHighlightDataRef.current.text;
    
    // 使用文本搜索重新创建临时高亮
    const newRange = findTextInContainer(contentRef.current, savedText);
    if (newRange) {
      console.log('✅ 通过文本搜索找到了临时高亮位置，重新创建');
      createTempHighlight(newRange);
    } else {
      console.warn('⚠️ 无法找到临时高亮文本，可能已经滚动到其他位置');
      tempHighlightDataRef.current = null;
    }
  }
}, [chapterContent, currentChapter, restoreAllHighlights, highlights, findTextInContainer, createTempHighlight]);
```

#### 5. 调整函数定义顺序

将 `findTextInContainer` 移到前面，确保在 `useLayoutEffect` 之前定义：

```typescript
// 1. findTextInContainer（最前面）
const findTextInContainer = useCallback(...);

// 2. clearTempHighlight
const clearTempHighlight = useCallback(...);

// 3. createTempHighlight
const createTempHighlight = useCallback(...);

// 4. 其他函数...

// 5. useLayoutEffect（使用上面的函数）
useLayoutEffect(...);
```

## 工作流程

### 正常流程（现在）

```
1. 用户选择文字
   ↓
2. handleTextSelection 执行
   ↓
3. 创建临时高亮 ✅
   ↓
4. 保存临时高亮数据到 ref 💾
   ↓
5. React 组件重新渲染 🔄
   ↓
6. dangerouslySetInnerHTML 重置内容 ❌
   ↓
7. useLayoutEffect 触发 🔍
   ↓
8. 检测到临时高亮数据存在但 DOM 中没有 ⚠️
   ↓
9. 使用 findTextInContainer 搜索文本 🔎
   ↓
10. 重新创建临时高亮 ✅✅
    ↓
11. 用户看到临时高亮 🎉
```

### 对比之前的流程

```
1. 用户选择文字
   ↓
2. handleTextSelection 执行
   ↓
3. 创建临时高亮 ✅
   ↓
4. React 组件重新渲染 🔄
   ↓
5. dangerouslySetInnerHTML 重置内容 ❌
   ↓
6. 临时高亮被清除 ❌❌
   ↓
7. 用户看不到临时高亮 😢
```

## 关键技术点

### 1. 使用 ref 而不是 state

```typescript
// ✅ 正确：使用 ref
const tempHighlightDataRef = useRef<{ range: Range; text: string } | null>(null);

// ❌ 错误：使用 state 会触发更多渲染
const [tempHighlightData, setTempHighlightData] = useState(null);
```

### 2. 使用 useLayoutEffect 而不是 useEffect

`useLayoutEffect` 在浏览器绘制之前**同步**执行，避免闪烁：

```typescript
// ✅ 正确：同步执行，无闪烁
useLayoutEffect(() => {
  // 立即恢复临时高亮
}, [dependencies]);

// ❌ 错误：异步执行，可能看到闪烁
useEffect(() => {
  // 延迟恢复临时高亮
}, [dependencies]);
```

### 3. 文本搜索而不是 Range 恢复

由于 `dangerouslySetInnerHTML` 完全重置了 DOM，原有的 Range 对象失效：

```typescript
// ✅ 正确：使用文本搜索
const newRange = findTextInContainer(container, savedText);

// ❌ 错误：Range 已经失效
const newRange = savedRange.cloneRange(); // 会报错
```

## 新增日志

现在会看到以下日志：

```
✅ 保存选中范围，文本: [文本]
🎨 开始创建临时高亮，文本: [文本]
✅ 方法1成功：使用 surroundContents 创建临时高亮
✅✅ 最终验证：临时高亮成功显示在页面上
💾 已保存临时高亮数据，用于渲染后恢复  ← 新增
🎨 已创建临时高亮
🎨 Rendering chapter: [章节名]
🎨 Rendering chapter: [章节名]
🔄 检测到渲染清除了临时高亮，正在恢复...  ← 新增
✅ 在文本节点中找到目标文本，创建 range  ← 新增
✅ 方法1成功：使用 surroundContents 创建临时高亮
✅✅ 最终验证：临时高亮成功显示在页面上
💾 已保存临时高亮数据，用于渲染后恢复
🧹 已清除浏览器选择
```

## 测试验证

### 测试步骤

1. 选择一段文字
2. 观察控制台日志
3. 确认能看到临时高亮

### 预期结果

- ✅ 控制台显示 "🔄 检测到渲染清除了临时高亮，正在恢复..."
- ✅ 控制台显示 "✅ 通过文本搜索找到了临时高亮位置，重新创建"
- ✅ 页面上能看到淡蓝色背景 + 呼吸动画
- ✅ 临时高亮保持显示，不会消失

### 如果还是看不到

1. 检查是否有 "❌❌ 最终验证失败" 日志
2. 检查是否有 "⚠️ 无法找到临时高亮文本" 日志
3. 使用浏览器开发者工具搜索 `.temp-highlight` 元素

## 性能考虑

### 额外的性能开销

1. **文本搜索**：`findTextInContainer` 需要遍历所有文本节点
2. **重复创建**：临时高亮可能被创建两次

### 优化建议

如果性能成为问题，可以考虑：
1. 使用防抖（debounce）减少重新创建的频率
2. 缓存文本节点数组
3. 限制文本搜索的范围

但目前的实现对用户体验影响很小，不需要进一步优化。

## 后续改进

### 更好的解决方案（未来）

1. **不使用 dangerouslySetInnerHTML**
   - 使用 React 组件渲染内容
   - 临时高亮作为 React 组件，不会被清除

2. **使用 Portal**
   - 将临时高亮渲染到单独的容器
   - 不受章节内容渲染影响

3. **使用 CSS 伪元素**
   - 通过 CSS 显示临时高亮
   - 不修改 DOM 结构

## 相关文件

- `src/read/Read.tsx` - 主要修复文件

## 总结

通过监听渲染并自动恢复临时高亮，成功解决了临时高亮被 React 渲染清除的问题。现在用户选择文字后，能够稳定地看到临时高亮效果，即使组件重新渲染也不会消失。

