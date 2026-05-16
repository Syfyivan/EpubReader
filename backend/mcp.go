package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type MCPBookInfo struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Author     string   `json:"author"`
	Cover      string   `json:"cover,omitempty"`
	Progress   *float64 `json:"progress,omitempty"`
	NotesCount *float64 `json:"notesCount,omitempty"`
}

type MCPBookNote struct {
	ID        string   `json:"id"`
	BookID    string   `json:"bookId"`
	Content   string   `json:"content"`
	Chapter   string   `json:"chapter,omitempty"`
	Page      *float64 `json:"page,omitempty"`
	CreatedAt int64    `json:"createdAt"`
	UpdatedAt int64    `json:"updatedAt"`
	Tags      []string `json:"tags,omitempty"`
}

type MCPRequestOptions struct {
	ServerPath string `json:"serverPath,omitempty"`
}

type mcpSearchRequest struct {
	MCPRequestOptions
	Query string `json:"query"`
}

type mcpBookNotesRequest struct {
	MCPRequestOptions
	BookID string `json:"bookId"`
}

type mcpNotesRequest struct {
	MCPRequestOptions
	Notes []MCPBookNote `json:"notes"`
}

type mcpRPCClient struct {
	command *exec.Cmd
	stdin   io.WriteCloser
	reader  *bufio.Reader
	nextID  int
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (s *appServer) handleMCPBookshelf(w http.ResponseWriter, r *http.Request) {
	var request MCPRequestOptions
	if !readBodyOrError(w, r, &request) {
		return
	}
	payload, err := s.callMCPTool(r.Context(), request, "get_bookshelf", map[string]any{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	records := asRecords(payload, []string{"books", "items", "data"})
	books := make([]MCPBookInfo, 0, len(records))
	for _, record := range records {
		book := normalizeMCPBook(record)
		if book.ID != "" && book.Title != "" {
			books = append(books, book)
		}
	}
	writeJSON(w, http.StatusOK, books)
}

func (s *appServer) handleMCPSearch(w http.ResponseWriter, r *http.Request) {
	var request mcpSearchRequest
	if !readBodyOrError(w, r, &request) {
		return
	}
	payload, err := s.callMCPTool(r.Context(), request.MCPRequestOptions, "search_books", map[string]any{"query": request.Query})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	records := asRecords(payload, []string{"books", "items", "data"})
	books := make([]MCPBookInfo, 0, len(records))
	for _, record := range records {
		book := normalizeMCPBook(record)
		if book.ID != "" && book.Title != "" {
			books = append(books, book)
		}
	}
	writeJSON(w, http.StatusOK, books)
}

func (s *appServer) handleMCPBookNotes(w http.ResponseWriter, r *http.Request) {
	var request mcpBookNotesRequest
	if !readBodyOrError(w, r, &request) {
		return
	}
	if err := required(request.BookID, "bookId"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	payload, err := s.callMCPTool(r.Context(), request.MCPRequestOptions, "get_book_notes", map[string]any{"bookId": request.BookID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	records := asRecords(payload, []string{"notes", "items", "data", "highlights"})
	notes := make([]MCPBookNote, 0, len(records))
	for _, record := range records {
		note := normalizeMCPNote(record, request.BookID)
		if note.Content != "" {
			notes = append(notes, note)
		}
	}
	writeJSON(w, http.StatusOK, notes)
}

func (s *appServer) handleMCPSyncNotes(w http.ResponseWriter, r *http.Request) {
	s.handleMCPNotesTool(w, r, "sync_notes")
}

func (s *appServer) handleMCPAnalyze(w http.ResponseWriter, r *http.Request) {
	s.handleMCPNotesTool(w, r, "analyze_reading")
}

func (s *appServer) handleMCPClassify(w http.ResponseWriter, r *http.Request) {
	s.handleMCPNotesTool(w, r, "classify_notes")
}

func (s *appServer) handleMCPNotesTool(w http.ResponseWriter, r *http.Request, tool string) {
	var request mcpNotesRequest
	if !readBodyOrError(w, r, &request) {
		return
	}
	payload, err := s.callMCPTool(r.Context(), request.MCPRequestOptions, tool, map[string]any{"notes": request.Notes})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *appServer) callMCPTool(ctx context.Context, options MCPRequestOptions, toolName string, arguments map[string]any) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, s.cfg.MCPTimeout)
	defer cancel()

	client, err := newMCPRPCClient(ctx, s.resolveMCPServerPath(options))
	if err != nil {
		return nil, err
	}
	defer client.close()

	if err := client.initialize(ctx); err != nil {
		return nil, err
	}
	result, err := client.callTool(ctx, toolName, arguments)
	if err != nil {
		return nil, err
	}
	return parseMCPToolPayload(result), nil
}

func (s *appServer) resolveMCPServerPath(options MCPRequestOptions) string {
	if trimmed := strings.TrimSpace(options.ServerPath); trimmed != "" {
		return trimmed
	}
	return s.cfg.MCPServerPath
}

func newMCPRPCClient(ctx context.Context, commandLine string) (*mcpRPCClient, error) {
	parts := splitCommandLine(commandLine)
	if len(parts) == 0 {
		return nil, errors.New("MCP server command is empty")
	}

	command := exec.CommandContext(ctx, parts[0], parts[1:]...)
	command.Stderr = os.Stderr
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := command.Start(); err != nil {
		return nil, err
	}

	return &mcpRPCClient{
		command: command,
		stdin:   stdin,
		reader:  bufio.NewReader(stdout),
		nextID:  1,
	}, nil
}

func (c *mcpRPCClient) initialize(ctx context.Context) error {
	_, err := c.request(ctx, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]string{
			"name":    "epub-reader-backend-go",
			"version": "1.0.0",
		},
	})
	if err != nil {
		return err
	}
	return c.notify("notifications/initialized", map[string]any{})
}

func (c *mcpRPCClient) callTool(ctx context.Context, name string, arguments map[string]any) (json.RawMessage, error) {
	return c.request(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": arguments,
	})
}

func (c *mcpRPCClient) request(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	id := c.nextID
	c.nextID++

	message := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
	}
	if params != nil {
		message["params"] = params
	}
	if err := c.writeMessage(message); err != nil {
		return nil, err
	}

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		raw, err := c.readMessage()
		if err != nil {
			return nil, err
		}
		var response rpcResponse
		if err := json.Unmarshal(raw, &response); err != nil {
			return nil, err
		}
		if !sameJSONID(response.ID, id) {
			continue
		}
		if response.Error != nil {
			return nil, fmt.Errorf("MCP %s failed: %s", method, response.Error.Message)
		}
		return response.Result, nil
	}
}

