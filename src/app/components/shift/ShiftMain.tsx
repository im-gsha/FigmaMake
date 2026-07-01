import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Settings,
  Target,
} from "lucide-react";
import { getPositionGroups, getPositions, getResult } from "../../api";
import type { Position, PositionGroup, ScheduleResult, SummaryItem } from "../../types";

interface ShiftMainProps {
  onNavigateToText: () => void;
}

interface WorkerStyle {
  bg: string;
  bar: string;
}

const DISTINCT_COLORS: WorkerStyle[] = [
  { bg: "#FFCDD2", bar: "#E53935" },
  { bg: "#C8E6C9", bar: "#43A047" },
  { bg: "#BBDEFB", bar: "#1E88E5" },
  { bg: "#FFF9C4", bar: "#FBC02D" },
  { bg: "#E1BEE7", bar: "#8E24AA" },
  { bg: "#FFE0B2", bar: "#FB8C00" },
  { bg: "#B2EBF2", bar: "#00ACC1" },
  { bg: "#F8BBD0", bar: "#D81B60" },
  { bg: "#D7CCC8", bar: "#6D4C41" },
  { bg: "#CFD8DC", bar: "#546E7A" },
  { bg: "#DCEDC8", bar: "#7CB342" },
  { bg: "#FFECB3", bar: "#FFA000" },
  { bg: "#D1C4E9", bar: "#5E35B1" },
  { bg: "#B3E5FC", bar: "#039BE5" },
  { bg: "#F0F4C3", bar: "#AFB42B" },
  { bg: "#FFCCBC", bar: "#F4511E" },
  { bg: "#E0F2F1", bar: "#00897B" },
  { bg: "#E8EAF6", bar: "#3949AB" },
  { bg: "#FCE4EC", bar: "#C2185B" },
  { bg: "#EFEBE9", bar: "#4E342E" },
];

