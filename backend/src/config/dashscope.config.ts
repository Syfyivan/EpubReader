import * as dotenv from "dotenv";

dotenv.config();

export const DashScopeConfig = {
  apiKey: process.env.DASHSCOPE_API_KEY || "",
  baseURL:
    process.env.DASHSCOPE_BASE_URL ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  models: {
    SUMMARY: "qwen-plus",
    ANALYSIS: "qwen-max",
    CODER: "qwen3-coder-flash",
  },
  temperature: 0.7,
  maxTokens: 4000,
};
