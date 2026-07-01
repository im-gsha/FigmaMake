import type {
  AnalyzeResponse,
  ExplainErrorResponse,
  HistoryInfo,
  HistoryListItem,
  PositionGroup,
  Position,
  ScheduleResult,
  SolveResponse,
  UpdatedData,
} from "./types";

export const API_BASE_URL = "http://192.168.21.116:5000";

export type AIEngine = "ollama" | "gemini";

export type LLMModel =
  | "qwen2.5:7b"
  | "llama3.1:8b"
  | "gemma3:4b"
  | "gemma3:12b";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, options);
  return (await res.json()) as T;
}

export function getResult(): Promise<ScheduleResult> {
  return apiFetch<ScheduleResult>("/output/v3_result.json");
}

export function getUpdated(): Promise<UpdatedData> {
  return apiFetch<UpdatedData>("/output/v3_updated.json");
}

export function getPositions(): Promise<Position[]> {
  return apiFetch<Position[]>("/sample/positions.json");
}

export function getPositionGroups(): Promise<PositionGroup[]> {
  return apiFetch<PositionGroup[]>("/sample/positionGroup.json");
}

export function getCurrentRequestText(): Promise<string | null> {
  return apiFetch<string | null>("/data/request.json");
}

export interface AnalyzePayload {
  text: string;
  mode: AIEngine;
  model: string;
  gemini_key?: string;
}

export function analyzeRequest(payload: AnalyzePayload): Promise<AnalyzeResponse> {
  return apiFetch<AnalyzeResponse>("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function solveSchedule(historyInfo?: HistoryInfo): Promise<SolveResponse> {
  return apiFetch<SolveResponse>("/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history_info: historyInfo ?? null }),
  });
}

export function explainError(errorMessage: string, geminiKey: string): Promise<ExplainErrorResponse> {
  return apiFetch<ExplainErrorResponse>("/api/explain_error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error_message: errorMessage, gemini_key: geminiKey }),
  });
}

export function getHistoryList(): Promise<HistoryListItem[]> {
  return apiFetch<HistoryListItem[]>("/api/history/list");
}

export function getHistoryStrategy(filename: string): Promise<UpdatedData & { status?: string; message?: string }> {
  return apiFetch(`/api/history/load_strategy/${filename}`);
}
