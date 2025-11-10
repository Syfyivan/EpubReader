# TOC目录和链接跳转修复 - TOC and Link Navigation Fix

## 问题描述 (Problem Description)

用户报告两个关键问题：

1. **TOC目录显示异常**：显示文件名（如"index_split_001"）而不是章节标题（如"译序:心灵的分身术"）
2. **注释链接无法跳转**：点击内容中的链接时，控制台重复输出"Link clicked in content, preventing navigation"但页面不跳转

## 根本原因 (Root Cause)

### 问题1：TOC显示文件名
- NCX/NAV文件查找逻辑不够完善，可能找不到导航文件
- 路径匹配逻辑不够健壮，导致标题无法正确匹配到章节
- 路径规范化处理不够完善

### 问题2：链接被完全阻止
- 之前的代码阻止了所有链接的默认行为
- 没有区分内部章节链接和外部链接
- 没有实现内部链接的跳转逻辑

## 修复方案 (Solution)

### 1. 改进NCX/NAV文件查找

**修改前 (Before):**
```typescript
// 只使用单一选择器查找NAV文件
const navItem = doc.querySelector('item[properties*="nav"]');
```

**修改后 (After):**
```typescript
// 多种方式查找NAV文件
let navItem = doc.querySelector('item[properties*="nav"]');
if (!navItem) {
  navItem = doc.querySelector('item[id*="nav"], item[id*="toc"]');
}
if (!navItem) {
  // 通过文件名查找
  const allItems = doc.querySelectorAll('item');
  for (const item of Array.from(allItems)) {
    const href = item.getAttribute('href');
    if (href && (href.toLowerCase().includes('nav') || href.toLowerCase().includes('toc'))) {
      navItem = item;
      break;
    }
  }
}
```

**优点**：提高了找到NAV文件的成功率。

**Advantage**: Increases success rate of finding NAV files.

### 2. 改进路径规范化

**修改前 (Before):**
```typescript
private normalizePath(path: string): string {
  if (path.startsWith('/')) {
    return path.substring(1);
  }
  return this.basePath + path;
}
```

**修改后 (After):**
```typescript
private normalizePath(path: string): string {
  if (!path) return '';
  
  // 移除开头的斜杠
  let normalized = path.startsWith('/') ? path.substring(1) : path;
  
  // 如果路径不包含basePath，则添加
  if (this.basePath && !normalized.startsWith(this.basePath)) {
    normalized = this.basePath + normalized;
  }
  
  // 统一路径分隔符
  normalized = normalized.replace(/\\/g, '/');
  
  // 移除重复的斜杠
  normalized = normalized.replace(/\/+/g, '/');
  
  return normalized;
}
```

**优点**：处理各种路径格式，确保匹配成功。

**Advantage**: Handles various path formats, ensuring successful matching.

### 3. 修复链接点击处理

**修改前 (Before):**
```typescript
onClick={(e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'A' || target.closest('a')) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Link clicked in content, preventing navigation');
    return false;
  }
}}
```

**修改后 (After):**
```typescript
onClick={(e) => {
  const target = e.target as HTMLElement;
  const link = target.tagName === 'A' ? target as HTMLAnchorElement : target.closest('a') as HTMLAnchorElement;
  
  if (link) {
    e.preventDefault();
    e.stopPropagation();
    
    const href = link.getAttribute('href');
    if (!href) return false;

    // 检查是否是内部章节链接
    if (href.startsWith('#') || !href.startsWith('http')) {
      const cleanHref = href.split('#')[0];
      
      // 查找对应的章节
      if (parser) {
        const chapters = parser.getChapters();
        const targetChapter = chapters.find(ch => {
          if (ch.href === cleanHref || ch.href.endsWith(cleanHref)) return true;
          const chFileName = ch.href.split('/').pop();
          const hrefFileName = cleanHref.split('/').pop();
          return chFileName === hrefFileName;
        });

        if (targetChapter) {
          console.log('✅ 跳转到章节:', targetChapter.title, targetChapter.id);
          loadChapter(targetChapter.id);
          return false;
        }
      }
    } else {
      // 外部链接，阻止导航
      console.log('🚫 阻止外部链接:', href);
    }
    
    return false;
  }
}}
```

**关键改进 (Key Improvements):**

1. **区分内部和外部链接**：只阻止外部链接（http/https开头）
2. **实现内部跳转**：内部链接会查找对应章节并跳转
3. **多种匹配方式**：完全匹配、文件名匹配
4. **详细日志**：帮助调试链接跳转问题

**Key Improvements:**

1. **Distinguish internal and external links**: Only block external links (starting with http/https)
2. **Implement internal navigation**: Internal links find corresponding chapter and navigate
3. **Multiple matching methods**: Full match, filename match
4. **Detailed logging**: Help debug link navigation issues

## 测试步骤 (Testing Steps)

### 测试TOC目录显示

1. ✅ 刷新页面（Ctrl + F5）
2. ✅ 导入EPUB文件
3. ✅ 观察控制台日志：
   - `🔍 开始增强章节标题...`
   - `📖 找到NCX文件:` 或 `📖 找到NAV文件:`
   - `📊 NCX/NAV解析完成: 匹配 X/Y 个章节`
4. ✅ 检查TOC目录：
   - 应该显示真实章节标题（如"译序:心灵的分身术"）
   - 不应该显示文件名（如"index_split_001"）

### 测试链接跳转

1. ✅ 在章节内容中找到链接（通常是目录中的章节链接）
2. ✅ 点击链接
3. ✅ 观察控制台日志：
   - `🔗 Link clicked: [链接地址]`
   - `✅ 跳转到章节: [章节标题] [章节ID]`
4. ✅ 验证页面跳转到对应章节

## 调试信息 (Debug Information)

### TOC解析成功的日志序列：
```
🔍 开始增强章节标题...
📖 找到NCX文件: toc.ncx
📖 找到 25 个导航点
✅ [1] 匹配: "译序:心灵的分身术" -> OEBPS/index_split_009.html
✅ [2] 匹配: "你说我是多于一块石头或者一株植物的东西" -> OEBPS/index_split_010.html
...
📊 NCX解析完成: 匹配 25/25 个章节
📚 增强后章节列表: [显示所有章节和标题]
```

### 链接跳转成功的日志序列：
```
🔗 Link clicked: index_split_010.html#id_Toc90661069
✅ 跳转到章节: 你说我是多于一块石头或者一株植物的东西 id240
🔄 Loading chapter: id240
Found chapter: 你说我是多于一块石头或者一株植物的东西
Chapter content loaded, length: 77163
✅ Chapter and content set in state, renderKey: 5
🎨 Rendering chapter: 你说我是多于一块石头或者一株植物的东西
```

## 相关文件 (Related Files)

- `src/parse/Parse.tsx` - EPUB解析和NCX/NAV处理
- `src/read/Read.tsx` - TOC渲染和链接处理

## 参考文档 (References)

- [EPUB 3 Navigation Document](https://www.w3.org/publishing/epub3/epub-contentdocs.html#sec-nav-doc)
- [EPUB NCX (Navigation Control file for XML)](https://idpf.org/epub/20/spec/OPS_2.0.1_draft.htm#Section2.4.1)

