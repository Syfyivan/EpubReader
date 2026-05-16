import { Injectable } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface MCPBookInfo {
  id: string;
  title: string;
  author: string;
  cover?: string;
  progress?: number;
  notesCount?: number;
}

export interface MCPBookNote {
  id: string;
  bookId: string;
  content: string;
  chapter?: string;
  page?: number;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
}

export interface MCPRequestOptions {
  serverPath?: string;
}

type ToolResult = { content?: unknown };

const firstString = (item: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
};

const firstNumber = (item: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
};

const normalizeTimestamp = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
};

@Injectable()
export class MCPService {
  private async withClient<T>(
    options: MCPRequestOptions | undefined,
    run: (client: Client) => Promise<T>
  ): Promise<T> {
    const transport = new StdioClientTransport({
      command: options?.serverPath?.trim() || process.env.MCP_SERVER_PATH || "mcp-server",
      args: [],
    });

    const client = new Client(
      { name: "epub-reader-backend", version: "1.0.0" },
      { capabilities: {} }
    );

    try {
      await client.connect(transport);
      return await run(client);
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }

  private parseToolPayload(result: unknown): unknown {
    const content = (result as ToolResult)?.content;
    if (!Array.isArray(content)) {
      return result;
    }

    const text = content
      .map((item) => (item as { text?: unknown })?.text)
      .filter((value): value is string => typeof value === "string")
      .join("\n")
      .trim();

    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return content;
  }

  private asRecords(payload: unknown, collectionKeys: string[] = []): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.filter(
        (item): item is Record<string, unknown> => !!item && typeof item === "object"
      );
    }

    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      for (const key of collectionKeys) {
        const value = record[key];
        if (Array.isArray(value)) {
          return value.filter(
            (item): item is Record<string, unknown> => !!item && typeof item === "object"
          );
        }
      }
    }

    return [];
  }

  private normalizeBook(item: Record<string, unknown>): MCPBookInfo {
    return {
      id: firstString(item, ["id", "bookId", "book_id", "wid"]),
      title: firstString(item, ["title", "name", "bookName"]),
      author: firstString(item, ["author", "writer"]),
      cover: firstString(item, ["cover", "coverUrl", "cover_url"]) || undefined,
      progress: firstNumber(item, ["progress", "readingProgress", "reading_progress"]),
      notesCount: firstNumber(item, ["notesCount", "noteCount", "notes_count"]),
    };
  }

  private normalizeNote(item: Record<string, unknown>, fallbackBookId: string): MCPBookNote {
    const id =
      firstString(item, ["id", "noteId", "note_id", "reviewId", "review_id"]) ||
      `mcp-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tags = item.tags;

    return {
      id,
      bookId: firstString(item, ["bookId", "book_id"]) || fallbackBookId,
      content: firstString(item, ["content", "text", "markText", "abstract", "note"]),
      chapter: firstString(item, ["chapter", "chapterName", "chapterTitle"]) || undefined,
      page: firstNumber(item, ["page", "pageNumber", "chapterUid"]),
      createdAt: normalizeTimestamp(item.createdAt ?? item.createTime ?? item.created_time),
      updatedAt: normalizeTimestamp(item.updatedAt ?? item.updateTime ?? item.updated_time),
      tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
    };
  }

  async getBookshelf(options?: MCPRequestOptions): Promise<MCPBookInfo[]> {
    return this.withClient(options, async (client) => {
      const result = await client.callTool({
        name: "get_bookshelf",
        arguments: {},
      });
      return this.asRecords(this.parseToolPayload(result), ["books", "items", "data"])
        .map((item) => this.normalizeBook(item))
        .filter((book) => book.id && book.title);
    });
  }

  async searchBooks(query: string, options?: MCPRequestOptions): Promise<MCPBookInfo[]> {
    return this.withClient(options, async (client) => {
      const result = await client.callTool({
        name: "search_books",
        arguments: { query },
      });
      return this.asRecords(this.parseToolPayload(result), ["books", "items", "data"])
        .map((item) => this.normalizeBook(item))
        .filter((book) => book.id && book.title);
    });
  }

  async getBookNotes(bookId: string, options?: MCPRequestOptions): Promise<MCPBookNote[]> {
    return this.withClient(options, async (client) => {
      const result = await client.callTool({
        name: "get_book_notes",
        arguments: { bookId },
      });
      return this.asRecords(this.parseToolPayload(result), ["notes", "items", "data", "highlights"])
        .map((item) => this.normalizeNote(item, bookId))
        .filter((note) => note.content);
    });
  }

  async syncNotes(notes: MCPBookNote[], options?: MCPRequestOptions) {
    return this.withClient(options, async (client) => {
      const result = await client.callTool({
        name: "sync_notes",
        arguments: { notes },
      });
      return this.parseToolPayload(result);
    });
  }

  async analyzeReading(notes: MCPBookNote[], options?: MCPRequestOptions) {
    return this.withClient(options, async (client) => {
      const result = await client.callTool({
        name: "analyze_reading",
        arguments: { notes },
      });
      return this.parseToolPayload(result);
    });
  }

  async classifyNotes(notes: MCPBookNote[], options?: MCPRequestOptions) {
    return this.withClient(options, async (client) => {
      const result = await client.callTool({
        name: "classify_notes",
        arguments: { notes },
      });
      return this.parseToolPayload(result);
    });
  }
}
