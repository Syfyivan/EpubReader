# EPUB Reader Backend API

这是 EPUB 智能阅读器的后端 API 服务，使用 Nest.js 框架构建，提供 AI 分析功能。

## 功能特性

- ✅ AI 内容分析（摘要、洞察、问题、知识关联）
- ✅ 代码生成
- ✅ 代码解释
- ✅ 代码审查
- ✅ CORS 支持
- ✅ 环境变量配置

## 技术栈

- **Nest.js** - 渐进式 Node.js 框架
- **LangChain.js** - AI 应用开发框架
- **TypeScript** - 类型安全
- **DashScope API** - 阿里云通义千问模型

## 安装

```bash
# 安装依赖
npm install
```

## 配置

环境变量配置在 `.env` 文件中：

```env
DASHSCOPE_API_KEY=your_api_key_here
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
PORT=3001
FRONTEND_URL=http://localhost:5173
```

**注意**：项目已预配置 API Key，可直接使用。

## 运行

### 开发模式

```bash
npm run dev
```

服务将在 http://localhost:3001 启动

### 生产模式

```bash
# 构建
npm run build

# 启动
npm start
```

## API 端点

### 1. 分析内容

**POST** `/api/ai/analyze`

请求体：
```json
{
  "content": "要分析的文本内容"
}
```

响应：
```json
{
  "summary": "内容摘要",
  "insights": ["洞察1", "洞察2", "洞察3"],
  "questions": ["问题1", "问题2", "问题3"],
  "connections": ["关联1", "关联2", "关联3"]
}
```

### 2. 生成代码

**POST** `/api/ai/code/generate`

请求体：
```json
{
  "description": "代码功能描述",
  "language": "typescript"
}
```

响应：
```json
{
  "code": "生成的代码"
}
```

### 3. 解释代码

**POST** `/api/ai/code/explain`

请求体：
```json
{
  "code": "要解释的代码",
  "language": "typescript"
}
```

响应：
```json
{
  "explanation": "代码解释"
}
```

### 4. 代码审查

**POST** `/api/ai/code/review`

请求体：
```json
{
  "code": "要审查的代码",
  "language": "typescript"
}
```

响应：
```json
{
  "review": "审查结果和建议"
}
```

## AI 模型配置

系统使用三种不同的模型：

| 模型 | 用途 | 参数 |
|------|------|------|
| qwen-plus | 普通任务（摘要、洞察、问题） | temperature: 0.7 |
| qwen-max | 复杂任务（知识关联） | temperature: 0.7 |
| qwen3-coder-flash | 代码相关任务 | temperature: 0.3 |

## 项目结构

```
backend/
├── src/
│   ├── ai/
│   │   ├── ai.service.ts       # AI 服务核心逻辑
│   │   ├── ai.controller.ts    # REST API 控制器
│   │   └── ai.module.ts        # AI 模块定义
│   ├── config/
│   │   └── dashscope.config.ts # DashScope 配置
│   ├── app.module.ts           # 应用根模块
│   └── main.ts                 # 应用入口
├── .env                        # 环境变量
├── package.json
├── tsconfig.json
└── README.md
```

## 错误处理

所有 API 端点都会在出错时返回适当的 HTTP 状态码：

- `200` - 请求成功
- `400` - 请求参数错误
- `500` - 服务器内部错误

错误响应格式：
```json
{
  "statusCode": 500,
  "message": "错误信息",
  "error": "Internal Server Error"
}
```

## 性能优化

- 使用并行请求处理多个 AI 任务
- 合理的超时设置
- 流式响应支持（未来）

## 安全性

- API Key 存储在后端，前端无法访问
- CORS 配置限制访问来源
- 环境变量管理敏感信息

## 开发

```bash
# 监听文件变化自动重启
npm run watch

# 类型检查
tsc --noEmit
```

## 部署

推荐使用以下平台部署：

- **Vercel** - 零配置部署
- **Railway** - 容器化部署
- **Heroku** - 传统 PaaS
- **自建服务器** - PM2 进程管理

环境变量配置：
- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`
- `PORT`
- `FRONTEND_URL`

## License

MIT

