# 🤖 AI 模型配置指南

## 模型选择策略

本项目根据不同的任务类型，智能选择最合适的模型：

### 1. qwen-plus（普通任务）

**适用场景**：
- ✅ 内容摘要生成
- ✅ 深度洞察分析
- ✅ 启发式问题生成
- ✅ 一般性文本理解

**特点**：
- 性价比高
- 响应速度快
- 适合大多数场景
- 成本低廉

**配置**：
```typescript
const aiAssistant = new AIAssistant();
const summary = await aiAssistant.generateSummary(content);
// 自动使用 qwen-plus
```

### 2. qwen3-coder-flash（代码任务）

**适用场景**：
- ✅ 代码生成
- ✅ 代码解释
- ✅ 代码审查
- ✅ 代码优化建议
- ✅ Bug 分析

**特点**：
- 专门针对代码优化
- 支持多种编程语言
- 理解代码上下文
- 生成高质量代码

**配置**：
```typescript
// 生成代码
const code = await aiAssistant.generateCode(
  "创建一个 React Hook 用于管理本地存储",
  "typescript"
);

// 解释代码
const explanation = await aiAssistant.explainCode(
  sourceCode,
  "typescript"
);

// 代码审查
const review = await aiAssistant.reviewCode(
  sourceCode,
  "typescript"
);
```

### 3. qwen-max（复杂任务）

**适用场景**：
- ✅ 知识关联生成
- ✅ 多角度思考
- ✅ Prompt 优化
- ✅ 复杂推理
- ✅ 跨领域分析

**特点**：
- 能力最强
- 深度推理
- 适合复杂场景
- 理解力强

**配置**：
```typescript
// 生成知识关联（自动使用 qwen-max）
const connections = await aiAssistant.generateConnections(
  content,
  insights
);

// 生成思考角度（自动使用 qwen-max）
const angles = await aiAssistant.generateThinkingAngles(
  content,
  context
);

// 优化提示词（自动使用 qwen-max）
const optimized = await aiAssistant.optimizePrompt(
  basePrompt,
  examples
);
```

## API 配置

### 当前配置

```typescript
export const DASHSCOPE_CONFIG = {
  API_KEY: "sk-60af58b5c55947e38b08e2dc212bfb07",
  BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  
  MODELS: {
    NORMAL: "qwen-plus",           // 普通任务
    CODER: "qwen3-coder-flash",    // 代码任务
    COMPLEX: "qwen-max",           // 复杂任务
    TURBO: "qwen-turbo"            // 快速任务（备用）
  }
};
```

### 温度参数

```typescript
TEMPERATURE: {
  CREATIVE: 0.9,    // 创造性任务（如故事生成）
  BALANCED: 0.7,    // 平衡模式（默认）
  PRECISE: 0.3      // 精确模式（如代码生成）
}
```

### Token 限制

```typescript
MAX_TOKENS: {
  SHORT: 1000,      // 短文本（摘要）
  MEDIUM: 2000,     // 中等长度（分析）
  LONG: 4000        // 长文本（详细报告）
}
```

## 使用示例

### 场景 1：阅读内容分析

```typescript
const aiAssistant = new AIAssistant();

// 完整分析（自动选择模型）
const analysis = await aiAssistant.analyzeContent(chapterContent);

// 结果包含：
// - summary (qwen-plus)
// - insights (qwen-plus)
// - questions (qwen-plus)
// - connections (qwen-max)
```

**模型使用**：
- 前三项并行执行，使用 `qwen-plus`
- 最后一项串行执行，使用 `qwen-max`

### 场景 2：代码相关任务

```typescript
// 生成工具函数
const utilCode = await aiAssistant.generateCode(
  "创建一个防抖函数，支持立即执行选项",
  "typescript"
);
// 使用 qwen3-coder-flash

// 解释复杂代码
const explanation = await aiAssistant.explainCode(`
function memoize(fn) {
  const cache = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) {
      cache.set(key, fn(...args));
    }
    return cache.get(key);
  };
}
`);
// 使用 qwen3-coder-flash

// 代码审查
const review = await aiAssistant.reviewCode(sourceCode, "typescript");
// 使用 qwen3-coder-flash
```

### 场景 3：高级推理

```typescript
// 生成多角度思考
const angles = await aiAssistant.generateThinkingAngles(
  "人工智能的伦理问题",
  ["隐私保护", "算法偏见", "就业影响"]
);
// 使用 qwen-max

// 优化提示词
const betterPrompt = await aiAssistant.optimizePrompt(
  "帮我分析这段文本",
  ["示例1：详细分析", "示例2：多角度解读"]
);
// 使用 qwen-max
```

## 成本优化

### 策略 1：智能模型选择

