import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Bot, History, Loader2, Settings } from "lucide-react";
import {
  analyzeRequest,
  explainError,
  getCurrentRequestText,
  getHistoryList,
  getHistoryStrategy,
  getResult,
  getUpdated,
  solveSchedule,
  type AIEngine,
  type LLMModel,
} from "../../api";
import type { AnalysisItem, HistoryListItem, Strategy, UnsupportedRule, UpdatedData } from "../../types";

interface ShiftTextProps {
  onBack: () => void;
}

const DEFAULT_TEXT =
  "今日のOutput（出力）ラインは高負荷なので、最低でも2人は配置してほしいです。あと、坪井さんと岩下さんは同じ出力グループにペアで入れてあげてください。あ、そういえば長谷川さんが「来週」休みたいって言ってました。";

type StatusType = "idle" | "loading" | "success" | "error";
interface StatusState {
  type: StatusType;
  text: string;
}

type ExplainState =
  | { state: "none" }
  | { state: "hint" }
  | { state: "loading" }
  | { state: "done"; text: string }
  | { state: "failed"; text: string };

function formatNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatMetaTimestamp(ts?: string): string | null {
  if (!ts) return null;
  const m = String(ts).match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

export default function ShiftText({ onBack }: ShiftTextProps) {
  const [requestText, setRequestText] = useState(DEFAULT_TEXT);
  const [updateTime, setUpdateTime] = useState("--");
  const [saving, setSaving] = useState(false);

  const [status, setStatusState] = useState<StatusState>({ type: "idle", text: "" });
  const [explain, setExplain] = useState<ExplainState>({ state: "none" });

  const [resultsVisible, setResultsVisible] = useState(false);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisItem[]>([]);
  const [unsupported, setUnsupported] = useState<UnsupportedRule[]>([]);
  const [noRulesWarning, setNoRulesWarning] = useState(false);

  const [aiMode, setAiMode] = useState<AIEngine>("ollama");
  const [ollamaModel, setOllamaModel] = useState<LLMModel>("qwen2.5:7b");
  const [geminiKey, setGeminiKey] = useState("");
  const [autoSolve, setAutoSolve] = useState(true);

  const [historyList, setHistoryList] = useState<HistoryListItem[]>([]);
  const [selectedHistory, setSelectedHistory] = useState("");
  const [historyPreview, setHistoryPreview] = useState<string | null>(null);

  function setStatus(type: StatusType, text: string) {
    setStatusState({ type, text });
  }

  function applyAnalysisData(data: UpdatedData) {
    const s = data.strategy || null;
    setStrategy(s);
    setAnalysis(data.analysis || []);
    setUnsupported(data.unsupported_rules || []);
    const hard = s?.hard_rules || [];
    const soft = s?.soft_rules || [];
    setNoRulesWarning(hard.length === 0 && soft.length === 0);
    setResultsVisible(true);
  }

  async function refreshHistoryList() {
    try {
      const list = await getHistoryList();
      setHistoryList(list);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadHistoryPreview(filename: string) {
    setSelectedHistory(filename);
    if (!filename) {
      setHistoryPreview(null);
      return;
    }
    setHistoryPreview("読み込み中...");
    try {
      const data = await getHistoryStrategy(filename);
      if (data.status === "error") {
        setHistoryPreview(data.message || "読み込みに失敗しました。");
      } else {
        setHistoryPreview(JSON.stringify(data.strategy || data, null, 2));
      }
    } catch (e) {
      setHistoryPreview(`読み込みに失敗しました: ${(e as Error).message}`);
    }
  }

  async function showErrorWithExplanation(rawMessage: string) {
    setStatus("error", rawMessage);
    if (!geminiKey.trim()) {
      setExplain({ state: "hint" });
      return;
    }
    setExplain({ state: "loading" });
    try {
      const data = await explainError(rawMessage, geminiKey.trim());
      if (data.status === "success" && data.explanation) {
        setExplain({ state: "done", text: data.explanation });
      } else {
        setExplain({ state: "failed", text: data.message || "不明なエラー" });
      }
    } catch (e) {
      setExplain({ state: "failed", text: (e as Error).message });
    }
  }

  async function submitRequest() {
    const text = requestText.trim();
    if (!text) {
      alert("要望を入力してください。");
      return;
    }

    setSaving(true);
    setResultsVisible(false);
    setExplain({ state: "none" });

    try {
      setStatus("loading", "AIが要望を分析中...");

      const model = aiMode === "ollama" ? ollamaModel : "gemini-2.5-flash";
      const analyzeData = await analyzeRequest({ text, mode: aiMode, model, gemini_key: geminiKey });

      if (analyzeData.status !== "success") {
        await showErrorWithExplanation("分析に失敗しました: " + (analyzeData.message || "不明なエラー"));
        setSaving(false);
        return;
      }

      applyAnalysisData(analyzeData);

      if (!autoSolve) {
        setStatus("success", "✅ 要望の構造化が完了しました（OR-Tools排班は未実行です）。");
        setSaving(false);
        return;
      }

      setStatus("loading", "OR-Toolsで排班を最適化中...");
      const solveData = await solveSchedule(analyzeData.history_info);

      if (solveData.status === "success") {
        setStatus("success", "✅ 排班が最適化されました。シフト表画面に戻ると最新の結果を確認できます。");
        setUpdateTime(formatNow());
        refreshHistoryList();
      } else {
        await showErrorWithExplanation("排班計算に失敗しました: " + (solveData.message || "不明なエラー"));
      }
    } catch (e) {
      await showErrorWithExplanation("エラーが発生しました: " + (e as Error).message);
    }

    setSaving(false);
  }

  useEffect(() => {
    (async () => {
      try {
        const reqText = await getCurrentRequestText();
        if (typeof reqText === "string" && reqText.trim()) setRequestText(reqText);
      } catch (e) {
        console.error(e);
      }

      try {
        const updData = await getUpdated();
        if (updData && (updData.strategy || (updData.analysis && updData.analysis.length))) {
          applyAnalysisData(updData);
        }
      } catch (e) {
        console.error(e);
      }

      try {
        const resData = await getResult();
        const ts = resData.generated_at || resData.timestamp;
        const metaTs = formatMetaTimestamp(resData.meta?.timestamp);
        if (ts || metaTs) setUpdateTime(ts || metaTs || "--");
      } catch (e) {
        console.error(e);
      }

      refreshHistoryList();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusColors: Record<StatusType, string> = {
    idle: "hidden",
    loading: "flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-800",
    success: "flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-3.5 py-2.5 text-sm text-green-800",
    error: "flex flex-col rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800",
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white font-sans">
      {/* Sidebar */}
      <nav className="flex w-16 min-w-[64px] flex-col items-center bg-slate-800 py-3.5">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl">🐕</div>
        <div className="flex w-full flex-col items-center py-2.5 text-slate-500 hover:bg-slate-700 hover:text-slate-300">
          <span className="mb-1 text-lg">🎯</span>
          <span className="text-[9px] leading-tight">生産目標</span>
        </div>
        <div className="relative flex w-full flex-col items-center border-l-[3px] border-blue-500 bg-[#1a2d45] py-2.5 text-blue-500">
          <span className="mb-1 text-lg">📅</span>
          <span className="text-[9px] leading-tight">シフト表</span>
        </div>
        <div className="relative flex w-full flex-col items-center py-2.5 text-slate-500 hover:bg-slate-700 hover:text-slate-300">
          <span className="mb-1 text-lg">📋</span>
          <span className="text-[9px] leading-tight">勤怠申請</span>
          <span className="absolute right-[7px] top-[7px] flex h-[15px] w-[15px] items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            2
          </span>
        </div>
        <div className="flex w-full flex-col items-center py-2.5 text-slate-500 hover:bg-slate-700 hover:text-slate-300">
          <span className="mb-1 text-lg">⚙️</span>
          <span className="text-[9px] leading-tight">詳細設定</span>
        </div>
      </nav>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-[50px] flex-shrink-0 items-center gap-2.5 border-b border-slate-200 bg-white px-4 py-2.5">
          <button className="rounded-md border border-gray-300 p-1.5 text-gray-500 hover:bg-slate-100" onClick={onBack}>
            <ArrowLeft size={16} />
          </button>
          <span className="text-base font-bold text-slate-800">シフト表</span>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className="mb-4.5 flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
              &#128293; 1. 条件設定 &amp; 要望入力
            </h1>
            <div className="flex items-center gap-5">
              <button
                className="rounded-lg bg-blue-600 px-8 py-2.5 text-sm font-semibold tracking-wide text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                onClick={submitRequest}
                disabled={saving}
              >
                保存
              </button>
              <span className="whitespace-nowrap text-xs text-slate-400">更新時間: {updateTime}</span>
            </div>
          </div>

          <div className="mb-2 text-[13px] font-semibold text-gray-700">要望（自由入力）：</div>
          <textarea
            className="min-h-[130px] max-h-[260px] w-full resize-y rounded-lg border border-gray-300 px-3.5 py-3 text-sm leading-relaxed text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-[3px] focus:ring-blue-500/10"
            placeholder="現場の日本語要望、ライン配置の希望、特記事項などを自由に入力してください..."
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
          />

          {status.type !== "idle" && (
            <div className={`mt-2.5 ${statusColors[status.type]}`}>
              <div className="flex items-center gap-2">
                {status.type === "loading" && <Loader2 size={14} className="flex-shrink-0 animate-spin" />}
                <span>{status.text}</span>
              </div>
              {status.type === "error" && explain.state === "hint" && (
                <div className="mt-1.5 text-[11px] opacity-85">
                  (下の「分析モデル設定」でGemini API Keyを入力すると、AIがエラー原因を解説します)
                </div>
              )}
              {status.type === "error" && explain.state === "loading" && (
                <div className="mt-2 flex items-center gap-1.5 border-t border-black/10 pt-2 text-xs">
                  <Bot size={14} /> Geminiがエラー原因を解説中...
                </div>
              )}
              {status.type === "error" && explain.state === "done" && (
                <div className="mt-2 flex items-start gap-1.5 border-t border-black/10 pt-2 text-xs">
                  <Bot size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    <strong>Geminiによる解説:</strong> {explain.text}
                  </span>
                </div>
              )}
              {status.type === "error" && explain.state === "failed" && (
                <div className="mt-2 border-t border-black/10 pt-2 text-xs">
                  Geminiによるエラー解説の取得に失敗しました: {explain.text}
                </div>
              )}
            </div>
          )}

          {resultsVisible && (
            <div className="mt-6">
              {noRulesWarning && (
                <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-[13px] font-semibold text-amber-800">
                  <AlertTriangle size={18} className="flex-shrink-0" />
                  <span>
                    入力内容から有効なハード/ソフトルールが1つも抽出されませんでした。要望文をご確認ください（このまま班表計算に進むことは可能です）。
                  </span>
                </div>
              )}

              <div className="mb-4 overflow-hidden rounded-[10px] border border-green-300">
                <div className="bg-green-100 px-4 py-2.5 text-sm font-bold text-green-800">
                  &#10024; 2. AIによる要望の構造化（ハード/ソフトルール）
                </div>
                <div className="bg-green-50 px-4 py-3.5">
                  <div className="mb-2 text-xs font-semibold text-green-800">&#10024; 抽出されたルール（OR-Tools 適用対象）</div>
                  <pre className="overflow-x-auto rounded-md bg-emerald-100 p-3 text-xs leading-relaxed text-emerald-950">
                    {JSON.stringify(strategy, null, 2)}
                  </pre>
                </div>
              </div>

              {analysis.length > 0 && (
                <div className="mb-4 overflow-hidden rounded-[10px] border border-blue-300">
                  <div className="bg-blue-100 px-4 py-2.5 text-sm font-bold text-blue-800">
                    &#128269; AIの分類分析（各要望の分類理由）
                  </div>
                  <div className="bg-blue-50 px-4 py-3.5">
                    {analysis.map((item, i) => {
                      const isHard = item.type === "hard_rule" || item.category === "hard_rule";
                      const text = item.text || item.original_text || item.request || JSON.stringify(item);
                      const reason = item.reason || item.description || "";
                      return (
                        <div
                          key={i}
                          className={`mb-2 flex items-start gap-2.5 rounded-md border-l-4 bg-white px-2.5 py-2 text-[13px] ${
                            isHard ? "border-red-500" : "border-blue-500"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex-shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              isHard ? "bg-red-200 text-red-800" : "bg-blue-200 text-blue-900"
                            }`}
                          >
                            {isHard ? "hard_rule" : "soft_rule"}
                          </span>
                          <div>
                            <div className="font-semibold text-slate-800">{text}</div>
                            {reason && <div className="mt-0.5 text-xs text-gray-500">&#8594; {reason}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-[10px] border border-amber-300">
                <div className="bg-amber-100 px-4 py-2.5 text-sm font-bold text-amber-800">
                  &#9888; システム未対応・無視されたテキスト（警告表示）
                </div>
                <div className="bg-amber-50 px-4 py-3.5">
                  {unsupported.length > 0 ? (
                    unsupported.map((item, i) => {
                      const text = item.text || item.original_text || item.request || JSON.stringify(item);
                      const reason = item.reason || item.description || "";
                      return (
                        <div key={i} className="mb-2 flex items-start gap-2.5 rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-[13px]">
                          <span className="mt-0.5 flex-shrink-0 text-sm text-amber-600">&#9679;</span>
                          <div>
                            <div className="font-semibold text-slate-800">{text}</div>
                            {reason && <div className="mt-0.5 text-xs text-amber-800">&#128161; {reason}</div>}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[13px] italic text-slate-400">対応していない要望はありません。</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Model Settings (テスト用・暫定) */}
          <div className="mt-6 overflow-hidden rounded-[10px] border border-slate-300">
            <div className="flex items-center gap-2 bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700">
              <Settings size={15} /> 分析モデル設定（テスト用）
            </div>
            <div className="flex flex-col gap-3 bg-slate-50 px-4 py-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">使用するAIエンジン:</label>
                <select
                  className="w-[280px] rounded-md border border-gray-300 px-2 py-1.5 text-[13px]"
                  value={aiMode}
                  onChange={(e) => setAiMode(e.target.value as AIEngine)}
                >
                  <option value="ollama">ローカル LLM (Ollama / 無料)</option>
                  <option value="gemini">クラウド API (Google Gemini)</option>
                </select>
              </div>

              {aiMode === "ollama" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">ローカルモデル選択:</label>
                  <select
                    className="w-[280px] rounded-md border border-gray-300 px-2 py-1.5 text-[13px]"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value as LLMModel)}
                  >
                    <option value="qwen2.5:7b">Qwen 2.5 (7B)</option>
                    <option value="llama3.1:8b">Llama 3.1 (8B)</option>
                    <option value="gemma3:4b">Gemma 3 (4B)</option>
                    <option value="gemma3:12b">Gemma 3 (12B)</option>
                  </select>
                </div>
              )}

              {aiMode === "gemini" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">Gemini API Key:</label>
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    className="w-[280px] rounded-md border border-gray-300 px-2 py-1.5 text-[13px]"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                  />
                  <div className="mt-0.5 text-[10px] text-slate-400">&#8251; このKeyはエラー発生時の原因解説にも使用されます。</div>
                </div>
              )}

              {aiMode !== "gemini" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">Gemini API Key（エラー解説用）:</label>
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    className="w-[280px] rounded-md border border-gray-300 px-2 py-1.5 text-[13px]"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                  />
                </div>
              )}

              <div className="flex items-center gap-2 border-t border-dashed border-slate-300 pt-3">
                <input
                  type="checkbox"
                  id="auto-solve-toggle"
                  className="h-4 w-4 cursor-pointer"
                  checked={autoSolve}
                  onChange={(e) => setAutoSolve(e.target.checked)}
                />
                <label htmlFor="auto-solve-toggle" className="cursor-pointer text-xs font-semibold text-gray-700">
                  分析完了後、自動でOR-Tools排班を実行する
                </label>
              </div>
              <div className="-mt-2 text-[10px] text-slate-400">
                &#8251; OFFの場合は要望の構造化（ハード/ソフトルール抽出）のみ行い、班表計算は実行しません。
              </div>

              <div className="border-t border-dashed border-slate-300 pt-3">
                <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                  <History size={13} /> 過去の実行履歴（モデル別）:
                </label>
                <select
                  className="w-[280px] rounded-md border border-gray-300 px-2 py-1.5 text-[13px]"
                  value={selectedHistory}
                  onChange={(e) => loadHistoryPreview(e.target.value)}
                >
                  <option value="">-- 履歴を選択 --</option>
                  {historyList.map((item) => (
                    <option key={item.filename} value={item.filename}>
                      【{item.model}】 {item.display_time}
                    </option>
                  ))}
                </select>
                {historyPreview !== null && (
                  <div className="mt-2.5">
                    <div className="mb-1 text-[11px] text-gray-500">
                      選択した履歴の抽出ルール（参照専用・現在の要望には反映されません）
                    </div>
                    <pre className="max-h-[220px] overflow-auto rounded-md bg-slate-100 p-2.5 text-[11px] text-slate-700">
                      {historyPreview}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
