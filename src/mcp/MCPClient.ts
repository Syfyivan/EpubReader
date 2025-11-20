import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * MCP 驱动的笔记分析引擎
 * 集成微信读书 OpenAPI 与本地笔记数据
 */

export interface BookInfo {
  id: string;
  title: string;
  author: string;
  cover?: string;
  progress?: number;
  notesCount?: number;
}

export interface BookNote {
  id: string;
  bookId: string;
  content: string;
  chapter?: string;
  page?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReadingAnalysis {
  totalBooks: number;
  totalNotes: number;
  readingProgress: number;
  favoriteCategories: string[];
  readingTrends: Array<{ date: string; count: number }>;
  knowledgeGraph: Array<{ source: string; target: string; weight: number }>;
}

const getFirstContentText = (result: unknown): string | undefined => {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) {
    return undefined;
  }
  const first = content[0] as { text?: string };
  return typeof first?.text === "string" ? first.text : undefined;
};

export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private isConnected: boolean = false;

  /**
   * 连接到 MCP 服务器
   */
  async connect(serverPath?: string): Promise<void> {
    try {
      // 初始化 MCP 客户端
      this.transport = new StdioClientTransport({
        command: serverPath || "mcp-server",
        args: [],
      });

      this.client = new Client(
        {
          name: "epub-reader",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);
      this.isConnected = true;

      console.log("MCP client connected");
    } catch (error) {
      console.error("Failed to connect MCP server:", error);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.isConnected = false;
  }

  /**
   * 获取书架列表（微信读书 OpenAPI）
   */
  async getBookshelf(): Promise<BookInfo[]> {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.callTool({
        name: "get_bookshelf",
        arguments: {},
      });

      const content = (result as { content?: unknown }).content;
      if (Array.isArray(content)) {
        return (content as Array<Record<string, unknown>>).map((item) => ({
          id: (item.id || item.bookId) as string,
          title: (item.title || item.name) as string,
          author: (item.author || "") as string,
          cover: (item.cover || item.coverUrl) as string | undefined,
          progress: (item.progress || item.readingProgress) as
            | number
            | undefined,
          notesCount: (item.notesCount || item.noteCount) as number | undefined,
        }));
      }

      return [];
    } catch (error) {
      console.error("Failed to get bookshelf:", error);
      return [];
    }
  }

  /**
   * 搜索书籍
   */
  async searchBooks(query: string): Promise<BookInfo[]> {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.callTool({
        name: "search_books",
        arguments: {
          query,
        },
      });

      const content = (result as { content?: unknown }).content;
      if (Array.isArray(content)) {
        return (content as Array<Record<string, unknown>>).map((item) => ({
          id: (item.id || item.bookId) as string,
          title: (item.title || item.name) as string,
          author: (item.author || "") as string,
          cover: (item.cover || item.coverUrl) as string | undefined,
        }));
      }

      return [];
    } catch (error) {
      console.error("Failed to search books:", error);
      return [];
    }
  }

  /**
   * 获取书籍笔记
   */
  async getBookNotes(bookId: string): Promise<BookNote[]> {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.callTool({
        name: "get_book_notes",
        arguments: {
          bookId,
        },
      });

      const content = (result as { content?: unknown }).content;
      if (Array.isArray(content)) {
        return (content as Array<Record<string, unknown>>).map((item) => ({
          id: (item.id || item.noteId) as string,
          bookId,
          content: (item.content || item.text) as string,
          chapter: (item.chapter || item.chapterName) as string | undefined,
          page: (item.page || item.pageNumber) as number | undefined,
          createdAt: (item.createdAt ||
            item.createTime ||
            Date.now()) as number,
          updatedAt: (item.updatedAt ||
            item.updateTime ||
            Date.now()) as number,
        }));
      }

      return [];
    } catch (error) {
      console.error("Failed to get book notes:", error);
      return [];
    }
  }

  /**
   * 同步本地笔记到 MCP 服务器
   */
  async syncNotes(notes: BookNote[]): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.callTool({
        name: "sync_notes",
        arguments: {
          notes,
        },
      });

      const text = getFirstContentText(result);
      return text === "success";
    } catch (error) {
      console.error("Failed to sync notes:", error);
      return false;
    }
  }

  /**
   * 生成个性化阅读分析
   */
  async generateReadingAnalysis(notes: BookNote[]): Promise<ReadingAnalysis> {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.callTool({
        name: "analyze_reading",
        arguments: {
          notes,
        },
      });

      const text = getFirstContentText(result);
      if (text) {
        const data = JSON.parse(text || "{}");
        return {
          totalBooks: data.totalBooks || 0,
          totalNotes: data.totalNotes || notes.length,
          readingProgress: data.readingProgress || 0,
          favoriteCategories: data.favoriteCategories || [],
          readingTrends: data.readingTrends || [],
          knowledgeGraph: data.knowledgeGraph || [],
        };
      }

      return this.generateDefaultAnalysis(notes);
    } catch (error) {
      console.error("Failed to generate reading analysis:", error);
      return this.generateDefaultAnalysis(notes);
    }
  }

  /**
   * 生成默认分析（当 MCP 服务不可用时）
   */
  private generateDefaultAnalysis(notes: BookNote[]): ReadingAnalysis {
    const bookIds = new Set(notes.map((n) => n.bookId));
    const dates = notes.map((n) => {
      const date = new Date(n.createdAt);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(date.getDate()).padStart(2, "0")}`;
    });

    const trendMap = new Map<string, number>();
    dates.forEach((date) => {
      trendMap.set(date, (trendMap.get(date) || 0) + 1);
    });

    return {
      totalBooks: bookIds.size,
      totalNotes: notes.length,
      readingProgress: 0,
      favoriteCategories: [],
      readingTrends: Array.from(trendMap.entries()).map(([date, count]) => ({
        date,
        count,
      })),
      knowledgeGraph: [],
    };
  }

  /**
   * 智能分类笔记
   */
  async classifyNotes(notes: BookNote[]): Promise<Map<string, BookNote[]>> {
    if (!this.isConnected || !this.client) {
      // 使用简单的关键词分类
      return this.simpleClassify(notes);
    }

    try {
      const result = await this.client.callTool({
        name: "classify_notes",
        arguments: {
          notes,
        },
      });

      const text = getFirstContentText(result);
      if (text) {
        const classification = JSON.parse(text || "{}");
        const classified = new Map<string, BookNote[]>();

        Object.entries(classification).forEach(
          ([category, noteIds]: [string, unknown]) => {
            const ids = noteIds as string[];
            const categoryNotes = notes.filter((n) => ids.includes(n.id));
            if (categoryNotes.length > 0) {
              classified.set(category, categoryNotes);
            }
          }
        );

        return classified;
      }

      return this.simpleClassify(notes);
    } catch (error) {
      console.error("Failed to classify notes:", error);
      return this.simpleClassify(notes);
    }
  }

  /**
   * 简单分类（基于关键词）
   */
  private simpleClassify(notes: BookNote[]): Map<string, BookNote[]> {
    const categories = new Map<string, BookNote[]>();
    const keywords: Record<string, string[]> = {
      哲学: ["哲学", "思考", "存在", "意义", "真理"],
      科学: ["科学", "实验", "研究", "理论", "发现"],
      文学: ["文学", "小说", "诗歌", "故事", "人物"],
      历史: ["历史", "过去", "事件", "时代", "文明"],
      心理学: ["心理", "情绪", "认知", "行为", "意识"],
    };

    notes.forEach((note) => {
      let classified = false;
      for (const [category, words] of Object.entries(keywords)) {
        if (words.some((word) => note.content.includes(word))) {
          if (!categories.has(category)) {
            categories.set(category, []);
          }
          categories.get(category)!.push(note);
          classified = true;
          break;
        }
      }

      if (!classified) {
        if (!categories.has("其他")) {
          categories.set("其他", []);
        }
        categories.get("其他")!.push(note);
      }
    });

    return categories;
  }

  /**
   * 构建知识关联
   */
  async buildKnowledgeConnections(
    notes: BookNote[]
  ): Promise<Array<{ source: string; target: string; weight: number }>> {
    // 基于笔记内容的相似度构建关联
    const connections: Array<{
      source: string;
      target: string;
      weight: number;
    }> = [];

    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length; j++) {
        const similarity = this.calculateSimilarity(
          notes[i].content,
          notes[j].content
        );
        if (similarity > 0.3) {
          connections.push({
            source: notes[i].id,
            target: notes[j].id,
            weight: similarity,
          });
        }
      }
    }

    return connections;
  }

  /**
   * 计算文本相似度（简化版）
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\s+/));
    const words2 = new Set(text2.split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }
}
