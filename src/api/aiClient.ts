/**
 * AI API 客户端
 * 用于调用后端 AI 服务
 */

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export interface AIAnalysis {
  summary: string;
  insights: string[];
  questions: string[];
  connections: string[];
}

export interface AnalyzeContentRequest {
  content: string;
}

export interface GenerateCodeRequest {
  description: string;
  language?: string;
}

export interface ExplainCodeRequest {
  code: string;
  language?: string;
}

export interface ReviewCodeRequest {
  code: string;
  language?: string;
}

class AIClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  /**
   * 分析内容
   */
  async analyzeContent(content: string): Promise<AIAnalysis> {
    const response = await fetch(`${this.baseURL}/api/ai/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      throw new Error(`AI analysis failed: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * 生成代码
   */
  async generateCode(
    description: string,
    language: string = "typescript"
  ): Promise<string> {
    const response = await fetch(`${this.baseURL}/api/ai/code/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description, language }),
    });

    if (!response.ok) {
      throw new Error(`Code generation failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.code;
  }

  /**
   * 解释代码
   */
  async explainCode(
    code: string,
    language: string = "typescript"
  ): Promise<string> {
    const response = await fetch(`${this.baseURL}/api/ai/code/explain`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, language }),
    });

    if (!response.ok) {
      throw new Error(`Code explanation failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.explanation;
  }

  /**
   * 代码审查
   */
  async reviewCode(
    code: string,
    language: string = "typescript"
  ): Promise<string> {
    const response = await fetch(`${this.baseURL}/api/ai/code/review`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, language }),
    });

    if (!response.ok) {
      throw new Error(`Code review failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.review;
  }
}

export const aiClient = new AIClient();
