# 🤝 贡献指南

感谢你对 Epub 智能阅读器项目的兴趣！我们欢迎各种形式的贡献。

## 行为准则

- 尊重所有贡献者
- 保持友善和专业
- 接受建设性的批评
- 关注对项目最有利的事情

## 如何贡献

### 报告 Bug

如果你发现了 bug，请创建一个 Issue 并包含以下信息：

- **简短描述**：一句话描述问题
- **重现步骤**：详细的重现步骤
- **预期行为**：你期望发生什么
- **实际行为**：实际发生了什么
- **环境信息**：浏览器、操作系统、Node.js 版本等
- **截图**：如果适用，添加截图

**Bug 报告模板**：

```markdown
## 问题描述
简短描述问题

## 重现步骤
1. 打开应用
2. 点击 XXX
3. 滚动到 YYY
4. 看到错误

## 预期行为
应该显示 XXX

## 实际行为
显示了 YYY

## 环境信息
- 浏览器：Chrome 120
- 操作系统：Windows 11
- Node.js：18.0.0

## 截图
[如有需要]
```

### 建议新功能

创建一个 Feature Request Issue：

```markdown
## 功能描述
清晰简洁地描述你想要的功能

## 动机
为什么需要这个功能？它解决了什么问题？

## 建议的解决方案
你认为应该如何实现？

## 替代方案
考虑过其他方案吗？

## 额外信息
任何其他有帮助的信息
```

### 提交代码

#### 1. Fork 项目

点击页面右上角的 "Fork" 按钮

#### 2. 克隆你的 Fork

```bash
git clone https://github.com/your-username/epub-reader.git
cd epub-reader
```

#### 3. 创建分支

```bash
# 功能分支
git checkout -b feature/amazing-feature

# 修复分支
git checkout -b fix/bug-description

# 文档分支
git checkout -b docs/update-readme
```

**分支命名规范**：
- `feature/` - 新功能
- `fix/` - Bug 修复
- `docs/` - 文档更新
- `style/` - 代码格式（不影响功能）
- `refactor/` - 重构
- `test/` - 测试相关
- `chore/` - 构建/工具相关

#### 4. 安装依赖

```bash
npm install
```

#### 5. 进行修改

遵循我们的编码规范（见下文）

#### 6. 测试你的修改

```bash
# 运行开发服务器
npm run dev

# 运行类型检查
npm run type-check

# 运行 linter
npm run lint

# 运行测试（如果有）
npm run test
```

#### 7. 提交修改

```bash
git add .
git commit -m "feat: add amazing feature"
```

**提交信息规范（Conventional Commits）**：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type**：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试
- `chore`: 构建/工具

**示例**：

```bash
# 简单提交
git commit -m "feat: add dark mode support"

# 带作用域
git commit -m "fix(parser): handle malformed EPUB files"

# 带详细说明
git commit -m "feat(highlight): add color picker

- Add color picker component
- Support custom highlight colors
- Save color preferences to localStorage

Closes #123"
```

#### 8. 推送到你的 Fork

```bash
git push origin feature/amazing-feature
```

#### 9. 创建 Pull Request

1. 访问你的 Fork 页面
2. 点击 "New Pull Request"
3. 填写 PR 描述：

```markdown
## 变更描述
清楚地描述你的修改

## 相关 Issue
Closes #123

## 修改类型
- [ ] Bug 修复
- [x] 新功能
- [ ] 重大变更
- [ ] 文档更新

## 测试
- [x] 已添加测试用例
- [x] 所有测试通过
- [x] 已在本地测试

## 截图
[如果适用]

## 检查清单
- [x] 代码遵循项目规范
- [x] 已更新文档
- [x] 无 TypeScript 错误
- [x] 无 ESLint 警告
- [x] 已测试在多个浏览器
```

## 编码规范

### TypeScript

```typescript
// ✅ 好的
interface User {
  id: string;
  name: string;
  email: string;
}

function getUserById(id: string): Promise<User | null> {
  // 使用显式返回类型
}

// ❌ 不好的
function getUser(id) { // 缺少类型
  // ...
}
```

### 命名规范

```typescript
// 组件 - PascalCase
export function EpubReader() {}

// 函数 - camelCase
function loadChapter() {}

// 常量 - UPPER_SNAKE_CASE
const MAX_CACHE_SIZE = 10;

// 接口/类型 - PascalCase
interface EpubChapter {}
type HighlightColor = string;

// 私有属性 - 前缀下划线
class Parser {
  private _cache: Map<string, string>;
}
```

### 注释

```typescript
/**
 * 加载 EPUB 章节内容
 * 
 * @param chapterId - 章节ID
 * @returns 章节HTML内容
 * @throws {Error} 如果章节不存在
 * 
 * @example
 * ```typescript
 * const content = await parser.loadChapter('chapter-1');
 * ```
 */
async loadChapter(chapterId: string): Promise<string> {
  // 实现
}

// 单行注释：简短说明
const result = calculate(); // 计算结果

// 多行注释：复杂逻辑
/*
 * 这里使用二分查找是因为：
 * 1. 数据已排序
 * 2. 需要 O(log n) 时间复杂度
 * 3. 数据量可能很大
 */
```

