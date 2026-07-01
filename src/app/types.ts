export interface Position {
  id: number;
  name: string;
  position_group: number;
  group_name: string;
  base_production_rate_per_hour?: number;
  required?: number;
  speed?: number;
}

export interface PositionGroup {
  id: number;
  name: string;
  max_machines_per_worker?: number;
}

export interface Assignment {
  worker_id: number;
  worker_name: string;
  position_id: number;
  position_name: string;
  group_name: string;
  rate: number;
}

export interface ScheduleSlot {
  time: string;
  time_id: number;
  assignments: Assignment[];
}

export interface SummaryItem {
  group_id: number;
  group_name: string;
  target_volume: number | null;
  group_total_achieved: number;
}

export interface ResultMeta {
  model: string;
  timestamp: string;
}

export interface ScheduleResult {
  status: string;
  schedule: ScheduleSlot[];
  summary: SummaryItem[];
  meta?: ResultMeta;
  generated_at?: string;
  timestamp?: string;
}

export interface AnalysisItem {
  request: string;
  category: string;
  type?: string;
  matched_rule_type?: string | null;
  reason?: string;
  text?: string;
  original_text?: string;
  description?: string;
}

export interface UnsupportedRule {
  request: string;
  missing_rule_type?: string | null;
  reason?: string;
  text?: string;
  original_text?: string;
  description?: string;
}

export interface Strategy {
  priority_process: string[];
  priority_time_range: { start_hour: number; end_hour: number } | null;
  weights: Record<string, number>;
  hard_rules: unknown[];
  soft_rules: unknown[];
  max_time_seconds: number;
}

export interface UpdatedData {
  strategy?: Strategy;
  analysis?: AnalysisItem[];
  already_defined_in_master_data?: unknown[];
  unsupported_rules?: UnsupportedRule[];
}

export interface AnalyzeResponse extends UpdatedData {
  status: "success" | "error";
  message?: string;
  history_info?: HistoryInfo;
}

export interface SolveResponse {
  status: "success" | "error";
  message?: string;
}

export interface HistoryInfo {
  status?: "success" | "error";
  safe_model_name?: string;
  timestamp?: string;
  message?: string;
}

export interface HistoryListItem {
  filename: string;
  model: string;
  display_time: string;
}

export interface ExplainErrorResponse {
  status: "success" | "error";
  explanation?: string;
  message?: string;
}
