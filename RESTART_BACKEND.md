# 🔄 重启后端服务

## 问题
CORS 错误：前端运行在 `http://localhost:5175`，但后端配置的是 `http://localhost:5173`

## ✅ 已修复
已更新 `backend/.env` 文件：
```env
FRONTEND_URL=http://localhost:5175
```

---

## 🔴 重要：需要重启后端

### 第 1 步：停止当前后端进程

在运行后端的终端窗口按 `Ctrl + C` 停止服务

### 第 2 步：重新启动后端

```bash
npm run backend
```

### 第 3 步：验证启动成功

应该看到：
```
Backend server is running on http://localhost:3001
```

---

## 🧪 测试

1. **打开浏览器** → http://localhost:5175
2. **导入 EPUB 文件**
3. **点击"AI 分析"按钮**
4. **应该能正常工作了！** ✅

---

## 📝 完整的启动命令

**如果你需要完全重新启动：**

```bash
# 终端 1 - 后端
cd backend
npm run dev

# 或从根目录
npm run backend
```

**前端已在运行：**
- 地址：http://localhost:5175
- 无需重启

---

## 🔍 验证 CORS 配置

后端启动后，检查配置是否正确：

1. 打开浏览器开发者工具 (F12)
2. 点击 Network 标签
3. 点击"AI 分析"
4. 查看请求头：
   - 应该看到 `Access-Control-Allow-Origin: http://localhost:5175`

---

## 💡 提示

如果以后前端端口改变（例如 5176），需要：
1. 修改 `backend/.env` 中的 `FRONTEND_URL`
2. 重启后端服务

---

**立即操作：**
1. 停止后端（Ctrl + C）
2. 运行 `npm run backend`
3. 测试 AI 功能！

🎉

