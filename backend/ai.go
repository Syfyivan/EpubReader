package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
)

type AIAnalysis struct {
	Summary     string   `json:"summary"`
	Insights    []string `json:"insights"`
	Questions   []string `json:"questions"`
	Connections []string `json:"connections"`
}

type analyzeContentRequest struct {
	Content string `json:"content"`
}

type generateCodeRequest struct {
	Description string `json:"description"`
	Language    string `json:"language,omitempty"`
}

type explainCodeRequest struct {
	Code     string `json:"code"`
	Language string `json:"language,omitempty"`
}

type reviewCodeRequest struct {
	Code     string `json:"code"`
	Language string `json:"language,omitempty"`
}

type chatCompletionRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatCompletionResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

func (s *appServer) handleAIStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": s.cfg.DashScopeAPIKey != "",
		"runtime":    "go",
		"models": map[string]string{
			"summary":  s.cfg.SummaryModel,
			"analysis": s.cfg.AnalysisModel,
			"coder":    s.cfg.CoderModel,
		},
	})
}

func (s *appServer) handleAnalyzeContent(w http.ResponseWriter, r *http.Request) {
	var request analyzeContentRequest
	if !readBodyOrError(w, r, &request) {
		return
	}
	if err := required(request.Content, "content"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	analysis, err := s.analyzeContent(r.Context(), request.Content)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, analysis)
}

func (s *appServer) handleGenerateCode(w http.ResponseWriter, r *http.Request) {
	var request generateCodeRequest
	if !readBodyOrError(w, r, &request) {
		return
	}
	if err := required(request.Description, "description"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	language := defaultLanguage(request.Language)
	result, err := s.chat(r.Context(), s.cfg.CoderModel, 0.3, promptGenerateCode(request.Description, language))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": result})
}

func (s *appServer) handleExplainCode(w http.ResponseWriter, r *http.Request) {
	var request explainCodeRequest
	if !readBodyOrError(w, r, &request) {
		return
	}
	if err := required(request.Code, "code"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	language := defaultLanguage(request.Language)
	result, err := s.chat(r.Context(), s.cfg.CoderModel, 0.3, promptExplainCode(request.Code, language))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"explanation": result})
}

func (s *appServer) handleReviewCode(w http.ResponseWriter, r *http.Request) {
	var request reviewCodeRequest
	if !readBodyOrError(w, r, &request) {
		return
	}
	if err := required(request.Code, "code"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	language := defaultLanguage(request.Language)
	result, err := s.chat(r.Context(), s.cfg.CoderModel, 0.3, promptReviewCode(request.Code, language))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"review": result})
}

func (s *appServer) analyzeContent(ctx context.Context, content string) (AIAnalysis, error) {
	var wg sync.WaitGroup
	type result struct {
		value string
		err   error
	}

	summaryResult := result{}
	insightsResult := result{}
	questionsResult := result{}

	wg.Add(3)
	go func() {
		defer wg.Done()
		summaryResult.value, summaryResult.err = s.chat(ctx, s.cfg.SummaryModel, s.cfg.Temperature, promptSummary(content))
	}()
	go func() {
		defer wg.Done()
		insightsResult.value, insightsResult.err = s.chat(ctx, s.cfg.SummaryModel, s.cfg.Temperature, promptInsights(content))
	}()
	go func() {
		defer wg.Done()
		questionsResult.value, questionsResult.err = s.chat(ctx, s.cfg.SummaryModel, s.cfg.Temperature, promptQuestions(content))
	}()
	wg.Wait()

	if err := firstError(summaryResult.err, insightsResult.err, questionsResult.err); err != nil {
		return AIAnalysis{}, err
	}

	connectionText, err := s.chat(ctx, s.cfg.AnalysisModel, s.cfg.Temperature, promptConnections(content, insightsResult.value))
	if err != nil {
		return AIAnalysis{}, err
	}

	return AIAnalysis{
		Summary:     summaryResult.value,
		Insights:    parseList(insightsResult.value),
		Questions:   parseList(questionsResult.value),
		Connections: parseList(connectionText),
	}, nil
}

