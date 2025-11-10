# 初始化错误修复 (2025-11-10)

## 问题描述

在实现临时高亮功能后，应用无法加载电子书，出现以下错误：

```
Uncaught ReferenceError: Cannot access 'clearTempHighlight' before initialization
    at Read (Read.tsx:189:33)
```

## 根本原因

函数定义顺序问题：
- `loadChapter` 函数在其依赖数组中引用了 `clearTempHighlight`
- 但是 `clearTempHighlight` 函数在 `loadChapter` 之后才定义
- 导致在初始化阶段无法访问该函数

## 修复方案

### 1. 调整函数定义顺序

将 `clearTempHighlight` 和 `createTempHighlight` 的定义移到 `loadChapter` 之前：

**之前的顺序：**
```typescript
const loadChapter = useCallback(async (chapterId: string) => {
  clearTempHighlight(); // ❌ 此时函数还未定义
  // ...
}, [clearTempHighlight]); // ❌ 依赖了尚未定义的函数

// ... 其他代码 ...

const clearTempHighlight = useCallback(() => {
  // ...
}, []);
```

**修复后的顺序：**
```typescript
// ✅ 先定义 clearTempHighlight
const clearTempHighlight = useCallback(() => {
  // ...
}, []);

// ✅ 再定义 createTempHighlight
const createTempHighlight = useCallback((range: Range) => {
  // ...
}, [clearTempHighlight]);

// ✅ 最后定义 loadChapter，可以安全地使用上面的函数
const loadChapter = useCallback(async (chapterId: string) => {
  clearTempHighlight(); // ✅ 现在可以访问了
  // ...
}, [clearTempHighlight]);
```

### 2. 删除重复定义

由于在移动函数时产生了重复定义，需要删除后面的重复代码。

### 3. 修复 Linter 错误

修复过程中还发现并修复了几个 linter 错误：

1. **未使用的 catch 变量**：
   ```typescript
   // 之前
   } catch (e) {
     console.log('⚠️ surroundContents 失败');
   }
   
   // 修复后
   } catch {
     console.log('⚠️ surroundContents 失败');
   }
   ```

2. **缺失的变量声明**：
   ```typescript
   // 之前（删除了声明但还在使用）
   endOffset = startOffset + searchText.length;
   
   // 修复后
   let endOffset = startOffset + searchText.length;
   ```

3. **不必要的依赖**：
   ```typescript
   // 之前
   }, [currentChapter, bookId, restoreAllHighlights, clearTempHighlight]);
   
   // 修复后（移除未使用的 restoreAllHighlights）
   }, [currentChapter, bookId, clearTempHighlight]);
   ```

## JavaScript/React 中的函数初始化顺序

### useCallback 的行为

`useCallback` 会在组件渲染时立即执行，创建记忆化的函数。因此：

1. **依赖必须在使用前定义**：
   ```typescript
   // ❌ 错误
   const funcA = useCallback(() => {
     funcB(); // funcB 还不存在
   }, [funcB]);
   
   const funcB = useCallback(() => {
     // ...
   }, []);
   
   // ✅ 正确
   const funcB = useCallback(() => {
     // ...
   }, []);
   
   const funcA = useCallback(() => {
     funcB(); // funcB 已经定义
   }, [funcB]);
   ```

2. **循环依赖的处理**：
   - 如果 A 依赖 B，B 依赖 A，会导致问题
   - 解决方案：使用 ref 或重构逻辑

### 最佳实践

1. **按依赖顺序定义函数**：
   - 被依赖的函数放在前面
   - 依赖其他函数的放在后面

2. **分层定义**：
   ```
   工具函数（无依赖）
   ↓
   业务逻辑函数（依赖工具函数）
   ↓
   事件处理函数（依赖业务逻辑函数）
   ↓
   生命周期钩子（依赖以上所有函数）
   ```

3. **使用 ESLint**：
   - React Hooks 的 ESLint 规则会帮助检测依赖问题
   - 但不会检测初始化顺序问题

## 验证修复

修复后，应用应该能够：
1. ✅ 正常加载电子书
2. ✅ 显示章节内容
3. ✅ 选择文本时创建临时高亮
4. ✅ 点击划线按钮创建正式划线
5. ✅ 没有控制台错误

## 相关文件

- `src/read/Read.tsx` - 主要修复文件

## 技术要点

### React 组件中的函数定义顺序
在 React 函数组件中，所有的 `useCallback`、`useMemo` 等 Hook 都会在每次渲染时按照定义顺序执行。因此：

- **定义顺序 = 初始化顺序**
- 如果函数 A 依赖函数 B，则 B 必须在 A 之前定义
- 否则会出现 "Cannot access before initialization" 错误

### 解决方案选择

如果遇到函数初始化顺序问题，可以选择：

1. **调整定义顺序**（推荐）
   - 简单直接
   - 符合直觉

2. **使用 ref**
   - 适用于循环依赖
   - 需要更多代码

3. **使用 useEffect**
   - 适用于异步初始化
   - 可能导致额外的重新渲染

对于本次修复，我们选择了方案 1，因为函数之间没有循环依赖，只需调整顺序即可。

