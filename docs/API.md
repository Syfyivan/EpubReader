# 📖 API 文档

## EpubParser

EPUB 文件解析器，支持本地和远程文件的流式加载。

### 构造函数

```typescript
const parser = new EpubParser();
```

### 方法

#### `load(source: File | string): Promise<void>`

加载 EPUB 文件。

**参数**：
- `source`: File 对象（本地文件）或 URL 字符串（远程文件）

**示例**：

```typescript
// 本地文件
const file = event.target.files[0];
await parser.load(file);

// 远程文件
await parser.load('https://example.com/book.epub');
```

#### `getChapters(): EpubChapter[]`

获取所有章节列表。

**返回**：`EpubChapter[]`

```typescript
interface EpubChapter {
  id: string;        // 章节 ID
  title: string;     // 章节标题
  href: string;      // 章节文件路径
  order: number;     // 阅读顺序
}
```

**示例**：

```typescript
const chapters = parser.getChapters();
chapters.forEach(chapter => {
  console.log(chapter.title);
});
```

#### `getChapter(chapterId: string): EpubChapter | undefined`

获取指定章节信息。

**参数**：
- `chapterId`: 章节 ID

**返回**：`EpubChapter | undefined`

#### `loadChapter(chapterId: string): Promise<string>`

加载章节内容。

**参数**：
- `chapterId`: 章节 ID

**返回**：`Promise<string>` - 章节 HTML 内容

**抛出**：
- `Error` - 如果章节不存在

**示例**：

```typescript
const content = await parser.loadChapter('chapter-1');
contentDiv.innerHTML = content;
```

#### `getMetadata(): EpubMetadata`

获取书籍元数据。

**返回**：`EpubMetadata`

```typescript
interface EpubMetadata {
  title: string;
  author: string;
  publisher?: string;
  language?: string;
  cover?: string;
  description?: string;
}
```

#### `getCoverImage(): Promise<Blob | null>`

获取封面图片。

**返回**：`Promise<Blob | null>`

**示例**：

```typescript
const coverBlob = await parser.getCoverImage();
if (coverBlob) {
  const url = URL.createObjectURL(coverBlob);
  imgElement.src = url;
}
```

#### `loadResource(resourcePath: string): Promise<Blob | null>`

加载资源文件（图片等）。

**参数**：
- `resourcePath`: 资源路径

**返回**：`Promise<Blob | null>`

#### `preloadAdjacentChapters(currentChapterId: string): Promise<void>`

预加载相邻章节（优化体验）。

**参数**：
- `currentChapterId`: 当前章节 ID

#### `getProgress(chapterId: string): number`

获取阅读进度百分比。

**参数**：
- `chapterId`: 章节 ID

**返回**：`number` - 0-100 的百分比

#### `close(): Promise<void>`

清理资源，释放内存。

---

## HighlightSystem

高精度划线定位系统。

### 构造函数

```typescript
const highlightSystem = new HighlightSystem();
```

### 方法

#### `createHighlight(selection: Selection, document: Document, color?: string, note?: string): Highlight | null`

创建划线。

**参数**：
- `selection`: 浏览器选区对象
- `document`: Document 对象
- `color`: 划线颜色（默认：`#ffeb3b`）
- `note`: 笔记内容（可选）

**返回**：`Highlight | null`

```typescript
interface Highlight {
  id: string;
  position: HighlightPosition;
  text: string;
  color: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

interface HighlightPosition {
  cfi: string;              // CFI 标识符
  textOffset: number;       // 文本偏移量
  semanticContext: string;  // 语义上下文
  elementPath: string;      // DOM 路径
  timestamp: number;
}
```

**示例**：

```typescript
const selection = window.getSelection();
const highlight = highlightSystem.createHighlight(
  selection,
  document,
  '#ffeb3b',
  '这段很有意思'
);
```

#### `restoreRange(position: HighlightPosition, document: Document): Range | null`

从位置信息恢复选区。

**参数**：
- `position`: 划线位置信息
- `document`: Document 对象

**返回**：`Range | null`

#### `renderHighlights(document: Document): void`

在文档中渲染所有划线。

**参数**：
- `document`: Document 对象

#### `getHighlights(): Highlight[]`

获取所有划线。

#### `getHighlight(id: string): Highlight | undefined`

获取指定划线。

#### `deleteHighlight(id: string): boolean`

删除划线。

#### `updateHighlight(id: string, updates: Partial<Highlight>): boolean`

更新划线。

---

## VirtualHighlightRenderer

虚拟滚动划线渲染器，优化大量划线的性能。

### 构造函数

```typescript
const renderer = new VirtualHighlightRenderer(highlightSystem);
```

