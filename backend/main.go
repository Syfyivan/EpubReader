package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type config struct {
	Port             string
	FrontendOrigins  []string
	DashScopeAPIKey  string
	DashScopeBaseURL string
	SummaryModel     string
	AnalysisModel    string
	CoderModel       string
	Temperature      float64
	MaxTokens        int
	MCPServerPath    string
	MCPTimeout       time.Duration
}

type appServer struct {
	cfg        config
	httpClient *http.Client
}

func main() {
	loadDotEnv(".env")
	loadDotEnv("../.env")

	cfg := loadConfig()
	if cfg.DashScopeAPIKey == "" {
		log.Println("DASHSCOPE_API_KEY is not configured. AI endpoints will return an error until it is set.")
	}

	server := &appServer{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}

	mux := http.NewServeMux()
	server.registerRoutes(mux)

	addr := ":" + cfg.Port
	log.Printf("Backend server is running on http://localhost:%s", cfg.Port)
	if err := http.ListenAndServe(addr, server.withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func loadConfig() config {
	temperature := envFloat("DASHSCOPE_TEMPERATURE", 0.7)
	maxTokens := envInt("DASHSCOPE_MAX_TOKENS", 4000)
	mcpTimeout := time.Duration(envInt("MCP_TIMEOUT_SECONDS", 30)) * time.Second

	return config{
		Port:             envString("PORT", "3001"),
		FrontendOrigins:  envList("FRONTEND_URL", []string{"http://localhost:5173", "http://127.0.0.1:5173"}),
		DashScopeAPIKey:  os.Getenv("DASHSCOPE_API_KEY"),
		DashScopeBaseURL: strings.TrimRight(envString("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"), "/"),
		SummaryModel:     envString("DASHSCOPE_SUMMARY_MODEL", "qwen-plus"),
		AnalysisModel:    envString("DASHSCOPE_ANALYSIS_MODEL", "qwen-max"),
		CoderModel:       envString("DASHSCOPE_CODER_MODEL", "qwen3-coder-flash"),
		Temperature:      temperature,
		MaxTokens:        maxTokens,
		MCPServerPath:    envString("MCP_SERVER_PATH", "mcp-server"),
		MCPTimeout:       mcpTimeout,
	}
}

func (s *appServer) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/api/ai/status", s.handleAIStatus)
	mux.HandleFunc("/api/ai/analyze", s.onlyPost(s.handleAnalyzeContent))
	mux.HandleFunc("/api/ai/code/generate", s.onlyPost(s.handleGenerateCode))
	mux.HandleFunc("/api/ai/code/explain", s.onlyPost(s.handleExplainCode))
	mux.HandleFunc("/api/ai/code/review", s.onlyPost(s.handleReviewCode))
	mux.HandleFunc("/api/mcp/bookshelf", s.onlyPost(s.handleMCPBookshelf))
	mux.HandleFunc("/api/mcp/search", s.onlyPost(s.handleMCPSearch))
	mux.HandleFunc("/api/mcp/book-notes", s.onlyPost(s.handleMCPBookNotes))
	mux.HandleFunc("/api/mcp/sync-notes", s.onlyPost(s.handleMCPSyncNotes))
	mux.HandleFunc("/api/mcp/analyze", s.onlyPost(s.handleMCPAnalyze))
	mux.HandleFunc("/api/mcp/classify", s.onlyPost(s.handleMCPClassify))
}

func (s *appServer) onlyPost(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		next(w, r)
	}
}

func (s *appServer) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowedOrigin := s.allowedOrigin(origin)
		if allowedOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *appServer) allowedOrigin(origin string) string {
	if origin == "" && len(s.cfg.FrontendOrigins) > 0 {
		return s.cfg.FrontendOrigins[0]
	}
	for _, candidate := range s.cfg.FrontendOrigins {
		if candidate == "*" {
			return origin
		}
		if origin == candidate {
			return origin
		}
	}
	return ""
}

func (s *appServer) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"runtime": "go",
	})
}

func decodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("write json failed: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"error":   http.StatusText(status),
		"message": message,
	})
}

func readBodyOrError(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := decodeJSON(r, target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return false
	}
	return true
}

func envString(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envFloat(key string, fallback float64) float64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envList(key string, fallback []string) []string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	if len(result) == 0 {
		return fallback
	}
	return result
}

func loadDotEnv(path string) {
	file, err := os.Open(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("read %s failed: %v", path, err)
		}
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
	if err := scanner.Err(); err != nil {
		log.Printf("scan %s failed: %v", path, err)
	}
}

func required(value string, name string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", name)
	}
	return nil
}
