# EPUB Reader Go Backend

这是 EPUB Reader 的 Go 后端，保留原有前端依赖的 REST API 路由：

- `POST /api/ai/analyze`
- `POST /api/ai/code/generate`
- `POST /api/ai/code/explain`
- `POST /api/ai/code/review`
- `GET /api/ai/status`
- `POST /api/mcp/bookshelf`
- `POST /api/mcp/search`
- `POST /api/mcp/book-notes`
- `POST /api/mcp/sync-notes`
- `POST /api/mcp/analyze`
- `POST /api/mcp/classify`

## 技术栈

- Go 1.22
- 标准库 `net/http`
- 标准库实现的 MCP stdio JSON-RPC 客户端
- DashScope OpenAI-compatible Chat Completions API

## 配置

后端启动时会读取 `backend/.env`，也会尝试读取项目根目录 `.env`。已有环境变量优先级更高。

```env
DASHSCOPE_API_KEY=your_api_key_here
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_SUMMARY_MODEL=qwen-plus
DASHSCOPE_ANALYSIS_MODEL=qwen-max
DASHSCOPE_CODER_MODEL=qwen3-coder-flash
DASHSCOPE_TEMPERATURE=0.7
DASHSCOPE_MAX_TOKENS=4000
PORT=3001
FRONTEND_URL=http://localhost:5173,http://127.0.0.1:5173
MCP_SERVER_PATH=mcp-server
MCP_TIMEOUT_SECONDS=30
```

## 运行

```bash
go run .
```

或从项目根目录运行：

```bash
npm run backend
```

服务默认监听 `http://localhost:3001`。

## 构建

```bash
rm -rf dist
mkdir -p dist
go build -o dist/epub-reader-backend .
```

或从项目根目录运行：

```bash
npm run build:backend
```

## 测试

```bash
go test ./...
```

## 说明

AI 接口在未配置 `DASHSCOPE_API_KEY` 时仍允许服务启动，但调用 AI 路由会返回配置错误。MCP 接口会按请求中的 `serverPath` 或环境变量 `MCP_SERVER_PATH` 启动 stdio MCP 服务，并通过 `tools/call` 调用对应工具。