**参数**：
- `highlightSystem`: HighlightSystem 实例

### 方法

#### `setHighlights(highlights: Highlight[]): void`

设置划线数据。

**参数**：
- `highlights`: 划线数组

#### `renderVisibleHighlights(document: Document, viewport: ViewportInfo): void`

渲染可见区域的划线。

**参数**：
- `document`: Document 对象
- `viewport`: 视口信息

```typescript
interface ViewportInfo {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
}
```

#### `clearAllHighlights(document: Document): void`

清除所有渲染的划线。

#### `getVisibleCount(): number`

获取当前可见划线数量。

#### `getTotalCount(): number`

获取总划线数量。

#### `getPerformanceStats(): object`

获取性能统计。

**返回**：

```typescript
{
  totalHighlights: number;
  visibleHighlights: number;
  renderQueueSize: number;
  lastRenderTime: number;
}
```

### 辅助函数

#### `createVirtualScrollObserver(element: HTMLElement, renderer: VirtualHighlightRenderer, document: Document): () => void`

创建虚拟滚动观察器。

**参数**：
- `element`: 滚动容器元素
- `renderer`: VirtualHighlightRenderer 实例
- `document`: Document 对象

**返回**：清理函数

**示例**：

```typescript
const cleanup = createVirtualScrollObserver(
  contentElement,
  renderer,
  document
);

// 组件卸载时清理
useEffect(() => {
  return cleanup;
}, []);
```

---

## AIAssistant

AI 思考辅助管道，基于 LangChain.js。

### 构造函数

```typescript
const aiAssistant = new AIAssistant(apiKey?, baseURL?);
```

**参数**：
- `apiKey`: DashScope API Key（可选，默认从环境变量读取）
- `baseURL`: API 基础 URL（可选）

### 方法

#### `analyzeContent(content: string): Promise<AIAnalysis>`

生成完整的内容分析。

**参数**：
- `content`: 文本内容

**返回**：`Promise<AIAnalysis>`

```typescript
interface AIAnalysis {
  summary: string;        // 内容摘要
  insights: string[];     // 深度洞察
  questions: string[];    // 启发式问题
  connections: string[];  // 知识关联
}
```

**示例**：

```typescript
const analysis = await aiAssistant.analyzeContent(chapterContent);
console.log('摘要:', analysis.summary);
console.log('洞察:', analysis.insights);
```

#### `generateSummary(content: string): Promise<string>`

生成内容摘要。

**参数**：
- `content`: 文本内容

**返回**：`Promise<string>`

#### `generateInsights(content: string): Promise<string>`

生成深度洞察。

#### `generateQuestions(content: string): Promise<string>`

生成启发式问题。

#### `generateThinkingAngles(content: string, context?: string[]): Promise<string[]>`

生成多角度思考。

**参数**：
- `content`: 文本内容
- `context`: 相关上下文（可选）

#### `optimizePrompt(basePrompt: string, examples?: string[]): Promise<string>`

优化提示词。

**参数**：
- `basePrompt`: 原始提示词
- `examples`: 示例（可选）

---

## StorageManager

离线数据管理，基于 IndexedDB。

### 构造函数

```typescript
const storage = new StorageManager();
await storage.init();
```

### 划线管理

#### `saveHighlight(highlight: Highlight): Promise<void>`

保存划线。

#### `getHighlightsByBook(bookId: string): Promise<Highlight[]>`

获取书籍的所有划线。

#### `getHighlightsByChapter(bookId: string, chapterId: string): Promise<Highlight[]>`

获取章节的所有划线。

#### `deleteHighlight(id: string): Promise<void>`

删除划线。

#### `searchHighlights(query: string): Promise<Highlight[]>`

搜索划线（全文搜索）。

**示例**：

```typescript
const results = await storage.searchHighlights('重要');
```

### 笔记管理

#### `saveNote(note: BookNote): Promise<void>`

保存笔记。

```typescript
interface BookNote {
  id: string;
  bookId: string;
  title: string;
  content: string;
  chapter?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
```

#### `getNotesByBook(bookId: string): Promise<BookNote[]>`

获取书籍的所有笔记。

#### `getAllNotes(): Promise<BookNote[]>`

获取所有笔记。

#### `getNotesByTag(tag: string): Promise<BookNote[]>`

按标签获取笔记。

#### `searchNotes(query: string): Promise<BookNote[]>`

搜索笔记。

#### `deleteNote(id: string): Promise<void>`

删除笔记。

### 书籍管理

#### `saveBook(book: BookMetadata): Promise<void>`

保存书籍元数据。

```typescript
interface BookMetadata {
  id: string;
  title: string;
  author: string;
  cover?: string;
  filePath?: string;
  progress: number;
  lastReadAt: number;
  createdAt: number;
}
```

