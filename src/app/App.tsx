import { useState, useRef } from "react";
import {
  ChevronDown,
  Bot,
  AlertTriangle,
  CheckCircle,
  Clock,
} from "lucide-react";

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE_URL = "http://192.168.21.116:5000";

const DISTINCT_COLORS = [
  { bg: "#FFCDD2", bar: "#E53935" },
  { bg: "#C8E6C9", bar: "#43A047" },
  
  { bg: "#BBDEFB", bar: "#1E88E5" },
  { bg: "#FFF9C4", bar: "#FBC02D" },
  { bg: "#E1BEE7", bar: "#8E24AA" },
  { bg: "#FFE0B2", bar: "#FB8C00" },
  { bg: "#B2EBF2", bar: "#00ACC1" },
  { bg: "#F8BBD0", bar: "#D81B60" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type AIEngine = "ollama" | "gemini";
type LLMModel =
  | "qwen2.5:7b"
  | "llama3.1:8b"
  | "gemma3:4b"
  | "gemma3:12b";

interface HistoryInfo {
  timestamp?: string;
  [key: string]: unknown;
}

interface AnalyzeResponse {
  status: "success" | "error";
  strategy?: Record<string, unknown>;
  history_info?: HistoryInfo;
  message?: string;
}

interface SolveResponse {
  status: "success" | "error";
  message?: string;
}

interface Assignment {
  position_name: string;
  worker_name: string;
  rate?: number | string;
}

interface TimeSlot {
  time: string;
  assignments: Assignment[];
}

interface SummaryEntry {
  group_id: number | string;
  target_volume?: number;
  group_total_achieved?: number;
}

interface ResultJson {
  schedule?: TimeSlot[];
  summary?: SummaryEntry[];
  [key: string]: unknown;
}

interface Position {
  group_name: string;
  name: string;
  [key: string]: unknown;
}

interface PositionGroup {
  id: number | string;
  name: string;
  [key: string]: unknown;
}

interface ScheduleData {
  result: ResultJson;
  positions: Position[];
  positionGroups: PositionGroup[];
}

interface PastEntry {
  id: string;
  label: string;
  historyInfo: HistoryInfo;
  strategy: Record<string, unknown>;
  scheduleData: ScheduleData | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface IgnoredItem {
  text: string;
  reason: string;
}

/** Pull unrecognized / ignored items out of whatever field the backend uses. */
function extractIgnored(
  strategy: Record<string, unknown>,
): IgnoredItem[] {
  const candidates = [
    "unrecognized_requests",
    "ignored_requests",
    "ignored",
    "unhandled",
    "unknown_requests",
  ];
  for (const key of candidates) {
    const val = strategy[key];
    if (!Array.isArray(val) || val.length === 0) continue;
    return val.map((item) => {
      if (item && typeof item === "object" && "text" in item) {
        return {
          text: String(
            (item as Record<string, unknown>).text ?? "",
          ),
          reason: String(
            (item as Record<string, unknown>).reason ?? "",
          ),
        };
      }
      return { text: String(item), reason: "" };
    });
  }
  return [];
}

/** Return only the soft-rule keys (synergy_updates, group_rules) for the green box. */
function extractSoftRules(
  strategy: Record<string, unknown>,
): Record<string, unknown> {
  const softKeys = ["synergy_updates", "group_rules"];
  const result: Record<string, unknown> = {};
  for (const k of softKeys) {
    if (k in strategy) result[k] = strategy[k];
  }
  // fallback: if neither key exists, show everything except ignored keys
  if (Object.keys(result).length === 0) {
    const ignoredKeys = new Set([
      "unrecognized_requests",
      "ignored_requests",
      "ignored",
      "unhandled",
      "unknown_requests",
    ]);
    return Object.fromEntries(
      Object.entries(strategy).filter(
        ([k]) => !ignoredKeys.has(k),
      ),
    );
  }
  return result;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Select({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none bg-white border border-gray-300 rounded-md px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
    </div>
  );
}

function JsonBlock({ data }: { data: unknown }) {
  const json =
    typeof data === "string"
      ? data
      : JSON.stringify(data, null, 2);
  const colorized = json
    .replace(
      /("[\w_]+")\s*:/g,
      '<span style="color:#2563eb">$1</span>:',
    )
    .replace(
      /:\s*(".*?")/g,
      ': <span style="color:#16a34a">$1</span>',
    )
    .replace(
      /:\s*(-?\d+(?:\.\d+)?)/g,
      ': <span style="color:#ea580c">$1</span>',
    );
  return (
    <pre
      className="text-xs leading-5 whitespace-pre overflow-auto"
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
      dangerouslySetInnerHTML={{ __html: colorized }}
    />
  );
}

function Spinner({ color = "white" }: { color?: string }) {
  return (
    <div
      className="w-4 h-4 rounded-full animate-spin"
      style={{
        border: `2px solid ${color}`,
        borderTopColor: "transparent",
      }}
    />
  );
}

// ─── Schedule Table ───────────────────────────────────────────────────────────

function ShiftScheduleTable({ data }: { data: ScheduleData }) {
  const { result, positions, positionGroups } = data;
  const schedule: TimeSlot[] = result.schedule ?? [];

  // Build group stats map: group_id → { targets, achieved }
  const groupStats: Record<
    string,
    { target?: number; achieved?: number }
  > = {};
  (result.summary ?? []).forEach((s) => {
    groupStats[String(s.group_id)] = {
      target: s.target_volume,
      achieved: s.group_total_achieved,
    };
  });

  // Build worker → color map (stable across renders by memo-ing in closure)
  const workerColorMap: Record<
    string,
    (typeof DISTINCT_COLORS)[0]
  > = {};
  let colorCounter = 0;
  function colorFor(workerName: string) {
    if (!workerColorMap[workerName]) {
      workerColorMap[workerName] =
        DISTINCT_COLORS[colorCounter % DISTINCT_COLORS.length];
      colorCounter++;
    }
    return workerColorMap[workerName];
  }

  // Group positions by group_name, preserving order
  const groupNames = [
    ...new Set(positions.map((p) => p.group_name)),
  ];

  if (schedule.length === 0) {
    return (
      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 overflow-auto max-h-72">
        <p className="text-xs text-gray-500 mb-2">
          生データ (v3_result.json):
        </p>
        <JsonBlock data={result} />
      </div>
    );
  }

  return (
    <div className="overflow-auto" style={{ maxHeight: 550 }}>
      <table
        style={{
          borderCollapse: "separate",
          borderSpacing: 0,
          width: "100%",
          fontSize: 12,
        }}
      >
        <thead>
          <tr>
            <th style={stickyCol1Head}>グループ</th>
            <th style={stickyCol2Head}>設備</th>
            {schedule.map((slot) => (
              <th key={slot.time} style={timeHeadStyle}>
                {slot.time}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupNames.map((groupName) => {
            const groupPositions = positions.filter(
              (p) => p.group_name === groupName,
            );
            const groupInfo = positionGroups.find(
              (g) => g.name === groupName,
            );
            const gid = groupInfo ? String(groupInfo.id) : null;
            const stats = gid ? (groupStats[gid] ?? {}) : {};

            return groupPositions.map((pos, idx) => (
              <tr key={`${groupName}-${pos.name}`}>
                {/* Group cell — only for first position in the group */}
                {idx === 0 && (
                  <td
                    rowSpan={groupPositions.length}
                    style={{
                      ...stickyCol1Cell,
                      background: "#2c3e50",
                      color: "#fff",
                      verticalAlign: "middle",
                      textAlign: "center",
                      padding: "8px 6px",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: "bold",
                        fontSize: 13,
                        marginBottom: 4,
                      }}
                    >
                      {groupName}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        background: "rgba(0,0,0,0.2)",
                        padding: "4px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {stats.target !== undefined ? (
                        <div style={{ color: "#2ecc71" }}>
                          目標: {stats.target}
                        </div>
                      ) : (
                        <div style={{ color: "#aaa" }}>
                          目標なし
                        </div>
                      )}
                      {stats.achieved !== undefined && (
                        <div
                          style={{
                            color: "#00ffcc",
                            fontWeight: "bold",
                            marginTop: 3,
                          }}
                        >
                          予測: {stats.achieved}
                        </div>
                      )}
                    </div>
                  </td>
                )}

                {/* Position name cell */}
                <td
                  style={{
                    ...stickyCol2Cell,
                    fontWeight: "bold",
                    background: "#ecf0f1",
                    color: "#2c3e50",
                  }}
                >
                  {pos.name}
                </td>

                {/* Time slot cells */}
                {schedule.map((slot) => {
                  const matches = slot.assignments.filter(
                    (a) => a.position_name === pos.name,
                  );
                  return (
                    <td key={slot.time} style={slotCellStyle}>
                      {matches.length > 0 ? (
                        matches.map((a, ai) => {
                          const clr = colorFor(a.worker_name);
                          return (
                            <div
                              key={ai}
                              style={{
                                background: clr.bg,
                                borderLeft: `5px solid ${clr.bar}`,
                                padding: "4px 5px",
                                borderRadius: 4,
                                marginBottom:
                                  ai < matches.length - 1
                                    ? 2
                                    : 0,
                              }}
                            >
                              <strong
                                style={{
                                  color: "#000",
                                  fontSize: 12,
                                }}
                              >
                                {a.worker_name}
                              </strong>
                              {a.rate !== undefined && (
                                <>
                                  <br />
                                  <span
                                    style={{
                                      fontSize: 9,
                                      color: "#555",
                                    }}
                                  >
                                    {a.rate}/h
                                  </span>
                                </>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <span style={{ color: "#ccc" }}>·</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

// Shared cell styles
const stickyBase: React.CSSProperties = {
  position: "sticky",
  zIndex: 2,
  border: "1px solid #ddd",
  whiteSpace: "nowrap",
  padding: "6px 8px",
};
const stickyCol1Head: React.CSSProperties = {
  ...stickyBase,
  left: 0,
  zIndex: 3,
  background: "#34495e",
  color: "#fff",
  minWidth: 90,
  textAlign: "center",
};
const stickyCol2Head: React.CSSProperties = {
  ...stickyBase,
  left: 90,
  zIndex: 3,
  background: "#34495e",
  color: "#fff",
  minWidth: 80,
};
const stickyCol1Cell: React.CSSProperties = {
  ...stickyBase,
  left: 0,
  minWidth: 90,
};
const stickyCol2Cell: React.CSSProperties = {
  ...stickyBase,
  left: 90,
  minWidth: 80,
  fontSize: 12,
};
const timeHeadStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: "4px 3px",
  background: "#34495e",
  color: "#fff",
  fontSize: 10,
  textAlign: "center",
  minWidth: 64,
  whiteSpace: "nowrap",
};
const slotCellStyle: React.CSSProperties = {
  border: "1px solid #eee",
  padding: "3px",
  verticalAlign: "top",
  minWidth: 64,
};

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [engine, setEngine] = useState<AIEngine>("ollama");
  const [geminiKey, setGeminiKey] = useState("");
  const [model, setModel] = useState<LLMModel>("gemma3:12b");
  const [prompt, setPrompt] = useState(
    "今日のOutput（出力）ラインは高負荷なので、最低でも2人は配置してほしいです。あと、坪井さんと岩下さんは同じ出力グループにペアで入れてあげてください。あ、そういえば長谷川さんが「来週」休みたいって言ってました。",
  );

  const [savedHistoryInfo, setSavedHistoryInfo] =
    useState<HistoryInfo | null>(null);
  const [history, setHistory] = useState<PastEntry[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] =
    useState("__latest__");

  const [strategy, setStrategy] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [latestScheduleData, setLatestScheduleData] =
    useState<ScheduleData | null>(null);

  const [analysisStatus, setAnalysisStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [scheduleStatus, setScheduleStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [scheduleError, setScheduleError] = useState("");

  const scheduleRef = useRef<HTMLDivElement>(null);

  // Derived display values
  const historyOptions = [
    {
      value: "__latest__",
      label: "— 最新の計算結果を表示中 —",
    },
    ...history.map((h) => ({ value: h.id, label: h.label })),
  ];

  const displayedScheduleData: ScheduleData | null =
    selectedHistoryId === "__latest__"
      ? latestScheduleData
      : (history.find((h) => h.id === selectedHistoryId)
          ?.scheduleData ?? null);

  const displayedStrategy: Record<string, unknown> | null =
    selectedHistoryId === "__latest__"
      ? strategy
      : (history.find((h) => h.id === selectedHistoryId)
          ?.strategy ?? null);

  const softRules = displayedStrategy
    ? extractSoftRules(displayedStrategy)
    : null;
  const ignoredItems = displayedStrategy
    ? extractIgnored(displayedStrategy)
    : [];

  // ─── Button 1: AI Analysis ─────────────────────────────────────────────────

  async function handleAnalysis() {
    if (!prompt.trim()) return;
    setAnalysisStatus("loading");
    setAnalysisError("");
    setStrategy(null);
    setSavedHistoryInfo(null);

    try {
      const body: Record<string, string> = {
        mode: engine,
        text: prompt,
        // 💡 額外提醒：後端 v3_process_shift.py 預設的 Gemini 模型名稱是 "gemini-2.5-flash"
        // 確保這裡傳過去的是正確的模型完整名稱
        model: engine === "ollama" ? model : "gemini-2.5-flash",
      };
      // ⭕ 修正：將 "gemini_api_key" 改為 "gemini_key"，與後端 data.get("gemini_key") 100% 對齊！
      if (engine === "gemini" && geminiKey)
        body["gemini_key"] = geminiKey;

      const res = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok)
        throw new Error(
          `HTTP ${res.status}: ${res.statusText}`,
        );

      const data: AnalyzeResponse = await res.json();
      if (data.status === "success") {
        setStrategy(data.strategy ?? {});
        setSavedHistoryInfo(data.history_info ?? null);
        setAnalysisStatus("done");
      } else {
        throw new Error(data.message ?? "AI分析に失敗しました");
      }
    } catch (e) {
      setAnalysisError(
        e instanceof Error ? e.message : String(e),
      );
      setAnalysisStatus("error");
    }
  }

  // ─── Button 2: OR-Tools Solve ──────────────────────────────────────────────

  async function handleSolve() {
    if (!savedHistoryInfo) return;
    setScheduleStatus("loading");
    setScheduleError("");

    try {
      const res = await fetch(`${API_BASE_URL}/api/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history_info: savedHistoryInfo,
        }),
      });
      if (!res.ok)
        throw new Error(
          `HTTP ${res.status}: ${res.statusText}`,
        );

      const data: SolveResponse = await res.json();
      if (data.status === "success") {
        await fetchLatestResult();
      } else {
        throw new Error(
          data.message ?? "OR-Tools計算に失敗しました",
        );
      }
    } catch (e) {
      setScheduleError(
        e instanceof Error ? e.message : String(e),
      );
      setScheduleStatus("error");
    }
  }

  // ─── Fetch result.json + positions + positionGroup ─────────────────────────

  async function fetchLatestResult() {
    const [resultRes, posRes, groupRes] = await Promise.all([
      fetch(`${API_BASE_URL}/output/v3_result.json`),
      fetch(`${API_BASE_URL}/sample/positions.json`),
      fetch(`${API_BASE_URL}/sample/positionGroup.json`),
    ]);

    if (!resultRes.ok)
      throw new Error(
        `result.json取得失敗: HTTP ${resultRes.status}`,
      );
    const result: ResultJson = await resultRes.json();

    const positions: Position[] = posRes.ok
      ? await posRes.json()
      : [];
    const positionGroups: PositionGroup[] = groupRes.ok
      ? await groupRes.json()
      : [];

    const scheduleData: ScheduleData = {
      result,
      positions,
      positionGroups,
    };
    setLatestScheduleData(scheduleData);
    setScheduleStatus("done");
    setSelectedHistoryId("__latest__");

    const ts = new Date().toLocaleString("ja-JP");
    const entry: PastEntry = {
      id: `run_${Date.now()}`,
      label: `計算結果 #${history.length + 1}  (${ts})`,
      historyInfo: savedHistoryInfo!,
      strategy: strategy ?? {},
      scheduleData,
    };
    setHistory((prev) => [entry, ...prev]);

    setTimeout(
      () =>
        scheduleRef.current?.scrollIntoView({
          behavior: "smooth",
        }),
      100,
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        fontFamily: "'Noto Sans JP', sans-serif",
        background: "#f0f2f5",
      }}
    >
      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-4 shadow-lg">
        <div className="flex items-center gap-3 mb-1">
          <Bot className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold tracking-tight">
            AI駆動型ハイブリッド排班コントロールパネル
          </h1>
        </div>
        <p className="text-gray-400 text-sm pl-9">
          本社のクラウドマスターを基盤に、現場の自由な日本語要望を解釈して数学的最適解（OPTIMAL）を算出します。
        </p>
      </header>

      <div className="flex-1 p-4 flex flex-col gap-4">
        {/* ─── Top row ─── */}
        <div className="flex gap-4 flex-col lg:flex-row">
          {/* Left: 条件設定 */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 lg:w-1/2 flex flex-col gap-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <span>🔧</span> 1. 条件設定 &amp; 要望入力
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                使用するAIエンジン:
              </label>
              <Select
                value={engine}
                onChange={(v) => {
                  setEngine(v as AIEngine);
                  setAnalysisStatus("idle");
                  setStrategy(null);
                }}
                options={[
                  {
                    value: "ollama",
                    label:
                      "ローカル LLM（Ollama / 無料・高セキュリティ）",
                  },
                  {
                    value: "gemini",
                    label:
                      "Gemini API（Google / 高精度・クラウド）",
                  },
                ]}
              />
            </div>

            {engine === "gemini" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gemini API キー:
                </label>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIza..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {engine === "ollama" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ローカル模型選択:
                </label>
                <Select
                  value={model}
                  onChange={(v) => setModel(v as LLMModel)}
                  options={[
                    {
                      value: "qwen2.5:7b",
                      label: "Qwen 2.5 (7B) - Alibaba高性能",
                    },
                    {
                      value: "llama3.1:8b",
                      label: "Llama 3.1 (8B) - Meta最新版",
                    },
                    {
                      value: "gemma3:4b",
                      label: "Gemma 3 (4B) - Google軽量版",
                    },
                    {
                      value: "gemma3:12b",
                      label: "Gemma 3 (12B) - Google最新世代",
                    },
                  ]}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                現場の日本語要望（自由入力）:
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                placeholder="現場の要望を自由に日本語で入力してください..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <span className="text-amber-500">📋</span>
                <span className="text-blue-600 underline cursor-default">
                  過去の計算結果と比較・切り替え:
                </span>
              </label>
              <Select
                value={selectedHistoryId}
                onChange={setSelectedHistoryId}
                options={historyOptions}
              />
            </div>

            <div className="flex gap-3 mt-1">
              <button
                onClick={handleAnalysis}
                disabled={
                  analysisStatus === "loading" || !prompt.trim()
                }
                className="flex-1 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-3 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {analysisStatus === "loading" ? (
                  <>
                    <Spinner />
                    分析中...
                  </>
                ) : (
                  "🤖 1. AIで語意分析・加点化"
                )}
              </button>
              <button
                onClick={handleSolve}
                disabled={
                  scheduleStatus === "loading" ||
                  analysisStatus !== "done"
                }
                className="flex-1 bg-green-500 hover:bg-green-600 active:bg-green-700 disabled:bg-green-300 text-white font-semibold py-3 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {scheduleStatus === "loading" ? (
                  <>
                    <Spinner />
                    実行中...
                  </>
                ) : (
                  "📊 2. OR-Toolsでシフト実行"
                )}
              </button>
            </div>

            {scheduleStatus === "done" && (
              <p className="text-sm text-amber-600 font-medium">
                🎉 スケジュール表の算出に成功しました！
              </p>
            )}
            {analysisStatus === "done" &&
              scheduleStatus === "idle" && (
                <p className="text-sm text-green-600 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />{" "}
                  語意分析完了 — OR-Toolsで排班実行できます
                </p>
              )}
            {analysisStatus === "error" && (
              <ErrorMsg>AI分析エラー: {analysisError}</ErrorMsg>
            )}
            {scheduleStatus === "error" && (
              <ErrorMsg>
                OR-Toolsエラー: {scheduleError}
              </ErrorMsg>
            )}
          </div>

          {/* Right: AIによる要望の構造化 */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 lg:w-1/2 flex flex-col gap-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <span>📊</span> 2.
              AIによる要望の構造化（ソフトルール）
            </h2>

            {analysisStatus === "idle" && (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg py-16">
                「1.
                AIで語意分析・加点化」ボタンを押すと結果が表示されます
              </div>
            )}

            {analysisStatus === "loading" && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
                <Spinner color="#3b82f6" />
                <p className="text-sm text-gray-500">
                  AIが日本語を解析中...
                </p>
              </div>
            )}

            {(analysisStatus === "done" ||
              analysisStatus === "error") && (
              <div className="flex flex-col gap-3 overflow-y-auto max-h-[460px] pr-1">
                {/* ── Soft rules (green) ── */}
                {softRules &&
                  Object.keys(softRules).length > 0 && (
                    <div className="rounded-lg border border-green-300 bg-green-50 overflow-hidden">
                      <div className="bg-green-100 border-b border-green-300 px-3 py-2 flex items-center gap-2">
                        <span>✨</span>
                        <span className="text-sm font-semibold text-green-800">
                          抽出されたソフトルール（加点対象）
                        </span>
                      </div>
                      <div className="p-3 overflow-auto max-h-56">
                        <JsonBlock data={softRules} />
                      </div>
                    </div>
                  )}

                {/* ── Unrecognized / ignored (orange) ── */}
                {ignoredItems.length > 0 ? (
                  <div className="rounded-lg border border-orange-300 bg-orange-50 overflow-hidden">
                    <div className="bg-orange-100 border-b border-orange-300 px-3 py-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                      <span className="text-sm font-semibold text-orange-800">
                        システム未定義・無視されたテキスト（警告表示）
                      </span>
                    </div>
                    <div className="p-3 flex flex-col gap-3">
                      {ignoredItems.map((item, i) => (
                        <div
                          key={i}
                          className="text-xs leading-relaxed"
                        >
                          <p className="text-red-700 font-semibold">
                            🛑 弾かれた要望: 「{item.text}」
                          </p>
                          {item.reason && (
                            <p className="text-amber-700 mt-0.5 pl-1">
                              💡 理由: {item.reason}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : analysisStatus === "done" ? (
                  <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 font-semibold">
                    ✅
                    すべての要望が完璧に対応ルール化されました！
                  </div>
                ) : null}

                {/* ── history_info (gray) ── */}
                {savedHistoryInfo && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                    <div className="bg-gray-100 border-b border-gray-200 px-3 py-1.5 flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-gray-500" />
                      <span className="text-xs font-medium text-gray-600">
                        history_info（OR-Tools連携用）
                      </span>
                    </div>
                    <div className="p-3 overflow-auto max-h-24">
                      <JsonBlock data={savedHistoryInfo} />
                    </div>
                  </div>
                )}

                {analysisStatus === "error" && (
                  <ErrorMsg>
                    APIエラーが発生しました。設定を確認してください。
                  </ErrorMsg>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── Bottom: Schedule table ─── */}
        <div
          ref={scheduleRef}
          className="bg-white rounded-xl border border-gray-200 shadow-sm p-5"
        >
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <span>📅</span> 3.
              最終排班結果スケジュール表（OR-Tools 数学最優解）
            </h2>
            <span className="text-xs bg-blue-100 text-blue-700 font-medium px-3 py-1 rounded-full">
              表示中:{" "}
              {selectedHistoryId === "__latest__"
                ? latestScheduleData
                  ? "最新データ"
                  : "データなし"
                : (history.find(
                    (h) => h.id === selectedHistoryId,
                  )?.label ?? "—")}
            </span>
          </div>

          {scheduleStatus === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Spinner color="#22c55e" />
              <p className="text-sm text-gray-500">
                OR-Toolsが最適解を計算中...
              </p>
            </div>
          )}

          {scheduleStatus !== "loading" &&
            displayedScheduleData && (
              <ShiftScheduleTable
                data={displayedScheduleData}
              />
            )}

          {scheduleStatus !== "loading" &&
            !displayedScheduleData && (
              <div className="flex items-center justify-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg py-16">
                「2.
                OR-Toolsで排班実行」ボタンを押すとスケジュール表が表示されます
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-red-600 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{children}</span>
    </p>
  );
}