function formatDateTime(val?: string): string {
  if (!val) return "--";
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatMetaTimestamp(ts?: string): string | null {
  if (!ts) return null;
  const m = String(ts).match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function resultDate(result: ScheduleResult): string {
  if (result.generated_at) {
    const d = new Date(result.generated_at);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  const metaTs = result.meta?.timestamp;
  if (metaTs) {
    const m = String(metaTs).match(/^(\d{4})(\d{2})(\d{2})_/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (result.timestamp) {
    const d = new Date(result.timestamp);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return new Date().toISOString().split("T")[0];
}

export default function ShiftMain({ onNavigateToText }: ShiftMainProps) {
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [groups, setGroups] = useState<PositionGroup[]>([]);
  const [currentDateStr, setCurrentDateStr] = useState<string | null>(null);
  const [resultDateStr, setResultDateStr] = useState<string | null>(null);
  const [updateTime, setUpdateTime] = useState("--");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const dragSourceRef = useRef<{ timeId: number; index: number } | null>(null);
  const workerColorMapRef = useRef<Record<string, WorkerStyle>>({});
  const colorCounterRef = useRef(0);

  const getWorkerStyle = useCallback((name: string): WorkerStyle => {
    const map = workerColorMapRef.current;
    if (!map[name]) {
      map[name] = DISTINCT_COLORS[colorCounterRef.current % DISTINCT_COLORS.length];
      colorCounterRef.current += 1;
    }
    return map[name];
  }, []);

  const loadSchedule = useCallback(async (initial: boolean) => {
    try {
      const [res, pos, grp] = await Promise.all([getResult(), getPositions(), getPositionGroups()]);
      setResult(res);
      setPositions(pos);
      setGroups(grp);

      const rDate = resultDate(res);
      setResultDateStr(rDate);
      setCurrentDateStr((prev) => prev ?? rDate);

      const ts = res.generated_at || res.timestamp;
      const metaTs = formatMetaTimestamp(res.meta?.timestamp);
      setUpdateTime(ts ? formatDateTime(ts) : metaTs || formatDateTime(new Date().toISOString()));

      setLoadError(null);
      setLoading(false);
    } catch (e) {
      setLoadError(`データの読み込みに失敗しました: ${(e as Error).message}`);
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedule(true);
    const timer = setInterval(() => {
      if (!editModeRef.current) loadSchedule(false);
    }, 30000);
    return () => clearInterval(timer);
  }, [loadSchedule]);

  function changeDate(dir: number) {
    setCurrentDateStr((prev) => {
      if (!prev) return prev;
      const d = new Date(prev);
      d.setDate(d.getDate() + dir);
      return d.toISOString().split("T")[0];
    });
  }

  function handleDragStart(e: React.DragEvent, timeId: number, index: number) {
    if (!editMode) {
      e.preventDefault();
      return;
    }
    dragSourceRef.current = { timeId, index };
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", "");
    } catch {
      /* noop */
    }
  }

  function handleDragEnd() {
    dragSourceRef.current = null;
    setDragOverKey(null);
  }

  function handleDragOver(e: React.DragEvent, key: string) {
    if (!editMode || !dragSourceRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverKey !== key) setDragOverKey(key);
  }

  function handleDrop(e: React.DragEvent, targetTimeId: number, targetPosition: Position, targetGroupName: string) {
    e.preventDefault();
    setDragOverKey(null);
    const src = dragSourceRef.current;
    dragSourceRef.current = null;
    if (!editMode || !src) return;

    setResult((prev) => {
      if (!prev) return prev;
      const sourceSlot = prev.schedule.find((s) => s.time_id === src.timeId);
      if (!sourceSlot || !sourceSlot.assignments[src.index]) return prev;

      const [assignment] = sourceSlot.assignments.splice(src.index, 1);
      assignment.position_id = targetPosition.id;
      assignment.position_name = targetPosition.name;
      assignment.group_name = targetGroupName;

      let targetSlot = sourceSlot;
      if (sourceSlot.time_id !== targetTimeId) {
        const found = prev.schedule.find((s) => s.time_id === targetTimeId);
        if (!found) {
          sourceSlot.assignments.splice(src.index, 0, assignment);
          return prev;
        }
        targetSlot = found;
      }
      targetSlot.assignments.push(assignment);
      return { ...prev };
    });
  }

  const groupNames = [...new Set(positions.map((p) => p.group_name))];
  const groupStats: Record<string, { targets: number[]; achieved: number }> = {};
  (result?.summary || []).forEach((s: SummaryItem) => {
    const gid = String(s.group_id);
    if (!groupStats[gid]) groupStats[gid] = { targets: [], achieved: s.group_total_achieved || 0 };
    if (s.target_volume) groupStats[gid].targets.push(s.target_volume);
  });

  const showTable = !!result && currentDateStr === resultDateStr;
  const showEmptyState = !!result && currentDateStr !== resultDateStr;
  const schedule = result?.schedule || [];

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Sidebar */}
      <nav className="flex w-16 min-w-[64px] flex-col items-center border-r border-slate-200 bg-white py-3.5">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xl">
          🐕
        </div>
        <div className="flex w-full flex-col items-center gap-1 py-2.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 cursor-pointer">
          <Target size={18} />
          <span className="text-[9px] leading-tight">生産目標</span>
        </div>
        <div className="relative flex w-full flex-col items-center gap-1 border-l-[3px] border-blue-500 bg-blue-50 py-2.5 text-blue-600 cursor-pointer">
          <CalendarDays size={18} />
          <span className="text-[9px] leading-tight">シフト表</span>
        </div>
        <div className="relative flex w-full flex-col items-center gap-1 py-2.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 cursor-pointer">
          <ClipboardList size={18} />
          <span className="text-[9px] leading-tight">勤怠申請</span>
          <span className="absolute right-[7px] top-[7px] flex h-[15px] w-[15px] items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            2
          </span>
        </div>
        <div className="flex w-full flex-col items-center gap-1 py-2.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 cursor-pointer">
          <Settings size={18} />
          <span className="text-[9px] leading-tight">詳細設定</span>
        </div>
      </nav>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex min-h-[50px] flex-shrink-0 items-center gap-2.5 border-b border-slate-200 bg-white px-4 py-2.5">
          <button className="rounded-md border border-gray-300 p-1.5 text-gray-500 hover:bg-slate-100">
            <ArrowLeft size={16} />
          </button>
          <span className="text-base font-bold text-slate-800">シフト表</span>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-500">
              編集モード
              <span className="relative inline-block h-[18px] w-8">
                <input
                  type="checkbox"
                  className="peer h-0 w-0 opacity-0"
                  checked={editMode}
                  onChange={(e) => setEditMode(e.target.checked)}
                />
                <span className="absolute inset-0 cursor-pointer rounded-full bg-slate-300 transition-colors peer-checked:bg-blue-500 before:absolute before:left-[2px] before:top-[2px] before:h-[14px] before:w-[14px] before:rounded-full before:bg-white before:transition-transform peer-checked:before:translate-x-[14px]" />
              </span>
            </label>
            <button className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-slate-100">
              DTTS &#9662;
            </button>
            <button className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-slate-100">
              &#128100; 作業者割当表
            </button>
            <button
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              onClick={onNavigateToText}
            >
              要望入力
            </button>
          </div>
        </div>

        {/* Date Bar */}
        <div className="relative flex flex-shrink-0 items-center justify-center border-b border-slate-200 bg-white px-5 py-2.5 text-slate-800">
          <div className="flex items-center gap-3">
            <button className="p-0.5 text-gray-400 hover:text-slate-800" onClick={() => changeDate(-1)}>
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-2 rounded-md border border-gray-300 px-4.5 py-1 text-sm font-semibold tracking-wide">
              <CalendarDays size={15} /> <span>{currentDateStr || "読み込み中..."}</span>
            </div>
            <button className="p-0.5 text-gray-400 hover:text-slate-800" onClick={() => changeDate(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
          <span className="absolute right-5 text-xs text-slate-400">更新時間: {updateTime}</span>
        </div>

        {/* Scroll Area */}
        <div className="flex-1 overflow-auto bg-white p-5">
          {loading && <div className="p-16 text-center text-sm text-slate-400">スケジュールデータを読み込み中...</div>}
          {loadError && <div className="p-16 text-center text-sm text-slate-400">{loadError}</div>}
          {showEmptyState && (
            <div className="rounded-xl border border-slate-200 bg-white p-20 text-center text-sm text-slate-400">
              この日付のスケジュールデータはありません。
            </div>
          )}
          {showTable && (
            <div className="min-w-max overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-40 min-w-[90px] bg-slate-800 px-2 py-2.5 text-center text-xs font-semibold text-white">
                      グループ
                    </th>
                    <th className="sticky left-[90px] top-0 z-40 min-w-[140px] bg-slate-800 px-2 py-2.5 text-center text-xs font-semibold text-white">
                      設備
                    </th>
                    {schedule.map((slot) => (
                      <th
                        key={slot.time_id}
                        className="sticky top-0 z-30 min-w-[85px] whitespace-nowrap px-2 py-2.5 text-center text-xs font-semibold text-white"
                        style={{ background: parseInt(slot.time.split(":")[0], 10) < 6 ? "#000" : "#1e293b" }}
                      >
                        {slot.time}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupNames.map((groupName) => {
                    const groupPositions = positions.filter((p) => p.group_name === groupName);
                    const groupInfo = groups.find((g) => g.name === groupName);
                    const gid = groupInfo ? String(groupInfo.id) : null;
                    const stats = (gid && groupStats[gid]) || { targets: [], achieved: 0 };

                    return groupPositions.map((pos, idx) => (
                      <tr key={pos.id}>
                        {idx === 0 && (
                          <td
                            className="sticky left-0 z-20 border-r-2 border-slate-200 bg-[#1e2d3d] p-2.5 align-top font-bold text-white"
                            rowSpan={groupPositions.length}
                          >
                            <div className="mb-2 text-center text-[13px] font-bold">{groupName}</div>
                            <div className="rounded border border-white/15 p-1.5 text-[10px]">
                              {stats.targets.length > 0 ? (
                                stats.targets.map((v, i) => (
                                  <div key={i}>
                                    <div className="text-[10px] text-green-400">目標</div>
                                    <div className="text-[13px] font-black text-green-400">{v.toLocaleString()}</div>
                                  </div>
                                ))
                              ) : (
                                <div className="text-[9px] italic text-gray-500">目標なし</div>
                              )}
                              {stats.achieved > 0 && (
                                <div className="mt-2 border-t border-white/20 pt-1.5">
                                  <div className="text-[9px] text-green-300">予想生産数</div>
                                  <div className="text-sm font-black text-green-400">{stats.achieved.toLocaleString()}</div>
                                </div>
                              )}
                            </div>
                          </td>
                        )}

                        <td className="sticky left-[90px] z-20 min-w-[140px] border-b border-r-[3px] border-b-slate-100 border-r-slate-800 bg-white px-2.5 py-2 text-left align-top">
                          <div className="text-xs font-bold text-slate-800">{pos.name}</div>
                          {pos.speed != null && (
                            <div className="mt-0.5 text-[10px] text-slate-400">速度: {Number(pos.speed).toLocaleString()}</div>
                          )}
                        </td>

                        {schedule.map((slot) => {
                          const key = `${slot.time_id}-${pos.id}`;
                          const cellAssignments = slot.assignments
                            .map((a, index) => ({ a, index }))
                            .filter(({ a }) => a.position_name === pos.name);
                          return (
                            <td
                              key={key}
                              className={`min-w-[85px] border-b border-r border-slate-100 p-1 text-center align-top ${
                                dragOverKey === key ? "!bg-blue-100 outline outline-2 outline-dashed outline-blue-500 -outline-offset-2" : ""
                              }`}
                              onDragOver={(e) => handleDragOver(e, key)}
                              onDragLeave={() => setDragOverKey((prev) => (prev === key ? null : prev))}
                              onDrop={(e) => handleDrop(e, slot.time_id, pos, groupName)}
                            >
                              {cellAssignments.length > 0 ? (
                                cellAssignments.map(({ a, index }) => {
                                  const style = getWorkerStyle(a.worker_name);
                                  return (
                                    <div
                                      key={index}
                                      draggable={editMode}
                                      onDragStart={(e) => handleDragStart(e, slot.time_id, index)}
                                      onDragEnd={handleDragEnd}
                                      className={`my-0.5 flex flex-col items-center rounded-md border border-black/10 px-1 py-1.5 ${
                                        editMode ? "cursor-grab shadow-[0_0_0_1px_rgba(37,99,235,0.35)] active:cursor-grabbing" : ""
                                      }`}
                                      style={{ backgroundColor: style.bg, borderLeft: `5px solid ${style.bar}` }}
                                    >
                                      <span className="mb-0.5 text-xs font-extrabold text-black">{a.worker_name}</span>
                                      {a.rate != null && (
                                        <span className="rounded-full bg-white/50 px-1 text-[9px] text-gray-700">
                                          {Number(a.rate).toLocaleString()} /h
                                        </span>
                                      )}
                                    </div>
                                  );
                                })
                              ) : (
                                <span className="text-lg text-gray-300">&middot;</span>
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
          )}
        </div>
      </div>
    </div>
  );
}
