# 临时高亮功能实现 (2025-11-10)

## 功能描述

实现了"选中文本后高亮保持"的功能，当用户选择文本后，即使取消浏览器的选择状态，也会保持一个视觉高亮效果，直到用户点击划线按钮或取消选择。

## 用户体验改进

### 之前的体验：
1. 用户选择文本 → 显示蓝色浏览器默认选中效果
2. 显示 tooltip
3. 如果用户不小心点击其他地方，选中效果消失，需要重新选择

### 现在的体验：
1. 用户选择文本 → 显示**自定义蓝色背景高亮**（带呼吸动画）
2. 显示 tooltip
3. 即使用户点击其他地方（比如移动鼠标到 tooltip），高亮仍然保持
4. 点击"划线"按钮后，临时高亮转换为正式的下划线高亮
5. 点击空白处可以取消临时高亮

## 实现细节

### 1. CSS 样式增强

**自定义选中样式：**
```css
.chapter-content ::selection {
  background-color: rgba(59, 130, 246, 0.3);
  color: inherit;
}
```

**临时高亮样式：**
```css
.temp-highlight {
  background-color: rgba(59, 130, 246, 0.25) !important;
  border-radius: 2px;
  transition: all 0.2s ease;
  animation: pulseHighlight 1.5s ease-in-out infinite;
}

@keyframes pulseHighlight {
  0%, 100% {
    background-color: rgba(59, 130, 246, 0.25);
  }
  50% {
    background-color: rgba(59, 130, 246, 0.35);
  }
}
```

### 2. React 组件改动

**新增状态：**
```typescript
const tempHighlightLayerRef = useRef<HTMLElement | null>(null);
```

**新增函数：**

1. **`createTempHighlight(range: Range)`**
   - 在选中的文本上创建临时高亮层
   - 使用 `<span class="temp-highlight">` 包裹选中的文本
   - 处理简单选择和跨节点选择两种情况

2. **`clearTempHighlight()`**
   - 移除所有临时高亮元素
   - 恢复原始 DOM 结构

**触发时机：**

- **创建临时高亮：**
  - `handleTextSelection` 中，用户选择文本后立即创建

- **清除临时高亮：**
  - 点击"划线"按钮创建正式划线后
  - 点击外部区域取消选择时
  - 切换章节时
  - 创建划线失败时

### 3. 技术实现

#### 创建临时高亮的两种方法：

**方法1：`surroundContents`（简单选择）**
```typescript
const tempSpan = document.createElement('span');
tempSpan.className = 'temp-highlight';
clonedRange.surroundContents(tempSpan);
```

**方法2：`extractContents + insertNode`（跨节点选择）**
```typescript
const fragment = clonedRange.extractContents();
tempSpan.appendChild(fragment);
clonedRange.insertNode(tempSpan);
```

#### 清除临时高亮：
```typescript
const tempHighlights = contentRef.current?.querySelectorAll('.temp-highlight');
tempHighlights?.forEach(el => {
  const parent = el.parentNode;
  if (parent) {
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  }
});
```

## 视觉效果

1. **呼吸动画**：临时高亮带有微妙的呼吸效果（亮度在 25%-35% 之间循环）
2. **圆角边框**：2px 圆角，让高亮看起来更柔和
3. **平滑过渡**：所有样式变化都有 0.2s 的过渡动画

## 与正式划线的区别

| 特性 | 临时高亮 | 正式划线 |
|------|---------|---------|
| 样式 | 背景色 + 呼吸动画 | 下划线 |
| 持久性 | 临时的，会被清除 | 永久的，保存到数据库 |
| 触发条件 | 选择文本时自动创建 | 点击"划线"按钮创建 |
| 类名 | `.temp-highlight` | `.epub-highlight.underline` |
| 动画 | 有（pulseHighlight） | 无 |

## 兼容性

- ✅ 支持单行文本选择
- ✅ 支持多行文本选择
- ✅ 支持跨段落文本选择
- ✅ 支持包含链接的文本选择
- ✅ 与现有划线系统无冲突
- ✅ 不影响正式划线的恢复和渲染

## 已知限制

1. 在极少数情况下，如果选择的范围非常复杂（跨越多层嵌套的 HTML 元素），`surroundContents` 可能会失败，此时会自动回退到备用方法
2. 临时高亮会稍微修改 DOM 结构（添加一个 span 元素），但不会影响文本内容和语义

## 测试建议

1. **基本功能测试**：
   - 选择单行文本，观察高亮效果
   - 选择多行文本，观察高亮效果
   - 点击划线按钮，确认临时高亮正确转换为正式划线

2. **取消操作测试**：
   - 选择文本后点击空白处，确认临时高亮被清除
   - 选择文本后切换章节，确认临时高亮被清除

3. **视觉效果测试**：
   - 观察呼吸动画是否流畅
   - 确认临时高亮与正式划线在视觉上有明显区别

4. **边界情况测试**：
   - 选择包含图片的区域
   - 选择包含链接的文本
   - 选择跨越多个段落的长文本

## 后续改进建议

1. 可以考虑让用户自定义临时高亮的颜色
2. 可以考虑添加配置选项，让用户选择是否启用临时高亮功能
3. 可以考虑在临时高亮上显示预览的划线样式（下划线）

