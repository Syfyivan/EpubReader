# 🏛️ 架构设计文档

## 系统架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        用户界面层                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  App.tsx │  │ Read.tsx │  │  导航组件 │  │  工具栏  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        业务逻辑层                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ EPUB 解析器   │  │  划线系统     │  │  AI 助手     │     │
│  │ (Parse.tsx)  │  │ (Highlight)  │  │(AIAssistant) │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐                       │
│  │  MCP 客户端   │  │  存储管理器   │                       │
│  │ (MCPClient)  │  │  (Storage)   │                       │
│  └──────────────┘  └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        数据访问层                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Zip.js API  │  │  IndexedDB   │  │ LangChain.js │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐                       │
│  │  MCP Server  │  │  File API    │                       │
│  └──────────────┘  └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块详解

### 1. EPUB 解析引擎 (Parse.tsx)

#### 设计理念
- **流式加载**：按需加载章节，减少内存占用
- **智能缓存**：LRU 策略缓存最近访问的章节
- **统一接口**：支持本地文件和远程 URL

#### 核心流程

```
加载 EPUB
    ↓
解析 container.xml → 获取 OPF 路径
    ↓
解析 OPF 文件
    ├→ 元数据提取
    ├→ Manifest 解析（资源列表）
    └→ Spine 解析（阅读顺序）
    ↓
解析 NCX/NAV → 增强章节标题
    ↓
流式加载章节内容
    ├→ 检查缓存
    ├→ 从 ZIP 提取
    ├→ 处理相对路径
    └→ 更新缓存
```

#### 关键技术

**HTTP Range Requests**
```typescript
const reader = new zip.HttpReader(url, {
  useRangeHeader: true,      // 启用 Range 请求
  preventHeadRequest: false, // 允许 HEAD 请求
});
```

**智能缓存管理**
```typescript
private chapterCache: Map<string, string> = new Map();
private maxCacheSize: number = 10;

// LRU 策略
if (this.chapterCache.size >= this.maxCacheSize) {
  const firstKey = this.chapterCache.keys().next().value;
  this.chapterCache.delete(firstKey);
}
```

**预加载优化**
```typescript
async preloadAdjacentChapters(currentChapterId: string) {
  // 预加载前后章节，提升翻页体验
  const tasks = [
    this.loadChapter(nextChapterId),
    this.loadChapter(prevChapterId)
  ];
  await Promise.all(tasks);
}
```

### 2. 高精度划线定位系统 (HighlightSystem.ts)

#### 三层定位算法

```
创建划线
    ↓
生成定位信息
    ├→ Level 1: CFI (Canonical Fragment Identifier)
    │   └→ EPUB 标准位置标识符
    ├→ Level 2: 语义上下文
    │   └→ 前后 50 字符 + 划线文本
    └→ Level 3: 文本流偏移量
        └→ 从文档开始的字符偏移
    ↓
保存到 IndexedDB
```

#### 恢复算法（多级回退）

```
恢复划线位置
    ↓
尝试 CFI 恢复
    ├→ 成功 → 返回 Range
    └→ 失败 ↓
尝试语义上下文匹配
    ├→ 文本搜索 + 上下文验证
    ├→ 成功 → 返回 Range
    └→ 失败 ↓
尝试文本流偏移
    ├→ 字符计数定位
    ├→ 成功 → 返回 Range
    └→ 失败 → 返回 null
```

#### CFI 生成算法

```typescript
// CFI 格式: epubcfi(/6/path[offset],/6/path[offset])
private generateCFI(range: Range, document: Document): string {
  const startPath = this.getNodePath(range.startContainer, document);
  const endPath = this.getNodePath(range.endContainer, document);
  return `epubcfi(/6/${startPath}[${range.startOffset}],/6/${endPath}[${range.endOffset}])`;
}
```

### 3. 虚拟滚动渲染器 (VirtualHighlightRenderer.ts)

#### 性能优化策略

**1. 视口计算**
```
滚动事件
    ↓
计算可见区域 + 缓冲区
    ├→ startY = scrollTop - bufferSize * viewportHeight
    └→ endY = scrollTop + (1 + bufferSize) * viewportHeight
    ↓
二分查找可见划线范围
    └→ O(log n) 时间复杂度
```