func (c *mcpRPCClient) notify(method string, params map[string]any) error {
	message := map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
	}
	if params != nil {
		message["params"] = params
	}
	return c.writeMessage(message)
}

func (c *mcpRPCClient) writeMessage(message any) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(payload))
	if _, err := c.stdin.Write([]byte(header)); err != nil {
		return err
	}
	_, err = c.stdin.Write(payload)
	return err
}

func (c *mcpRPCClient) readMessage() ([]byte, error) {
	contentLength := 0
	for {
		line, err := c.reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(key), "Content-Length") {
			parsed, err := strconv.Atoi(strings.TrimSpace(value))
			if err != nil {
				return nil, err
			}
			contentLength = parsed
		}
	}
	if contentLength <= 0 {
		return nil, errors.New("MCP response missing Content-Length")
	}

	payload := make([]byte, contentLength)
	_, err := io.ReadFull(c.reader, payload)
	return payload, err
}

func (c *mcpRPCClient) close() {
	_ = c.stdin.Close()
	if c.command != nil && c.command.Process != nil {
		_ = c.command.Process.Kill()
	}
	if c.command != nil {
		_ = c.command.Wait()
	}
}

func parseMCPToolPayload(raw json.RawMessage) any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return string(raw)
	}

	record, ok := payload.(map[string]any)
	if !ok {
		return payload
	}
	content, ok := record["content"].([]any)
	if !ok {
		return payload
	}

	texts := make([]string, 0, len(content))
	for _, item := range content {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if text, ok := itemMap["text"].(string); ok && strings.TrimSpace(text) != "" {
			texts = append(texts, text)
		}
	}
	text := strings.TrimSpace(strings.Join(texts, "\n"))
	if text == "" {
		return content
	}

	var nested any
	if err := json.Unmarshal([]byte(text), &nested); err == nil {
		return nested
	}
	return text
}