### 代码组织

```typescript
// 1. 导入（按类型分组）
// React 相关
import { useState, useEffect } from 'react';

// 第三方库
import * as zip from '@zip.js/zip.js';

// 本地模块（按层级）
import { Parser } from './parse/Parser';
import { HighlightSystem } from './highlight/HighlightSystem';

// 类型
import type { Chapter } from './types';

// 样式
import './styles.css';

// 2. 类型定义
interface Props {}

// 3. 常量
const DEFAULT_CONFIG = {};

// 4. 组件/类
export function Component() {}

// 5. 辅助函数
function helper() {}
```

### 错误处理

```typescript
// ✅ 好的
async function loadFile(path: string): Promise<string> {
  try {
    const content = await fetchFile(path);
    return content;
  } catch (error) {
    console.error(`Failed to load file ${path}:`, error);
    throw new Error(`File loading failed: ${path}`);
  }
}

// ❌ 不好的
async function loadFile(path: string) {
  const content = await fetchFile(path); // 没有错误处理
  return content;
}
```

### 性能考虑

```typescript
// ✅ 使用 useMemo 缓存计算
const sortedData = useMemo(
  () => data.sort((a, b) => a.order - b.order),
  [data]
);

// ✅ 使用 useCallback 缓存函数
const handleClick = useCallback(() => {
  doSomething(id);
}, [id]);

// ✅ 避免不必要的重新渲染
const MemoizedComponent = memo(ExpensiveComponent);

// ✅ 使用虚拟化处理大列表
<VirtualList items={largeArray} />
```

### 测试

```typescript
describe('EpubParser', () => {
  it('should load local file', async () => {
    const parser = new EpubParser();
    const file = new File(['content'], 'test.epub');
    
    await parser.load(file);
    
    expect(parser.getChapters()).toHaveLength(3);
  });

  it('should handle invalid file', async () => {
    const parser = new EpubParser();
    const invalidFile = new File(['invalid'], 'test.txt');
    
    await expect(parser.load(invalidFile)).rejects.toThrow();
  });
});
```

## 开发工作流

### 本地开发

```bash
# 启动开发服务器（热重载）
npm run dev

# 在另一个终端运行类型检查（监听模式）
npm run type-check -- --watch
```

### 代码质量

```bash
# 运行所有检查
npm run lint        # ESLint
npm run type-check  # TypeScript
npm run format      # Prettier

# 自动修复
npm run lint -- --fix
npm run format -- --write
```

### 提交前检查

```bash
# 完整检查流程
npm run lint && npm run type-check && npm run test
```

### Git Hooks（推荐）

安装 husky 和 lint-staged：

```bash
npm install -D husky lint-staged

# 初始化 husky
npx husky init

# 添加 pre-commit hook
echo "npx lint-staged" > .husky/pre-commit
```

配置 `package.json`：

```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{css,md}": [
      "prettier --write"
    ]
  }
}
```

## 项目结构

```
src/
├── parse/          # EPUB 解析
│   └── Parse.tsx
├── highlight/      # 划线系统
│   ├── HighlightSystem.ts
│   └── VirtualHighlightRenderer.ts
├── ai/             # AI 功能
│   └── AIAssistant.ts
├── mcp/            # MCP 集成
│   └── MCPClient.ts
├── storage/        # 存储管理
│   └── StorageManager.ts
├── config/         # 配置
│   └── dashscope.ts
└── components/     # UI 组件
    ├── read/
    └── shared/
```

## 常见问题

### Q: 如何添加新的 AI 功能？

编辑 `src/ai/AIAssistant.ts`，添加新的处理链：

```typescript
private buildMyChain(): RunnableSequence {
  const template = PromptTemplate.fromTemplate(`...`);
  return RunnableSequence.from([
    template,
    this.llm,
    new StringOutputParser(),
  ]);
}
```

### Q: 如何支持新的导出格式？

编辑 `src/storage/StorageManager.ts`，添加新的导出方法：

```typescript
async exportToMyFormat(bookId: string): Promise<string> {
  const data = await this.getBookData(bookId);
  return convertToMyFormat(data);
}
```

### Q: 如何优化大文件性能？

- 使用虚拟滚动（已实现）
- 增加缓存大小
- 启用预加载
- 使用 Web Worker（计划中）

## 发布流程

1. 更新版本号：`npm version [patch|minor|major]`
2. 更新 CHANGELOG.md
3. 提交：`git commit -m "chore: release v1.x.x"`
4. 打标签：`git tag v1.x.x`
5. 推送：`git push && git push --tags`

## 联系方式

- GitHub Issues: [项目 Issues](https://github.com/yourusername/epub-reader/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/epub-reader/discussions)
- Email: your.email@example.com

## 许可证

通过贡献代码，你同意你的贡献将在 MIT 许可证下发布。

---

感谢你的贡献！ ❤️