```typescript
// 简单任务 - 使用 qwen-plus（便宜）
const summary = await aiAssistant.generateSummary(content);

// 复杂任务 - 使用 qwen-max（贵但效果好）
const connections = await aiAssistant.generateConnections(content, insights);
```

### 策略 2：批量处理

```typescript
// 并行处理多个简单任务
const [summary1, summary2, summary3] = await Promise.all([
  aiAssistant.generateSummary(content1),
  aiAssistant.generateSummary(content2),
  aiAssistant.generateSummary(content3)
]);
```

### 策略 3：缓存结果

```typescript
// 在 StorageManager 中缓存 AI 分析结果
const cached = await storage.getCachedAnalysis(contentHash);
if (cached) {
  return cached;
}

const analysis = await aiAssistant.analyzeContent(content);
await storage.cacheAnalysis(contentHash, analysis);
```

## 性能对比

| 模型 | 速度 | 成本 | 能力 | 适用场景 |
|------|------|------|------|---------|
| qwen-plus | ⚡⚡⚡ | 💰 | ⭐⭐⭐ | 日常任务 |
| qwen3-coder-flash | ⚡⚡⚡ | 💰 | ⭐⭐⭐⭐ | 代码任务 |
| qwen-max | ⚡⚡ | 💰💰💰 | ⭐⭐⭐⭐⭐ | 复杂推理 |
| qwen-turbo | ⚡⚡⚡⚡ | 💰 | ⭐⭐ | 快速响应 |

## 错误处理

### 1. API Key 无效

```typescript
try {
  const analysis = await aiAssistant.analyzeContent(content);
} catch (error) {
  if (error.message.includes('401')) {
    console.error('API Key 无效或已过期');
    // 提示用户更新 API Key
  }
}
```

### 2. 请求限流

```typescript
// 使用指数退避重试
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.message.includes('429')) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

const analysis = await retryWithBackoff(() => 
  aiAssistant.analyzeContent(content)
);
```

### 3. Token 超限

```typescript
// 分段处理长文本
function chunkText(text: string, maxLength: number = 2000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}

const chunks = chunkText(longContent);
const summaries = await Promise.all(
  chunks.map(chunk => aiAssistant.generateSummary(chunk))
);
const finalSummary = summaries.join('\n\n');
```

## 最佳实践

### 1. 合理选择模型

```typescript
// ✅ 好的做法
const summary = await aiAssistant.generateSummary(content);  // qwen-plus
const code = await aiAssistant.generateCode(desc, 'ts');     // qwen3-coder-flash
const connections = await aiAssistant.generateConnections(); // qwen-max

// ❌ 不好的做法
// 所有任务都用 qwen-max（浪费成本）
```

### 2. 合并相似请求

```typescript
// ✅ 好的做法：一次性分析
const analysis = await aiAssistant.analyzeContent(content);
// 包含：summary, insights, questions, connections

// ❌ 不好的做法：多次单独请求
const summary = await aiAssistant.generateSummary(content);
const insights = await aiAssistant.generateInsights(content);
const questions = await aiAssistant.generateQuestions(content);
```

### 3. 使用适当的温度

```typescript
// 代码生成：低温度（精确）
const llmCoder = new ChatOpenAI({
  temperature: 0.3,
  modelName: 'qwen3-coder-flash'
});

// 创意写作：高温度（多样）
const llmCreative = new ChatOpenAI({
  temperature: 0.9,
  modelName: 'qwen-max'
});
```

## 自定义配置

如果需要修改模型配置，编辑 `src/config/dashscope.ts`：

```typescript
export const DASHSCOPE_CONFIG = {
  API_KEY: "your-api-key",
  BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  
  MODELS: {
    NORMAL: "qwen-plus",
    CODER: "qwen3-coder-flash",
    COMPLEX: "qwen-max",
    TURBO: "qwen-turbo"
  },
  
  TEMPERATURE: {
    CREATIVE: 0.9,
    BALANCED: 0.7,
    PRECISE: 0.3
  },
  
  MAX_TOKENS: {
    SHORT: 1000,
    MEDIUM: 2000,
    LONG: 4000
  }
};
```

## 常见问题

### Q: 如何知道使用了哪个模型？

在控制台可以看到请求日志：

```typescript
console.log('Using model:', DASHSCOPE_CONFIG.MODELS.NORMAL);
```

### Q: 可以动态切换模型吗？

可以，创建 AIAssistant 时传入不同的模型：

```typescript
const aiAssistant = new AIAssistant();
// 内部会根据任务自动选择模型
```

### Q: 如何估算成本？

参考阿里云 DashScope 定价：
- qwen-plus: 约 ¥0.004/1k tokens
- qwen3-coder-flash: 约 ¥0.004/1k tokens
- qwen-max: 约 ¥0.04/1k tokens

---

**最后更新**: 2025-01-08
**配置状态**: ✅ 已配置完成，可直接使用