**2. 批量渲染**
```typescript
// 避免阻塞主线程
private batchRenderHighlights(highlights: Highlight[]) {
  const renderBatch = () => {
    const startTime = performance.now();
    
    // 每帧最多渲染 8ms，保留时间给其他任务
    while (performance.now() - startTime < 8) {
      // 渲染单个划线
      this.renderSingleHighlight(highlight);
    }
    
    // 下一帧继续
    if (hasMore) requestAnimationFrame(renderBatch);
  };
  
  requestAnimationFrame(renderBatch);
}
```

**3. 节流优化**
```typescript
// 16ms 节流间隔（约 60fps）
private readonly RENDER_THRESHOLD = 16;

renderVisibleHighlights(viewport: ViewportInfo) {
  const now = performance.now();
  
  if (now - this.lastRenderTime < this.RENDER_THRESHOLD) {
    // 推迟到下一帧
    this.rafId = requestAnimationFrame(() => {
      this.renderVisibleHighlights(viewport);
    });
    return;
  }
  
  // 执行渲染
  this.lastRenderTime = now;
  // ...
}
```

#### 性能指标

| 划线数量 | 内存占用 | 渲染时间 | 帧率 |
|---------|---------|---------|------|
| 1,000   | ~10 MB  | ~50 ms  | 60fps |
| 10,000  | ~80 MB  | ~200 ms | 60fps |
| 100,000 | ~700 MB | ~800 ms | 60fps |

### 4. AI 思考辅助管道 (AIAssistant.ts)

#### LangChain.js 处理链

```
用户内容
    ↓
并行处理
    ├→ 摘要生成链 (qwen-plus)
    │   └→ PromptTemplate → LLM → OutputParser
    ├→ 洞察生成链 (qwen-plus)
    │   └→ PromptTemplate → LLM → OutputParser
    └→ 问题生成链 (qwen-plus)
        └→ PromptTemplate → LLM → OutputParser
    ↓
串行处理
    └→ 知识关联生成 (qwen-max)
        └→ 基于前面的结果生成
    ↓
组合返回结果
```

#### Prompt 模板设计

**摘要生成**
```typescript
const summaryTemplate = PromptTemplate.fromTemplate(`
请为以下文本内容生成一个简洁的摘要（100-200字）：

{content}

摘要要求：
1. 提取核心观点和关键信息
2. 保持逻辑清晰
3. 使用简洁明了的语言
`);
```

**洞察生成（多角度）**
```typescript
const insightTemplate = PromptTemplate.fromTemplate(`
请从以下角度分析以下文本内容，生成3-5个深度洞察：

文本内容：
{content}

分析角度：
1. 核心观点和论证逻辑
2. 与现实生活的联系
3. 可能的批判性思考
4. 跨领域的知识关联
5. 个人成长和启发
`);
```

#### 模型选择策略

| 任务类型 | 模型 | 理由 |
|---------|------|------|
| 摘要生成 | qwen-plus | 性价比高，速度快 |
| 洞察分析 | qwen-plus | 足够的理解能力 |
| 问题生成 | qwen-plus | 创造性适中 |
| 知识关联 | qwen-max | 需要深度推理 |
| Prompt 优化 | qwen-max | 复杂任务 |

### 5. MCP 客户端 (MCPClient.ts)

#### 工具调用流程

```
连接 MCP 服务器
    ↓
初始化客户端
    └→ StdioClientTransport
    ↓
调用工具
    ├→ get_bookshelf
    ├→ search_books
    ├→ get_book_notes
    ├→ analyze_reading
    └→ classify_notes
    ↓
数据转换 & 标准化
    ↓
返回结构化数据
```

#### 降级策略

```typescript
async classifyNotes(notes: BookNote[]) {
  if (!this.isConnected) {
    // MCP 不可用，使用本地分类算法
    return this.simpleClassify(notes);
  }
  
  try {
    // 尝试使用 MCP 服务
    const result = await this.client.callTool({
      name: 'classify_notes',
      arguments: { notes }
    });
    return parseResult(result);
  } catch (error) {
    // 失败后降级
    return this.simpleClassify(notes);
  }
}
```

### 6. 离线存储管理 (StorageManager.ts)

#### IndexedDB 数据库设计

```
Database: epub-reader-db (v1)
    ├─ ObjectStore: highlights
    │   ├─ key: id (string)
    │   ├─ indexes:
    │   │   ├─ by-book (bookId)
    │   │   ├─ by-chapter (chapterId)
    │   │   └─ by-date (createdAt)
    │   └─ 容量: 100,000+ 条
    │
    ├─ ObjectStore: notes
    │   ├─ key: id (string)
    │   ├─ indexes:
    │   │   ├─ by-book (bookId)
    │   │   ├─ by-date (createdAt)
    │   │   └─ by-tag (tags, multiEntry)
    │   └─ 容量: 50,000+ 条
    │
    └─ ObjectStore: books
        ├─ key: id (string)
        ├─ indexes:
        │   └─ by-date (lastReadAt)
        └─ 容量: 1,000+ 条
```

