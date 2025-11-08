# 🐛 Bug 修复：页面无限刷新问题

## 问题描述

导入 EPUB 文件后，页面和目录一直闪烁不断刷新。

## 根本原因

这是一个典型的 React **无限循环（Infinite Loop）**问题，由依赖项链式触发导致：

### 问题链路

```
1. useEffect 依赖 [file, bookId, loadChapter]
   ↓
2. useEffect 内部调用 setHighlights(savedHighlights)
   ↓
3. highlights 状态改变
   ↓
4. loadChapter 依赖 [parser, highlights]
   ↓
5. loadChapter 重新创建（因为 highlights 变了）
   ↓
6. useEffect 检测到 loadChapter 变化
   ↓
7. useEffect 重新执行
   ↓
8. 回到步骤 2，无限循环！
```

### 代码问题示例

**修复前（❌ 错误）**:
```typescript
// loadChapter 依赖 highlights
const loadChapter = useCallback(async (chapterId: string) => {
  // ... 
  const chapterHighlights = highlights.filter(...);  // 使用 highlights
  // ...
}, [parser, highlights]); // 依赖 highlights

useEffect(() => {
  // ...
  setHighlights(savedHighlights); // 更新 highlights
  // ...
}, [file, bookId, loadChapter]); // 依赖 loadChapter

// 形成循环：highlights 变 → loadChapter 变 → useEffect 执行 → highlights 变 → ...
```

## 解决方案

### 1. 移除 loadChapter 对 highlights 的依赖

使用 **函数式状态更新** 来访问最新的 highlights，而不将它放在依赖数组中：

```typescript
const loadChapter = useCallback(async (chapterId: string, epubParser?: EpubParser) => {
  // ...
  
  // ✅ 使用函数式更新获取最新 highlights
  setHighlights((currentHighlights) => {
    const chapterHighlights = currentHighlights.filter(
      (h) => h.position.elementPath.includes(chapterId)
    );
    virtualRendererRef.current?.setHighlights(chapterHighlights);
    return currentHighlights; // 不改变状态，只是用来获取最新值
  });
  
  // ...
}, [parser]); // ✅ 只依赖 parser
```

### 2. 移除 useEffect 对 loadChapter 的依赖

```typescript
useEffect(() => {
  const init = async () => {
    // ... 初始化代码
  };
  
  init();
  
  return () => {
    // 清理
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [file, bookId]); // ✅ 只依赖 file 和 bookId
```

## 修复详情

### 修改文件
- `src/read/Read.tsx`

### 关键改动

**1. loadChapter 函数**
```diff
  const loadChapter = useCallback(async (chapterId: string, epubParser?: EpubParser) => {
    // ...
    if (virtualRendererRef.current && contentRef.current) {
-     const chapterHighlights = highlights.filter(
-       (h) => h.position.elementPath.includes(chapterId)
-     );
-     virtualRendererRef.current.setHighlights(chapterHighlights);
+     // 使用函数式更新来获取最新的 highlights，避免依赖
+     setHighlights((currentHighlights) => {
+       const chapterHighlights = currentHighlights.filter(
+         (h) => h.position.elementPath.includes(chapterId)
+       );
+       virtualRendererRef.current?.setHighlights(chapterHighlights);
+       return currentHighlights; // 不改变状态，只是用来获取最新值
+     });
    }
-  }, [parser, highlights]);
+  }, [parser]);
```

**2. useEffect 依赖项**
```diff
  useEffect(() => {
    init();
    return () => {
      // 清理
    };
-  }, [file, bookId, loadChapter]);
+  // eslint-disable-next-line react-hooks/exhaustive-deps
+  }, [file, bookId]); // 移除 loadChapter 依赖，避免无限循环
```

## React Hooks 最佳实践

### 避免无限循环的原则

1. **谨慎使用 useCallback/useMemo 的依赖项**
   - 不要将频繁变化的状态作为依赖
   - 考虑使用 useRef 存储不需要触发重渲染的值

2. **使用函数式状态更新**
   ```typescript
   // ✅ 好的做法
   setState(prev => {
     // 使用 prev 进行计算
     return newState;
   });
   
   // ❌ 避免这样
   setState(someValue); // 如果 someValue 在依赖中
   ```

3. **useEffect 依赖项最小化**
   ```typescript
   // ✅ 只依赖真正需要的
   useEffect(() => {
     // ...
   }, [id, type]);
   
   // ❌ 避免依赖函数
   useEffect(() => {
     // ...
   }, [id, type, someFunction]); // someFunction 可能频繁变化
   ```

4. **使用 useRef 存储不需要触发渲染的值**
   ```typescript
   const latestCallbackRef = useRef(callback);
   
   useEffect(() => {
     latestCallbackRef.current = callback;
   });
   
   // 使用 latestCallbackRef.current 而不是依赖 callback
   ```

## 验证步骤

1. **清除浏览器缓存**
   ```
   Ctrl + Shift + Delete (Windows)
   Cmd + Shift + Delete (Mac)
   ```

2. **强制刷新页面**
   ```
   Ctrl + F5 (Windows)
   Cmd + Shift + R (Mac)
   ```

3. **测试流程**
   - 打开应用：http://localhost:5173
   - 选择本地 EPUB 文件
   - 观察页面是否稳定（不再闪烁）
   - 点击目录切换章节
   - 确认一切正常

## 预期结果

- ✅ 页面不再闪烁
- ✅ 目录加载后保持稳定
- ✅ 章节切换流畅
- ✅ 划线功能正常
- ✅ AI 分析可用

## 技术要点

### 函数式状态更新的原理

```typescript
// 这种方式可以访问最新状态，但不需要将状态放在依赖数组中
setHighlights((currentHighlights) => {
  // currentHighlights 始终是最新值
  // 在这里可以读取和使用它
  doSomething(currentHighlights);
  
  // 如果不需要改变状态，返回原值
  return currentHighlights;
});
```

### 为什么这样可以解决问题？

1. **避免依赖链**：不将 highlights 放在 loadChapter 的依赖中
2. **仍能访问最新值**：通过函数式更新获取最新的 highlights
3. **打破循环**：useEffect 不再依赖 loadChapter

## 相关文档

- [React Hooks - useCallback](https://react.dev/reference/react/useCallback)
- [React Hooks - useEffect](https://react.dev/reference/react/useEffect)
- [Avoiding useEffect Dependencies](https://react.dev/learn/removing-effect-dependencies)

## 状态

- **修复时间**: 2025-01-08
- **影响文件**: 1 个
- **修复状态**: ✅ 完成
- **测试状态**: ✅ 待验证

---

**现在请刷新浏览器，页面应该不再闪烁了！**

