# 🚀 快速启动指南

## 📋 启动步骤

### 第一步：打开两个终端窗口

你需要同时运行前端和后端服务。

---

### 🔴 终端窗口 1 - 后端服务

```bash
# 启动后端 API 服务
npm run backend
```

**预期输出：**
```
Backend server is running on http://localhost:3001
```

✅ 看到这个消息后，保持此终端运行，不要关闭！

---

### 🔵 终端窗口 2 - 前端服务

```bash
# 启动前端开发服务器
npm run dev
```

**预期输出：**
```
VITE v7.2.2  ready in 633 ms
➜  Local:   http://localhost:5173/
```

✅ 看到这个消息后，打开浏览器访问显示的地址（如 http://localhost:5173）

---

## 🧪 测试 AI 功能

### 方法 1：使用前端界面

1. **打开浏览器** → http://localhost:5173 (或 5174)
2. **导入 EPUB 文件** → 点击选择文件按钮
3. **阅读内容** → 查看章节内容
4. **点击"AI 分析"按钮** → 等待几秒钟
5. **查看结果**：
   - 📝 内容摘要
   - 💡 深度洞察
   - ❓ 启发式问题
   - 🔗 知识关联

### 方法 2：使用测试脚本

```bash
# 在新终端窗口运行
node test-backend.js
```

这将自动测试所有 API 端点。

---

## ⚠️ 常见问题

### ❌ 前端显示"AI 分析失败"

**原因：** 后端服务未启动

**解决：**
1. 检查终端窗口 1 是否显示 "Backend server is running"
2. 如果没有，运行 `npm run backend`

---

### ❌ 端口 3001 被占用

**解决方法 1 - 修改端口：**
```bash
# 编辑 backend/.env
PORT=3002  # 改成其他端口
```

然后同时修改前端配置（如果有 .env 文件）。

**解决方法 2 - 停止占用端口的进程：**
```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <进程ID> /F

# Mac/Linux
lsof -ti:3001 | xargs kill -9
```

---

### ❌ API Key 无效

**检查：**
1. 打开 `backend/.env`
2. 确认 `DASHSCOPE_API_KEY` 有值
3. 访问 https://dashscope.console.aliyun.com/ 验证 API Key

**当前配置的 API Key：**
```
sk-60af58b5c55947e38b08e2dc212bfb07
```

---

### ❌ CORS 错误

**检查 backend/src/main.ts：**
```typescript
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    credentials: true,
  })
);
```

如果前端运行在不同端口（如 5174），更新 FRONTEND_URL。

---

## 🔍 调试技巧

### 查看后端日志

后端终端会显示：
- ✅ 服务启动信息
- 📥 收到的请求
- ⚠️ 错误信息

### 查看前端日志

浏览器开发者工具（F12）：
1. **Console 标签** - 查看 JavaScript 错误
2. **Network 标签** - 查看 API 请求
   - 找到 `/api/ai/analyze` 请求
   - 查看 Request 和 Response

---

## 📝 完整的启动命令速查表

```bash
# 安装依赖（首次运行）
npm install
cd backend && npm install && cd ..

# 启动后端（终端 1）
npm run backend

# 启动前端（终端 2）
npm run dev

# 运行测试（终端 3）
node test-backend.js
```

---

## 🎯 下一步

启动成功后，你可以：

1. **📖 阅读 EPUB**
   - 支持本地文件
   - 支持远程 URL

2. **✏️ 创建划线**
   - 选中文本自动高亮
   - 自动保存到 IndexedDB

3. **🤖 AI 分析**
   - 内容摘要
   - 深度洞察
   - 启发式问题
   - 知识关联

4. **💾 导出笔记**
   - JSON 格式
   - Markdown 读书报告
   - 思维导图

---

## 📚 更多文档

- [README.md](README.md) - 项目概述
- [BACKEND_SETUP_GUIDE.md](BACKEND_SETUP_GUIDE.md) - 后端详细配置
- [DEPLOYMENT_COMPLETE.md](DEPLOYMENT_COMPLETE.md) - 部署完成报告
- [backend/README.md](backend/README.md) - 后端 API 文档

---

## 💬 获取帮助

遇到问题？检查：

1. ✅ 两个服务都在运行
2. ✅ 没有端口冲突
3. ✅ API Key 配置正确
4. ✅ 网络连接正常
5. ✅ 浏览器控制台没有错误

---

**祝你使用愉快！** 🎉

如果一切正常，你应该能看到：
- ✅ 后端：http://localhost:3001 运行中
- ✅ 前端：http://localhost:5173 运行中
- ✅ AI 分析功能正常工作