#### `getAllBooks(): Promise<BookMetadata[]>`

获取所有书籍。

#### `getBook(id: string): Promise<BookMetadata | undefined>`

获取书籍信息。

#### `updateProgress(bookId: string, progress: number): Promise<void>`

更新阅读进度。

### 导出功能

#### `exportToJSON(): Promise<string>`

导出所有数据为 JSON。

**返回**：JSON 字符串

#### `exportToMarkdown(bookId?: string): Promise<string>`

导出为 Markdown 读书报告。

**参数**：
- `bookId`: 书籍 ID（可选，不传则导出所有书籍）

**返回**：Markdown 字符串

#### `exportToMindMap(bookId: string): Promise<string>`

导出为思维导图格式（JSON）。

**返回**：JSON 字符串

**示例**：

```typescript
const markdown = await storage.exportToMarkdown(bookId);
const blob = new Blob([markdown], { type: 'text/markdown' });
const url = URL.createObjectURL(blob);
// 下载文件
```

#### `clearAll(): Promise<void>`

清空所有数据。

---

## MCPClient

MCP 协议客户端，用于集成外部服务。

### 构造函数

```typescript
const mcpClient = new MCPClient();
```

### 方法

#### `connect(serverPath?: string): Promise<void>`

连接到 MCP 服务器。

**参数**：
- `serverPath`: 服务器路径（可选）

**示例**：

```typescript
await mcpClient.connect();
// 或指定自定义路径
await mcpClient.connect('/path/to/mcp-server');
```

#### `disconnect(): Promise<void>`

断开连接。

#### `getBookshelf(): Promise<BookInfo[]>`

获取书架列表。

**返回**：`Promise<BookInfo[]>`

```typescript
interface BookInfo {
  id: string;
  title: string;
  author: string;
  cover?: string;
  progress?: number;
  notesCount?: number;
}
```

#### `searchBooks(query: string): Promise<BookInfo[]>`

搜索书籍。

**参数**：
- `query`: 搜索关键词

#### `getBookNotes(bookId: string): Promise<BookNote[]>`

获取书籍笔记。

**参数**：
- `bookId`: 书籍 ID

#### `syncNotes(notes: BookNote[]): Promise<boolean>`

同步本地笔记到服务器。

#### `generateReadingAnalysis(notes: BookNote[]): Promise<ReadingAnalysis>`

生成个性化阅读分析。

**返回**：`Promise<ReadingAnalysis>`

```typescript
interface ReadingAnalysis {
  totalBooks: number;
  totalNotes: number;
  readingProgress: number;
  favoriteCategories: string[];
  readingTrends: Array<{ date: string; count: number }>;
  knowledgeGraph: Array<{ source: string; target: string; weight: number }>;
}
```

#### `classifyNotes(notes: BookNote[]): Promise<Map<string, BookNote[]>>`

智能分类笔记。

**返回**：按类别分组的笔记

#### `buildKnowledgeConnections(notes: BookNote[]): Promise<Array<{ source: string; target: string; weight: number }>>`

构建知识关联图。

---

## 配置

### DashScope 配置

```typescript
import { DASHSCOPE_CONFIG, getApiKey, saveApiKey } from './config/dashscope';

// 获取 API Key
const apiKey = getApiKey();

// 保存 API Key
saveApiKey('sk-your-api-key');

// 模型配置
const model = DASHSCOPE_CONFIG.MODELS.NORMAL; // qwen-plus
```

### 可用配置

```typescript
DASHSCOPE_CONFIG = {
  API_KEY: string;
  BASE_URL: string;
  MODELS: {
    NORMAL: 'qwen-plus',
    COMPLEX: 'qwen-max',
    TURBO: 'qwen-turbo'
  };
  TEMPERATURE: {
    CREATIVE: 0.9,
    BALANCED: 0.7,
    PRECISE: 0.3
  };
  MAX_TOKENS: {
    SHORT: 1000,
    MEDIUM: 2000,
    LONG: 4000
  };
}
```

---

## 事件

### 划线点击事件

```typescript
window.addEventListener('highlightClick', (event: CustomEvent) => {
  const highlight = event.detail as Highlight;
  console.log('点击了划线:', highlight.text);
});
```

---

## 类型定义

所有类型定义可以从相应的模块导入：

```typescript
import type { EpubChapter, EpubMetadata } from './parse/Parse';
import type { Highlight, HighlightPosition } from './highlight/HighlightSystem';
import type { AIAnalysis } from './ai/AIAssistant';
import type { BookNote, BookMetadata } from './storage/StorageManager';
```

---

**最后更新**: 2025-01-08

