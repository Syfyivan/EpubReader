# 🤖 AI 分析功能故障排查指南

## ❓ 常见问题

### Q: 这个项目需要后端吗？
**A: 不需要！** 

这是一个**纯前端项目**，AI 功能直接调用阿里云 DashScope API（通义千问）。

## 🔍 AI 功能如何工作

```
浏览器（前端）
    ↓
    直接 HTTPS 请求
    ↓
阿里云 DashScope API
    ↓
    返回 AI 分析结果
    ↓
浏览器显示结果
```

**不经过任何后端服务器！**

## 🔑 当前配置

### API Key
```typescript
API_KEY: "sk-60af58b5c55947e38b08e2dc212bfb07"
BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
```

### 使用的模型
- `qwen-plus` - 普通任务（摘要、洞察、问题）
- `qwen-max` - 复杂任务（知识关联）
- `qwen3-coder-flash` - 代码任务

## 🐛 可能的错误原因

### 1. API Key 无效或过期

**症状**: 
- 控制台显示 `401 Unauthorized`
- 错误信息：`Invalid API Key`

**解决方法**:
```bash
# 检查 API Key 是否有效
# 访问：https://dashscope.console.aliyun.com/

# 更新 .env 文件
VITE_DASHSCOPE_API_KEY=你的新API密钥
```

### 2. 网络连接问题

**症状**:
- 控制台显示 `Network Error`
- 错误信息：`Failed to fetch`

**检查方法**:
```javascript
// 在浏览器控制台测试连接
fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
  headers: {
    'Authorization': 'Bearer sk-60af58b5c55947e38b08e2dc212bfb07'
  }
})
.then(r => r.json())
.then(d => console.log('API 连接正常:', d))
.catch(e => console.error('API 连接失败:', e));
```

### 3. CORS 跨域问题

**症状**:
- 控制台显示 `CORS policy` 错误

**原因**: 
阿里云 DashScope 的 compatible-mode API 应该支持浏览器直接调用，但某些情况下可能有限制。

**解决方法**:
如果遇到 CORS 问题，需要通过代理：

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api/dashscope': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/dashscope/, '')
      }
    }
  }
});
```

### 4. LangChain.js 配置问题

**症状**:
- 控制台显示 `Cannot find module` 或类似错误

**解决方法**:
```bash
# 重新安装依赖
npm install
```

## 🔧 故障排查步骤

### 步骤 1: 查看浏览器控制台

按 `F12` 打开开发者工具，查看 Console 标签：

**常见错误类型**:

1. **401 错误**
   ```
   Error: Request failed with status code 401
   ```
   → API Key 无效，需要更新

2. **Network Error**
   ```
   Error: Network Error
   ```
   → 网络连接问题，检查网络

3. **CORS Error**
   ```
   Access to fetch blocked by CORS policy
   ```
   → 跨域问题，需要配置代理

4. **429 错误**
   ```
   Error: Request failed with status code 429
   ```
   → API 调用频率限制，稍后重试

### 步骤 2: 检查 Network 标签

1. 打开 `Network` 标签
2. 点击 "AI 分析" 按钮
3. 查看请求：
   - 请求 URL 是否正确
   - 状态码是多少
   - Response 内容是什么

### 步骤 3: 测试 API 连接

在浏览器控制台运行：

```javascript
// 测试 API 连接
const testAPI = async () => {
  try {
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-60af58b5c55947e38b08e2dc212bfb07'
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{
          role: 'user',
          content: '你好'
        }]
      })
    });
    
    const data = await response.json();
    console.log('✅ API 工作正常:', data);
  } catch (error) {
    console.error('❌ API 调用失败:', error);
  }
};

