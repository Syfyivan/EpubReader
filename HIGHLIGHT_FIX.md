# 划线功能修复 (2025-11-10)

## 问题描述

阅读器的划线功能无法正常工作，主要表现为：
1. 有的地方没有 tooltip
2. 有的地方有 tooltip 但是无法划线
3. 控制台错误：`❌ 无法获取有效的 range，请重新选择文字`
4. 章节在频繁重新渲染

## 根本原因

1. **Range 失效问题**：用户选择文本后，在点击划线按钮之前，组件发生了重新渲染，导致保存的 DOM range 引用失效（DOM 节点被销毁）

2. **循环渲染问题**：MutationObserver 检测到 DOM 变化后调用 `restoreAllHighlights`，而后者又修改 DOM，触发更多的观察回调，形成循环

## 修复方案

### 1. 增强 Range 恢复机制

**修改的接口：**
```typescript
interface RangeData {
  range: Range;
  position: HighlightPosition;
  text: string; // 新增：保存选中的文本，用于重新查找
}
```

**新增的功能：**
- 在 `handleTextSelection` 中保存选中的文本
- 在 `handleCreateHighlight` 中添加了多层回退机制：
  1. 尝试从序列化的 position 恢复 range
  2. 尝试使用保存的 range
  3. 尝试使用当前 selection
  4. **新增**：使用保存的文本通过 `findTextInContainer` 搜索并创建新的 range

### 2. 实现智能文本搜索

**新增函数：`findTextInContainer`**

此函数可以：
- 在容器的所有文本节点中搜索目标文本
- 处理跨节点的文本选择（如文本跨越多个 `<p>` 或 `<span>` 标签）
- 创建准确的 Range 对象

关键特性：
- 使用 TreeWalker 遍历所有文本节点
- 支持单节点内的文本查找
- 支持跨节点的文本查找（复杂场景）
- 精确计算起始和结束位置

### 3. 防止循环渲染

**新增标志：`isRestoringHighlightsRef`**

使用方式：
- 在 `restoreAllHighlights` 开始时设置为 `true`
- 在 MutationObserver 回调中检查此标志，如果正在恢复则跳过
- 在 `restoreAllHighlights` 结束时设置为 `false`

这样可以避免：
```
DOM 变化 → MutationObserver 触发 → restoreAllHighlights 
→ 修改 DOM → MutationObserver 再次触发 → 循环
```

### 4. 优化性能

- 移除了 `handleCreateHighlight` 函数末尾不必要的 `restoreAllHighlights` 调用
- 因为已经在创建划线时直接应用了样式，并且已经将划线添加到了 HighlightSystem

## 修改的文件

- `src/read/Read.tsx`

## 测试建议

1. **基本划线功能**：
   - 选择单行文本，点击划线按钮
   - 选择多行文本，点击划线按钮
   - 选择跨段落文本，点击划线按钮

2. **Tooltip 显示**：
   - 确认选择文本后 tooltip 正确显示
   - 确认 tooltip 位置合理（在选中文本上方）

3. **Range 恢复**：
   - 选择文本后，等待几秒再点击划线（测试异步渲染场景）
   - 在不同类型的文本上测试（普通文本、链接、格式化文本等）

4. **性能**：
   - 观察控制台，确认章节不再频繁重新渲染
   - 确认没有"正在恢复划线中"的循环日志

## 技术细节

### Range 恢复优先级
1. **序列化 position**（最可靠，因为基于 XPath）
2. **保存的 range**（如果 DOM 节点仍在）
3. **当前 selection**（如果用户没有改变选择）
4. **文本搜索**（最后的回退，通过文本内容重新定位）

### 文本搜索算法
- 时间复杂度：O(n*m)，其中 n 是文本节点数量，m 是搜索文本长度
- 空间复杂度：O(n)，用于存储文本节点数组
- 适用场景：当其他方法都失败时的最后手段

## 已知限制

1. 如果同一文本在章节中出现多次，`findTextInContainer` 会返回第一次出现的位置
2. 文本搜索区分大小写
3. 文本搜索不处理空白字符的差异（但这通常不是问题，因为我们保存的是精确的选中文本）

## 后续改进建议

1. 可以考虑在文本搜索时添加模糊匹配（处理空白字符差异）
2. 可以考虑添加防抖，减少 MutationObserver 的触发频率
3. 可以考虑使用 WeakMap 缓存文本节点，提高搜索性能

