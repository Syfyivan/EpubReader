import { Body, Controller, Post } from "@nestjs/common";
import { MCPBookNote, MCPRequestOptions, MCPService } from "./mcp.service";

interface SearchBooksDto extends MCPRequestOptions {
  query: string;
}

interface BookNotesDto extends MCPRequestOptions {
  bookId: string;
}

interface NotesDto extends MCPRequestOptions {
  notes: MCPBookNote[];
}

@Controller("api/mcp")
export class MCPController {
  constructor(private readonly mcpService: MCPService) {}

  @Post("bookshelf")
  async getBookshelf(@Body() dto: MCPRequestOptions) {
    return this.mcpService.getBookshelf(dto);
  }

  @Post("search")
  async searchBooks(@Body() dto: SearchBooksDto) {
    return this.mcpService.searchBooks(dto.query, dto);
  }

  @Post("book-notes")
  async getBookNotes(@Body() dto: BookNotesDto) {
    return this.mcpService.getBookNotes(dto.bookId, dto);
  }

  @Post("sync-notes")
  async syncNotes(@Body() dto: NotesDto) {
    return this.mcpService.syncNotes(dto.notes ?? [], dto);
  }

  @Post("analyze")
  async analyzeReading(@Body() dto: NotesDto) {
    return this.mcpService.analyzeReading(dto.notes ?? [], dto);
  }

  @Post("classify")
  async classifyNotes(@Body() dto: NotesDto) {
    return this.mcpService.classifyNotes(dto.notes ?? [], dto);
  }
}
