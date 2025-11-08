// LangChain.js 导入
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { DASHSCOPE_CONFIG } from "../config/dashscope";

/**
 * AI 思考辅助管道
 * 基于 LangChain.js 构建提示词工程与处理链
 */

export interface AIAnalysis {
  summary: string;
  insights: string[];
  questions: string[];
  connections: string[];
}

export class AIAssistant {
  private llm: ChatOpenAI; // 普通任务使用 qwen-plus
  private llmComplex: ChatOpenAI; // 复杂任务使用 qwen-max
  private llmCoder: ChatOpenAI; // 代码任务使用 qwen3-coder-flash
  private summaryChain: RunnableSequence;
  private insightChain: RunnableSequence;
  private questionChain: RunnableSequence;

  constructor(apiKey?: string, baseURL?: string) {
    // DashScope API 配置
    const dashScopeApiKey = apiKey || DASHSCOPE_CONFIG.API_KEY;
    const dashScopeBaseURL = baseURL || DASHSCOPE_CONFIG.BASE_URL;

    // 初始化普通任务 LLM（使用 qwen-plus）
    // 注意：LangChain.js 的 ChatOpenAI 支持通过 configuration.baseURL 设置自定义端点
    this.llm = new ChatOpenAI({
      openAIApiKey: dashScopeApiKey,
      modelName: DASHSCOPE_CONFIG.MODELS.NORMAL,
      temperature: 0.7,
      configuration: {
        baseURL: dashScopeBaseURL,
      },
    });

    // 初始化复杂任务 LLM（使用 qwen-max）
    this.llmComplex = new ChatOpenAI({
      openAIApiKey: dashScopeApiKey,
      modelName: DASHSCOPE_CONFIG.MODELS.COMPLEX,
      temperature: 0.7,
      configuration: {
        baseURL: dashScopeBaseURL,
      },
    });

    // 初始化代码任务 LLM（使用 qwen3-coder-flash）
    this.llmCoder = new ChatOpenAI({
      openAIApiKey: dashScopeApiKey,
      modelName: DASHSCOPE_CONFIG.MODELS.CODER,
      temperature: 0.3,
      configuration: {
        baseURL: dashScopeBaseURL,
      },
    });

    // 构建摘要生成链
    this.summaryChain = this.buildSummaryChain();

    // 构建洞察生成链
    this.insightChain = this.buildInsightChain();

    // 构建问题生成链
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
  async analyzeContent(content: string): Promise<AIAnalysis> {
    try {
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
  async generateSummary(content: string): Promise<string> {
    return await this.summaryChain.invoke({ content });
  }

  /**
   * 生成洞察
   */
  async generateInsights(content: string): Promise<string> {
    return await this.insightChain.invoke({ content });
  }

  /**
   * 生成问题
   */
  async generateQuestions(content: string): Promise<string> {
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
      this.llmComplex, // 使用复杂任务模型
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
   * 基于上下文生成思考角度（使用复杂任务模型）
   */
  async generateThinkingAngles(
    content: string,
    context?: string[]
  ): Promise<string[]> {
    const angleTemplate = PromptTemplate.fromTemplate(`
基于以下文本内容{context}，生成多个思考角度：

文本内容：
{content}

{contextText}

请从不同维度（如：哲学、科学、艺术、历史、心理学等）提供思考角度。
    `);

    const contextText = context ? `\n相关上下文：\n${context.join("\n")}` : "";

    const chain = RunnableSequence.from([
      angleTemplate,
      this.llmComplex, // 使用复杂任务模型
      new StringOutputParser(),
    ]);

    const result = await chain.invoke({
      content,
      context: context ? "（包含相关上下文）" : "",
      contextText,
    });

    return this.parseList(result);
  }

  /**
   * 优化提示词（用于链式生成，使用复杂任务模型）
   */
  async optimizePrompt(
    basePrompt: string,
    examples?: string[]
  ): Promise<string> {
    const optimizationTemplate = PromptTemplate.fromTemplate(`
请优化以下提示词，使其更加清晰、具体和有效：

原始提示词：
{prompt}

{examplesText}

优化要求：
1. 明确任务目标
2. 提供清晰的输出格式要求
3. 包含必要的上下文信息
4. 使用更精确的语言
    `);

    const examplesText = examples ? `\n示例：\n${examples.join("\n")}` : "";

    const chain = RunnableSequence.from([
      optimizationTemplate,
      this.llmComplex, // 使用复杂任务模型
      new StringOutputParser(),
    ]);

    return await chain.invoke({
      prompt: basePrompt,
      examplesText,
    });
  }

  /**
   * 生成代码片段（使用代码专用模型）
   */
  async generateCode(
    description: string,
    language: string = "typescript"
  ): Promise<string> {
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
      this.llmCoder, // 使用代码专用模型
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
  async explainCode(
    code: string,
    language: string = "typescript"
  ): Promise<string> {
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
      this.llmCoder, // 使用代码专用模型
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
  async reviewCode(
    code: string,
    language: string = "typescript"
  ): Promise<string> {
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
      this.llmCoder, // 使用代码专用模型
      new StringOutputParser(),
    ]);

    return await chain.invoke({
      code,
      language,
    });
  }
}
