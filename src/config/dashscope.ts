/**
 * DashScope API 配置
 * 阿里云通义千问大模型配置
 */

export const DASHSCOPE_CONFIG = {
  // API 密钥（需要在阿里云控制台获取）
  API_KEY:
    import.meta.env.VITE_DASHSCOPE_API_KEY ||
    "sk-60af58b5c55947e38b08e2dc212bfb07",

  // API 基础 URL（DashScope 兼容 OpenAI API）
  BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",

  // 模型配置
  MODELS: {
    // 普通任务使用 qwen-plus（性价比高，响应快）
    NORMAL: "qwen-plus",

    // 复杂任务使用 qwen-max（能力最强，适合复杂推理）
    COMPLEX: "qwen-max",

    // 代码任务使用 qwen3-coder-flash（专门针对代码优化）
    CODER: "qwen3-coder-flash",

    // 快速任务使用 qwen-turbo（最快最便宜）
    TURBO: "qwen-turbo",
  },

  // 温度参数（控制输出的随机性）
  TEMPERATURE: {
    CREATIVE: 0.9, // 创造性任务
    BALANCED: 0.7, // 平衡模式
    PRECISE: 0.3, // 精确模式
  },

  // 最大 token 数
  MAX_TOKENS: {
    SHORT: 1000, // 短文本
    MEDIUM: 2000, // 中等长度
    LONG: 4000, // 长文本
  },
};

/**
 * 获取 API Key
 * 优先从环境变量读取，其次使用本地存储
 */
export function getApiKey(): string {
  // 1. 尝试从环境变量获取
  const envKey = import.meta.env.VITE_DASHSCOPE_API_KEY;
  if (envKey && envKey !== "your-dashscope-api-key-here") {
    return envKey;
  }

  // 2. 尝试从本地存储获取
  const storedKey = localStorage.getItem("dashscope_api_key");
  if (storedKey) {
    return storedKey;
  }

  // 3. 返回默认值
  return DASHSCOPE_CONFIG.API_KEY;
}

/**
 * 保存 API Key 到本地存储
 */
export function saveApiKey(apiKey: string): void {
  localStorage.setItem("dashscope_api_key", apiKey);
}

/**
 * 清除保存的 API Key
 */
export function clearApiKey(): void {
  localStorage.removeItem("dashscope_api_key");
}

/**
 * 验证 API Key 格式
 */
export function validateApiKey(apiKey: string): boolean {
  // DashScope API Key 通常以 sk- 开头
  return apiKey.startsWith("sk-") && apiKey.length > 20;
}
