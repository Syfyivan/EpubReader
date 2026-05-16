const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

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

class MCPApiClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  getBookshelf(options: MCPRequestOptions = {}) {
    return this.post<MCPBookInfo[]>("/api/mcp/bookshelf", options);
  }

  searchBooks(query: string, options: MCPRequestOptions = {}) {
    return this.post<MCPBookInfo[]>("/api/mcp/search", {
      ...options,
      query,
    });
  }

  getBookNotes(bookId: string, options: MCPRequestOptions = {}) {
    return this.post<MCPBookNote[]>("/api/mcp/book-notes", {
      ...options,
      bookId,
    });
  }

  syncNotes(notes: MCPBookNote[], options: MCPRequestOptions = {}) {
    return this.post<unknown>("/api/mcp/sync-notes", {
      ...options,
      notes,
    });
  }

  analyzeReading(notes: MCPBookNote[], options: MCPRequestOptions = {}) {
    return this.post<unknown>("/api/mcp/analyze", {
      ...options,
      notes,
    });
  }

  classifyNotes(notes: MCPBookNote[], options: MCPRequestOptions = {}) {
    return this.post<unknown>("/api/mcp/classify", {
      ...options,
      notes,
    });
  }
}

export const mcpApiClient = new MCPApiClient();