testAPI();
```

## 🔑 更新 API Key

### 方法 1: 修改 .env 文件

```bash
# .env
VITE_DASHSCOPE_API_KEY=你的新API密钥
```

然后重启开发服务器：
```bash
npm run dev
```

### 方法 2: 直接修改配置文件

编辑 `src/config/dashscope.ts`:

```typescript
export const DASHSCOPE_CONFIG = {
  API_KEY: "你的新API密钥",
  BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  // ...
};
```

### 方法 3: 运行时设置（浏览器控制台）

```javascript
// 临时设置 API Key
localStorage.setItem('dashscope_api_key', '你的新API密钥');
// 刷新页面
location.reload();
```

## 📝 获取新的 API Key

1. 访问阿里云 DashScope 控制台
   ```
   https://dashscope.console.aliyun.com/
   ```

2. 登录阿里云账号

3. 进入 "API-KEY管理"

4. 创建新的 API Key

5. 复制 API Key（格式：`sk-xxxxx...`）

6. 更新到项目中

## ✅ 验证 AI 功能

### 测试步骤

1. **加载 EPUB 文件**
   - 选择任意 EPUB 文件
   - 等待加载完成

2. **点击 "AI 分析" 按钮**
   - 应该显示加载状态
   - 等待 5-10 秒

3. **查看分析结果**
   - 摘要
   - 深度洞察
   - 启发式问题
   - 知识关联

4. **如果成功**
   - ✅ 弹出 AI 分析窗口
   - ✅ 显示完整的分析内容

5. **如果失败**
   - 查看控制台错误信息
   - 按照上述步骤排查

## 🔍 调试模式

在 `src/ai/AIAssistant.ts` 中添加调试日志：

```typescript
async analyzeContent(content: string): Promise<AIAnalysis> {
  console.log('🤖 开始 AI 分析...');
  console.log('📝 内容长度:', content.length);
  
  try {
    const [summary, insights, questions] = await Promise.all([
      this.generateSummary(content),
      this.generateInsights(content),
      this.generateQuestions(content),
    ]);
    
    console.log('✅ 基础分析完成');
    console.log('📊 摘要:', summary.substring(0, 50) + '...');
    
    const connections = await this.generateConnections(content, insights);
    
    console.log('✅ AI 分析完成');
    
    return {
      summary,
      insights: this.parseList(insights),
      questions: this.parseList(questions),
      connections,
    };
  } catch (error) {
    console.error('❌ AI 分析失败:', error);
    throw error;
  }
}
```

## 📊 常见错误码

| 错误码 | 含义 | 解决方法 |
|--------|------|---------|
| 400 | 请求参数错误 | 检查请求格式 |
| 401 | API Key 无效 | 更新 API Key |
| 403 | 权限不足 | 检查账号权限 |
| 429 | 请求过于频繁 | 稍后重试 |
| 500 | 服务器错误 | 联系阿里云支持 |
| 503 | 服务暂时不可用 | 稍后重试 |

## 🎯 快速诊断

在浏览器控制台粘贴以下代码，快速诊断问题：

```javascript
// 🔍 AI 功能诊断工具
(async function diagnose() {
  console.log('='.repeat(50));
  console.log('🔍 开始诊断 AI 功能...');
  console.log('='.repeat(50));
  
  // 1. 检查 API Key
  console.log('\n1️⃣ 检查 API Key...');
  const apiKey = localStorage.getItem('dashscope_api_key') || 'sk-60af58b5c55947e38b08e2dc212bfb07';
  console.log('API Key:', apiKey ? '✅ 已配置' : '❌ 未配置');
  console.log('Key 格式:', apiKey.startsWith('sk-') ? '✅ 正确' : '❌ 错误');
  
  // 2. 测试网络连接
  console.log('\n2️⃣ 测试 API 连接...');
  try {
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content: '测试' }]
      })
    });
    
    console.log('响应状态:', response.status);
    
    if (response.ok) {
      console.log('✅ API 连接正常');
      const data = await response.json();
      console.log('响应数据:', data);
    } else {
      console.log('❌ API 调用失败');
      const error = await response.text();
      console.log('错误详情:', error);
    }
  } catch (error) {
    console.log('❌ 网络错误:', error);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ 诊断完成');
  console.log('='.repeat(50));
})();
```

## 💡 温馨提示

1. **API Key 是敏感信息**
   - 不要分享给他人
   - 不要提交到 Git

2. **API 有使用限制**
   - 免费额度有限
   - 注意调用频率

3. **内容长度限制**
   - 单次分析不要超过 4000 token
   - 长文本会自动截断

## 📞 还有问题？

如果按照上述步骤仍无法解决，请提供：
1. 浏览器控制台的完整错误信息
2. Network 标签中的请求详情
3. API Key 是否能在阿里云控制台正常使用

---

**现在请告诉我具体的错误信息，我会帮你诊断！** 🔍