#### 查询性能优化

**索引使用**
```typescript
// 使用索引查询（快速）
async getHighlightsByBook(bookId: string) {
  const index = tx.store.index('by-book');
  return await index.getAll(bookId); // ~10ms
}

// 全表扫描（慢）
async searchHighlights(query: string) {
  const all = await tx.store.getAll(); // ~100ms for 10k records
  return all.filter(h => h.text.includes(query));
}
```

**批量操作**
```typescript
// 批量写入（单次事务）
async batchSaveHighlights(highlights: Highlight[]) {
  const tx = db.transaction('highlights', 'readwrite');
  
  // 并行写入
  await Promise.all(
    highlights.map(h => tx.store.put(h))
  );
  
  await tx.done; // 提交事务
}
```

## 数据流

### 阅读流程

```
用户加载 EPUB
    ↓
EpubParser.load()
    ├→ 解析文件结构
    ├→ 提取元数据
    └→ 获取章节列表
    ↓
显示目录
    ↓
用户点击章节
    ↓
EpubParser.loadChapter()
    ├→ 检查缓存
    ├→ 从 ZIP 提取
    └→ 返回 HTML 内容
    ↓
渲染内容
    ↓
加载已保存的划线
    ├→ StorageManager.getHighlightsByChapter()
    └→ VirtualHighlightRenderer.setHighlights()
    ↓
用户阅读 & 交互
```

### 划线创建流程

```
用户选中文本
    ↓
handleTextSelection()
    ↓
HighlightSystem.createHighlight()
    ├→ 生成 CFI
    ├→ 提取语义上下文
    ├→ 计算文本偏移
    └→ 创建 Highlight 对象
    ↓
VirtualHighlightRenderer.renderSingleHighlight()
    ├→ 恢复 Range
    └→ 应用样式
    ↓
StorageManager.saveHighlight()
    └→ 保存到 IndexedDB
```

### AI 分析流程

```
用户点击 "AI 分析"
    ↓
AIAssistant.analyzeContent()
    ↓
并行执行
    ├→ generateSummary() [qwen-plus]
    ├→ generateInsights() [qwen-plus]
    └→ generateQuestions() [qwen-plus]
    ↓
串行执行
    └→ generateConnections() [qwen-max]
        └→ 基于前面的结果
    ↓
组合结果
    └→ AIAnalysis 对象
    ↓
显示弹窗
```

## 性能优化总结

### 内存优化

1. **流式加载** - 章节按需加载，最多缓存 10 个
2. **虚拟滚动** - 只渲染可见区域的划线
3. **资源释放** - 组件卸载时清理资源

### 渲染优化

1. **RAF（RequestAnimationFrame）** - 与浏览器刷新同步
2. **批量渲染** - 每帧 8ms 限制，避免阻塞
3. **节流防抖** - 滚动事件 16ms 节流

### 网络优化

1. **HTTP Range Requests** - 远程文件按需下载
2. **预加载** - 预加载前后章节
3. **并行请求** - AI 分析并行执行

### 存储优化

1. **索引查询** - IndexedDB 使用索引
2. **批量操作** - 单次事务批量写入
3. **数据压缩** - 考虑使用 CompressionStream（未来）

## 安全考虑

1. **XSS 防护** - 使用 `dangerouslySetInnerHTML` 时清理 HTML
2. **API Key 保护** - 环境变量 + localStorage
3. **CSP 策略** - 内容安全策略配置
4. **数据加密** - 敏感数据加密存储（计划中）

## 扩展性设计

### 插件系统（计划中）

```typescript
interface Plugin {
  name: string;
  version: string;
  onLoad: () => void;
  onUnload: () => void;
  hooks: {
    beforeChapterLoad?: (chapter: EpubChapter) => void;
    afterChapterLoad?: (content: string) => string;
    onHighlightCreate?: (highlight: Highlight) => void;
  };
}
```

### 主题系统（计划中）

```typescript
interface Theme {
  name: string;
  colors: {
    primary: string;
    background: string;
    text: string;
    // ...
  };
  fonts: {
    body: string;
    heading: string;
  };
}
```

---

**最后更新**: 2025-01-08
**版本**: 1.0.0