func (s *appServer) chat(ctx context.Context, model string, temperature float64, prompt string) (string, error) {
	if s.cfg.DashScopeAPIKey == "" {
		return "", errors.New("DASHSCOPE_API_KEY is not configured")
	}

	body := chatCompletionRequest{
		Model: model,
		Messages: []chatMessage{
			{Role: "user", Content: prompt},
		},
		Temperature: temperature,
		MaxTokens:   s.cfg.MaxTokens,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.DashScopeBaseURL+"/chat/completions", bytes.NewReader(encoded))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+s.cfg.DashScopeAPIKey)
	request.Header.Set("Content-Type", "application/json")

	response, err := s.httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	var payload chatCompletionResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if payload.Error != nil && payload.Error.Message != "" {
			return "", fmt.Errorf("dashscope request failed: %s", payload.Error.Message)
		}
		return "", fmt.Errorf("dashscope request failed: %s", response.Status)
	}
	if payload.Error != nil && payload.Error.Message != "" {
		return "", errors.New(payload.Error.Message)
	}
	if len(payload.Choices) == 0 {
		return "", errors.New("dashscope response did not include choices")
	}
	return strings.TrimSpace(payload.Choices[0].Message.Content), nil
}

func defaultLanguage(language string) string {
	if strings.TrimSpace(language) == "" {
		return "typescript"
	}
	return strings.TrimSpace(language)
}

func firstError(errors ...error) error {
	for _, err := range errors {
		if err != nil {
			return err
		}
	}
	return nil
}

var listPrefixPattern = regexp.MustCompile(`^(\d+[\).、]?\s*|[-*•]\s*)`)

func parseList(text string) []string {
	lines := strings.Split(text, "\n")
	items := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || !listPrefixPattern.MatchString(trimmed) {
			continue
		}
		item := strings.TrimSpace(listPrefixPattern.ReplaceAllString(trimmed, ""))
		if item != "" {
			items = append(items, item)
		}
	}
	return items
}

func promptSummary(content string) string {
	return fmt.Sprintf(`请为以下文本内容生成一个简洁的摘要（100-200字）：

%s

摘要要求：
1. 提取核心观点和关键信息
2. 保持逻辑清晰
3. 使用简洁明了的语言
`, content)
}

func promptInsights(content string) string {
	return fmt.Sprintf(`请从以下角度分析以下文本内容，生成3-5个深度洞察：

文本内容：
%s

分析角度：
1. 核心观点和论证逻辑
2. 与现实生活的联系
3. 可能的批判性思考
4. 跨领域的知识关联
5. 个人成长和启发

请为每个洞察提供简洁的说明（50-100字）。
`, content)
}

func promptQuestions(content string) string {
	return fmt.Sprintf(`基于以下文本内容，生成5-7个启发式问题，这些问题应该：
1. 促进深度思考
2. 连接已有知识
3. 激发新的想法
4. 挑战既有观点

文本内容：
%s

请以列表形式输出问题，每个问题一行。
`, content)
}

func promptConnections(content string, insights string) string {
	return fmt.Sprintf(`基于以下文本内容和洞察，生成3-5个跨领域的知识关联：

文本内容：
%s

已有洞察：
%s

请说明这些内容如何与其他领域的知识、概念或经验相关联。
`, content, insights)
}

func promptGenerateCode(description string, language string) string {
	return fmt.Sprintf(`请根据以下描述生成 %s 代码：

描述：
%s

要求：
1. 代码简洁高效
2. 包含必要的注释
3. 遵循最佳实践
4. 可以直接运行

请只输出代码，不要有其他解释。
`, language, description)
}

func promptExplainCode(code string, language string) string {
	return fmt.Sprintf("请解释以下 %s 代码的功能：\n\n```%s\n%s\n```\n\n请从以下角度解释：\n1. 代码的主要功能\n2. 关键逻辑和算法\n3. 可能的优化点\n4. 潜在的问题或改进建议\n", language, language, code)
}

func promptReviewCode(code string, language string) string {
	return fmt.Sprintf("请审查以下 %s 代码并提供改进建议：\n\n```%s\n%s\n```\n\n请从以下方面审查：\n1. 代码质量（可读性、可维护性）\n2. 性能优化\n3. 安全性问题\n4. 最佳实践\n5. 潜在的 bug\n\n请给出具体的改进建议。\n", language, language, code)
}