func asRecords(payload any, collectionKeys []string) []map[string]any {
	if items, ok := payload.([]any); ok {
		return filterRecords(items)
	}

	record, ok := payload.(map[string]any)
	if !ok {
		return nil
	}
	for _, key := range collectionKeys {
		value, ok := record[key]
		if !ok {
			continue
		}
		if items, ok := value.([]any); ok {
			return filterRecords(items)
		}
		if nested, ok := value.(map[string]any); ok {
			for _, nestedKey := range collectionKeys {
				if items, ok := nested[nestedKey].([]any); ok {
					return filterRecords(items)
				}
			}
		}
	}
	return nil
}

func filterRecords(items []any) []map[string]any {
	records := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if record, ok := item.(map[string]any); ok {
			records = append(records, record)
		}
	}
	return records
}

func normalizeMCPBook(record map[string]any) MCPBookInfo {
	return MCPBookInfo{
		ID:         firstString(record, []string{"id", "bookId", "book_id", "wid"}),
		Title:      firstString(record, []string{"title", "name", "bookName"}),
		Author:     firstString(record, []string{"author", "writer"}),
		Cover:      firstString(record, []string{"cover", "coverUrl", "cover_url"}),
		Progress:   firstNumber(record, []string{"progress", "readingProgress", "reading_progress"}),
		NotesCount: firstNumber(record, []string{"notesCount", "noteCount", "notes_count"}),
	}
}

func normalizeMCPNote(record map[string]any, fallbackBookID string) MCPBookNote {
	id := firstString(record, []string{"id", "noteId", "note_id", "reviewId", "review_id"})
	if id == "" {
		id = fmt.Sprintf("mcp-note-%d", time.Now().UnixMilli())
	}
	bookID := firstString(record, []string{"bookId", "book_id"})
	if bookID == "" {
		bookID = fallbackBookID
	}

	return MCPBookNote{
		ID:        id,
		BookID:    bookID,
		Content:   firstString(record, []string{"content", "text", "markText", "abstract", "note"}),
		Chapter:   firstString(record, []string{"chapter", "chapterName", "chapterTitle"}),
		Page:      firstNumber(record, []string{"page", "pageNumber", "chapterUid"}),
		CreatedAt: normalizeTimestamp(record["createdAt"], record["createTime"], record["created_time"]),
		UpdatedAt: normalizeTimestamp(record["updatedAt"], record["updateTime"], record["updated_time"]),
		Tags:      firstStringSlice(record["tags"]),
	}
}

func firstString(record map[string]any, keys []string) string {
	for _, key := range keys {
		value, ok := record[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		case float64:
			if !math.IsNaN(typed) {
				return strconv.FormatFloat(typed, 'f', -1, 64)
			}
		case json.Number:
			return typed.String()
		}
	}
	return ""
}

func firstNumber(record map[string]any, keys []string) *float64 {
	for _, key := range keys {
		value, ok := record[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			if !math.IsNaN(typed) {
				return &typed
			}
		case int:
			result := float64(typed)
			return &result
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
			if err == nil {
				return &parsed
			}
		case json.Number:
			parsed, err := typed.Float64()
			if err == nil {
				return &parsed
			}
		}
	}
	return nil
}

func firstStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			result = append(result, strings.TrimSpace(text))
		}
	}
	return result
}

func normalizeTimestamp(values ...any) int64 {
	for _, value := range values {
		switch typed := value.(type) {
		case float64:
			if typed > 0 {
				return normalizeUnixTime(typed)
			}
		case int64:
			if typed > 0 {
				return normalizeUnixTime(float64(typed))
			}
		case int:
			if typed > 0 {
				return normalizeUnixTime(float64(typed))
			}
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				continue
			}
			if parsed, err := strconv.ParseFloat(trimmed, 64); err == nil {
				return normalizeUnixTime(parsed)
			}
			if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
				return parsed.UnixMilli()
			}
			if parsed, err := time.Parse("2006-01-02 15:04:05", trimmed); err == nil {
				return parsed.UnixMilli()
			}
		}
	}
	return time.Now().UnixMilli()
}

func normalizeUnixTime(value float64) int64 {
	if value < 1_000_000_000_000 {
		value *= 1000
	}
	return int64(value)
}

func splitCommandLine(commandLine string) []string {
	return strings.Fields(commandLine)
}

func sameJSONID(value any, expected int) bool {
	switch typed := value.(type) {
	case float64:
		return int(typed) == expected
	case int:
		return typed == expected
	case json.Number:
		parsed, err := typed.Int64()
		return err == nil && int(parsed) == expected
	default:
		encoded, _ := json.Marshal(value)
		return bytes.Equal(encoded, []byte(strconv.Itoa(expected)))
	}
}
