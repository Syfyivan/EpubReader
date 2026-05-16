package main

import (
	"encoding/json"
	"testing"
)

func TestParseMCPToolPayloadTextJSON(t *testing.T) {
	raw := json.RawMessage(`{"content":[{"type":"text","text":"[{\"id\":\"1\",\"title\":\"Book\"}]"}]}`)
	payload := parseMCPToolPayload(raw)
	records := asRecords(payload, []string{"books"})
	if len(records) != 1 {
		t.Fatalf("records length = %d, want 1", len(records))
	}
	if records[0]["title"] != "Book" {
		t.Fatalf("title = %#v, want Book", records[0]["title"])
	}
}

func TestNormalizeMCPNoteTimestampSeconds(t *testing.T) {
	note := normalizeMCPNote(map[string]any{
		"id":         "n1",
		"content":    "hello",
		"createTime": float64(1700000000),
	}, "b1")

	if note.CreatedAt != 1700000000000 {
		t.Fatalf("CreatedAt = %d, want 1700000000000", note.CreatedAt)
	}
	if note.BookID != "b1" {
		t.Fatalf("BookID = %s, want b1", note.BookID)
	}
}
