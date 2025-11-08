# 后端设置指南

## 快速开始

### 1. 启动后端服务

打开**新的终端窗口**，运行：

```bash
npm run backend
```

你应该看到类似这样的输出：

```
Backend server is running on http://localhost:3001
```

### 2. 启动前端服务

在**另一个终端窗口**，运行：

```bash
npm run dev
```

前端将在 http://localhost:5173 启动（或其他端口如 5174）

### 3. 测试 AI 功能

1. 打开浏览器访问前端地址
2. 导入一个 EPUB 文件
3. 阅读一些内容
4. 点击"AI 分析"按钮
5. 查看生成的摘要、洞察和问题

## 架构说明

### 前端到后端的调用流程

```
用户点击"AI 分析" 
  ↓
Read.tsx (handleAnalyzeContent)
  ↓
aiClient.analyzeContent(content)
  ↓
HTTP POST → http://localhost:3001/api/ai/analyze
  ↓
AIController.analyzeContent()
  ↓
AIService.analyzeContent()
  ↓
LangChain.js → DashScope API
  ↓
返回 AIAnalysis 结果
```

### 为什么需要后端？

1. **安全性**：API Key 不暴露给前端用户
2. **集中管理**：统一的 AI 配置和提示词管理
3. **性能**：可以添加缓存、限流等功能
4. **扩展性**：便于添加更多 AI 功能

## API 端点

### 1. 内容分析

```bash
curl -X POST http://localhost:3001/api/ai/analyze \
  -H "Content-Type: application/json" \
  -d '{"content": "你要分析的文本内容"}'
```

### 2. 代码生成

```bash
curl -X POST http://localhost:3001/api/ai/code/generate \
  -H "Content-Type: application/json" \
  -d '{"description": "实现一个快速排序算法", "language": "typescript"}'
```

### 3. 代码解释

```bash
curl -X POST http://localhost:3001/api/ai/code/explain \
  -H "Content-Type: application/json" \
  -d '{"code": "function quickSort(arr) {...}", "language": "javascript"}'
```

### 4. 代码审查

```bash
curl -X POST http://localhost:3001/api/ai/code/review \
  -H "Content-Type: application/json" \
  -d '{"code": "你的代码", "language": "typescript"}'
```

## 常见问题

### Q: 后端启动失败怎么办？

**A:** 检查以下几点：
1. 确保已安装后端依赖：`cd backend && npm install`
2. 检查 `backend/.env` 文件是否存在且配置正确
3. 确保端口 3001 没有被占用
4. 查看错误信息，可能是 API Key 无效

### Q: 前端显示"AI 分析失败，请确保后端服务已启动"

**A:** 
1. 确认后端服务正在运行
2. 检查前端环境变量 `VITE_API_BASE_URL` 配置
3. 打开浏览器开发者工具，查看 Network 标签页的错误信息

### Q: API 请求超时

**A:** 
1. 检查网络连接
2. 确认 DashScope API Key 有效且有余额
3. 尝试减少分析内容的长度

### Q: 如何修改 AI 模型配置？

**A:** 编辑 `backend/src/config/dashscope.config.ts`：

```typescript
export const DashScopeConfig = {
  apiKey: process.env.DASHSCOPE_API_KEY || "",
  baseURL: process.env.DASHSCOPE_BASE_URL || "...",
  models: {
    SUMMARY: "qwen-plus",      // 摘要生成模型
    ANALYSIS: "qwen-max",      // 复杂分析模型
    CODER: "qwen3-coder-flash" // 代码相关模型
  },
  temperature: 0.7,  // 调整创造性（0-1）
  maxTokens: 4000,   // 最大输出长度
};
```

### Q: 如何更换 API Key？

**A:** 编辑 `backend/.env` 文件：

```env
DASHSCOPE_API_KEY=你的新API_KEY
```

然后重启后端服务。

## 性能优化建议

### 1. 启用请求缓存

为频繁分析的内容添加缓存：

```typescript
// backend/src/ai/ai.service.ts
private cache = new Map<string, AIAnalysis>();

async analyzeContent(dto: AnalyzeContentDto): Promise<AIAnalysis> {
  const cacheKey = this.hash(dto.content);
  if (this.cache.has(cacheKey)) {
    return this.cache.get(cacheKey)!;
  }
  
  const result = await this.performAnalysis(dto);
  this.cache.set(cacheKey, result);
  return result;
}
```

### 2. 添加请求限流

防止 API 滥用：

```typescript
// 安装 @nestjs/throttler
npm install @nestjs/throttler

// app.module.ts
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 10, // 每分钟最多 10 个请求
    }),
    AIModule,
  ],
})
export class AppModule {}
```

### 3. 添加日志记录

```typescript
// backend/src/ai/ai.service.ts
import { Logger } from '@nestjs/common';

export class AIService {
  private readonly logger = new Logger(AIService.name);

  async analyzeContent(dto: AnalyzeContentDto): Promise<AIAnalysis> {
    this.logger.log('Starting AI analysis...');
    const startTime = Date.now();
    
    try {
      const result = await this.performAnalysis(dto);
      const duration = Date.now() - startTime;
      this.logger.log(`AI analysis completed in ${duration}ms`);
      return result;
    } catch (error) {
      this.logger.error('AI analysis failed', error);
      throw error;
    }
  }
}
```

## 部署到生产环境

### 1. 构建项目

```bash
# 构建前端
npm run build

# 构建后端
cd backend
npm run build
```

### 2. 环境变量配置

生产环境的 `.env` 文件：

```env
DASHSCOPE_API_KEY=生产环境的API_KEY
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
PORT=3001
FRONTEND_URL=https://your-domain.com
NODE_ENV=production
```

### 3. 使用 PM2 管理进程

```bash
# 安装 PM2
npm install -g pm2

# 启动后端
cd backend
pm2 start dist/main.js --name epub-reader-backend

# 查看日志
pm2 logs epub-reader-backend

# 重启
pm2 restart epub-reader-backend
```

### 4. Nginx 配置（可选）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 开发调试技巧

### 1. 查看后端日志

后端会输出详细的日志信息，包括：
- 服务启动信息
- API 请求记录
- 错误堆栈信息

### 2. 使用 Postman 测试 API

导入以下 JSON 配置到 Postman：

```json
{
  "info": {
    "name": "EPUB Reader API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Analyze Content",
      "request": {
        "method": "POST",
        "header": [{"key": "Content-Type", "value": "application/json"}],
        "body": {
          "mode": "raw",
          "raw": "{\"content\": \"测试内容\"}"
        },
        "url": "http://localhost:3001/api/ai/analyze"
      }
    }
  ]
}
```

### 3. 启用 TypeScript Watch 模式

```bash
cd backend
npm run watch
```

文件修改后自动重新编译。

## 下一步

- [ ] 添加用户认证（JWT）
- [ ] 实现 AI 响应缓存
- [ ] 添加请求限流
- [ ] 集成日志系统
- [ ] 添加监控告警
- [ ] 实现流式响应（Server-Sent Events）
- [ ] 添加单元测试

## 技术支持

如遇到问题，请检查：
1. GitHub Issues
2. 项目文档
3. 后端日志输出
4. 浏览器控制台错误信息

---

**祝你使用愉快！** 🎉

