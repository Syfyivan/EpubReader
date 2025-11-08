import { Injectable } from "@nestjs/common";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { DashScopeConfig } from "../config/dashscope.config";

export interface AIAnalysis {
  summary: string;
  insights: string[];
  questions: string[];
  connections: string[];
}

export interface AnalyzeContentDto {
  content: string;
}

export interface GenerateCodeDto {
  description: string;
  language?: string;
}

export interface ExplainCodeDto {
  code: string;
  language?: string;
}

export interface ReviewCodeDto {
  code: string;
  language?: string;
}

@Injectable()
export class AIService {
  private llm: ChatOpenAI;
  private llmComplex: ChatOpenAI;
  private llmCoder: ChatOpenAI;
  private summaryChain: RunnableSequence;
  private insightChain: RunnableSequence;
  private questionChain: RunnableSequence;

  constructor() {
    const apiKey = DashScopeConfig.apiKey;
    const baseURL = DashScopeConfig.baseURL;

    // 初始化普通任务 LLM（使用 qwen-plus）
    this.llm = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: DashScopeConfig.models.SUMMARY,
      temperature: DashScopeConfig.temperature,
      maxTokens: DashScopeConfig.maxTokens,
      configuration: {
        baseURL: baseURL,
      },
    });

    // 初始化复杂任务 LLM（使用 qwen-max）
    this.llmComplex = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: DashScopeConfig.models.ANALYSIS,
      temperature: DashScopeConfig.temperature,
      maxTokens: DashScopeConfig.maxTokens,
      configuration: {
        baseURL: baseURL,
      },
    });

    // 初始化代码任务 LLM（使用 qwen3-coder-flash）
    this.llmCoder = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: DashScopeConfig.models.CODER,
      temperature: 0.3,
      maxTokens: DashScopeConfig.maxTokens,
      configuration: {
        baseURL: baseURL,
      },
    });

    // 构建处理链
    this.summaryChain = this.buildSummaryChain();
    this.insightChain = this.buildInsightChain();
    this.questionChain = this.buildQuestionChain();
  }

  /**
   * 构建摘要生成链
   */
  private buildSummaryChain(): RunnableSequence {
    const summaryTemplate = PromptTemplate.fromTemplate(`
请为以下文本内容生成一个简洁的摘要（100-200字）：

{content}

摘要要求：
1. 提取核心观点和关键信息
2. 保持逻辑清晰
3. 使用简洁明了的语言
    `);

    return RunnableSequence.from([
      summaryTemplate,
      this.llm,
      new StringOutputParser(),
    ]);
  }

  /**
   * 构建洞察生成链
   */
  private buildInsightChain(): RunnableSequence {
    const insightTemplate = PromptTemplate.fromTemplate(`
请从以下角度分析以下文本内容，生成3-5个深度洞察：

文本内容：
{content}

分析角度：
1. 核心观点和论证逻辑
2. 与现实生活的联系
3. 可能的批判性思考
4. 跨领域的知识关联
5. 个人成长和启发

请为每个洞察提供简洁的说明（50-100字）。
    `);

    return RunnableSequence.from([
      insightTemplate,
      this.llm,
      new StringOutputParser(),
    ]);
  }

  /**
   * 构建问题生成链
   */
  private buildQuestionChain(): RunnableSequence {
    const questionTemplate = PromptTemplate.fromTemplate(`
基于以下文本内容，生成5-7个启发式问题，这些问题应该：
1. 促进深度思考
2. 连接已有知识
3. 激发新的想法
4. 挑战既有观点

文本内容：
{content}

请以列表形式输出问题，每个问题一行。
    `);

    return RunnableSequence.from([
      questionTemplate,
      this.llm,
      new StringOutputParser(),
    ]);
  }

  /**
   * 生成完整分析
   */
  async analyzeContent(dto: AnalyzeContentDto): Promise<AIAnalysis> {
    try {
      const { content } = dto;

      // 并行执行多个分析任务
      const [summary, insights, questions] = await Promise.all([
        this.generateSummary(content),
        this.generateInsights(content),
        this.generateQuestions(content),
      ]);

      // 生成知识关联
      const connections = await this.generateConnections(content, insights);

      return {
        summary,
        insights: this.parseList(insights),
        questions: this.parseList(questions),
        connections,
      };
    } catch (error) {
      console.error("AI analysis failed:", error);
      throw error;
    }
  }

  /**
   * 生成摘要
   */
  private async generateSummary(content: string): Promise<string> {
    return await this.summaryChain.invoke({ content });
  }

  /**
   * 生成洞察
   */
  private async generateInsights(content: string): Promise<string> {
    return await this.insightChain.invoke({ content });
  }

  /**
   * 生成问题
   */
  private async generateQuestions(content: string): Promise<string> {
    return await this.questionChain.invoke({ content });
  }

  /**
   * 生成知识关联（使用复杂任务模型）
   */
  private async generateConnections(
    content: string,
    insights: string
  ): Promise<string[]> {
    const connectionTemplate = PromptTemplate.fromTemplate(`
基于以下文本内容和洞察，生成3-5个跨领域的知识关联：

文本内容：
{content}

已有洞察：
{insights}

请说明这些内容如何与其他领域的知识、概念或经验相关联。
    `);

    const chain = RunnableSequence.from([
      connectionTemplate,
      this.llmComplex,
      new StringOutputParser(),
    ]);

    const result = await chain.invoke({ content, insights });
    return this.parseList(result);
  }

  /**
   * 解析列表格式的文本
   */
  private parseList(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && /^[\d\-*•]/.test(line))
      .map((line) => line.replace(/^[\d\-*•]\s*/, ""))
      .filter((line) => line.length > 0);
  }

  /**
   * 生成代码片段（使用代码专用模型）
   */
  async generateCode(dto: GenerateCodeDto): Promise<string> {
    const { description, language = "typescript" } = dto;

    const codeTemplate = PromptTemplate.fromTemplate(`
请根据以下描述生成 {language} 代码：

描述：
{description}

要求：
1. 代码简洁高效
2. 包含必要的注释
3. 遵循最佳实践
4. 可以直接运行

请只输出代码，不要有其他解释。
    `);

    const chain = RunnableSequence.from([
      codeTemplate,
      this.llmCoder,
      new StringOutputParser(),
    ]);

    return await chain.invoke({
      description,
      language,
    });
  }

  /**
   * 解释代码（使用代码专用模型）
   */
  async explainCode(dto: ExplainCodeDto): Promise<string> {
    const { code, language = "typescript" } = dto;

    const explainTemplate = PromptTemplate.fromTemplate(`
请解释以下 {language} 代码的功能：

\`\`\`{language}
{code}
\`\`\`

请从以下角度解释：
1. 代码的主要功能
2. 关键逻辑和算法
3. 可能的优化点
4. 潜在的问题或改进建议
    `);

    const chain = RunnableSequence.from([
      explainTemplate,
      this.llmCoder,
      new StringOutputParser(),
    ]);

    return await chain.invoke({
      code,
      language,
    });
  }

  /**
   * 代码审查（使用代码专用模型）
   */
  async reviewCode(dto: ReviewCodeDto): Promise<string> {
    const { code, language = "typescript" } = dto;

    const reviewTemplate = PromptTemplate.fromTemplate(`
请审查以下 {language} 代码并提供改进建议：

\`\`\`{language}
{code}
\`\`\`

请从以下方面审查：
1. 代码质量（可读性、可维护性）
2. 性能优化
3. 安全性问题
4. 最佳实践
5. 潜在的 bug

请给出具体的改进建议。
    `);

    const chain = RunnableSequence.from([
      reviewTemplate,
      this.llmCoder,
      new StringOutputParser(),
    ]);

    return await chain.invoke({
      code,
      language,
    });
  }
}
