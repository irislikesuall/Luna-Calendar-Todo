import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus, Check, X } from "lucide-react";

// 说明：这是一个纯前端 UI 原型，满足你最新的月视图需求：
// - 上下布局：顶部导航；中间为日历（Mon–Sun）；底部仅在月视图显示当日任务列表
// - 月格内直接显示任务（每条单行省略），可勾选完成；完成态半透明
// - 单格任务上限 15 条；周行会随内容自动增高
// - 单击格子空白可快速新增；点“+”可打开多日期添加对话框
// - 视图切换提供 Month/Week/Day（仅 Month 可用，其余灰置）
// - 数据持久化 localStorage（便于你手机/电脑本地看 UI 效果）
// 你可以在任何 React 项目中引入并渲染 <CalendarTodoUI />

export default function CalendarTodoUI() {
  const today = new Date();
  const [view, setView] = useState("Month"); // 先只实现 Month
  const [current, setCurrent] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [store, setStore] = useLocalTasks(); // { [yyyy-mm-dd]: Task[] }
  const [quickAdd, setQuickAdd] = useState("");
  const [multiAddOpen, setMultiAddOpen] = useState(false);
  const [multiDates, setMultiDates] = useState([]); // string[] yyyy-mm-dd

  const monthLabel = current.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  const weeks = useMemo(() => buildWeeks(current), [current]);

  const selectedKey = keyOf(selectedDate);
  const selectedTasks = store[selectedKey] ?? [];
  const completedCount = selectedTasks.filter(t => t.done).length;

  function jumpMonth(delta) {
    setCurrent(c => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  function onCellClick(date, e) {
    // 若点击到按钮或 checkbox，忽略
    const target = e.target;
    if (target.closest("button") || target.closest("input")) return;
    setSelectedDate(date);
    // 聚焦底部快速添加输入框
    setTimeout(() => {
      const el = document.getElementById("quickAddInput");
      if (el) el.focus();
    }, 0);
  }

  function addTask(date, text) {
    const t = text.trim();
    if (!t) return;
    const key = keyOf(date);
    const cur = store[key] ?? [];
    const next = { ...store, [key]: [...cur, { id: cryptoRandomId(), text: t, done: false, createdAt: Date.now(), updatedAt: Date.now() }] };
    setStore(next);
  }

  function toggleTask(dateKey, id) {
    const list = store[dateKey] ?? [];
    const next = list.map(t => (t.id === id ? { ...t, done: !t.done, updatedAt: Date.now() } : t));
    setStore({ ...store, [dateKey]: next });
  }

  function deleteTask(dateKey, id) {
    const list = store[dateKey] ?? [];
    const next = list.filter(t => t.id !== id);
    setStore({ ...store, [dateKey]: next });
  }

  function handleQuickAdd() {
    const txt = quickAdd.trim();
    if (!txt) return;
    addTask(selectedDate, txt);
    setQuickAdd("");
  }

  function openMultiAdd(date) {
    setSelectedDate(date);
    const allKeys = keysOfMonth(current);
    setMultiDates([keyOf(date)]); // 默认选中当前格
    setMultiAddOpen(true);
  }

  function applyMultiAdd(text) {
    const t = text.trim();
    if (!t || multiDates.length === 0) return;
    const next = { ...store };
    multiDates.forEach(k => {
      const dList = next[k] ?? [];
      next[k] = [...dList, { id: cryptoRandomId(), text: t, done: false, createdAt: Date.now(), updatedAt: Date.now() }];
    });
    setStore(next);
    setMultiAddOpen(false);
  }

  return (
    <div className="min-h-screen w-full bg-[#FAFAF7] text-slate-900 flex flex-col">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 bg-[#FAFAF7]/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-amber-200" aria-hidden />
            <span className="font-semibold">My Calendar</span>
          </div>

          <div className="flex items-center gap-3">
            {/* 月份切换 */}
            <div className="flex items-center gap-2">
              <button onClick={() => jumpMonth(-1)} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Prev Month"><ChevronLeft className="w-5 h-5"/></button>
              <div className="px-3 py-1 rounded-lg bg-white border text-sm select-none">{monthLabel}</div>
              <button onClick={() => jumpMonth(1)} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Next Month"><ChevronRight className="w-5 h-5"/></button>
            </div>

            {/* 视图切换 */}
            <ViewSwitch value={view} onChange={setView} />

            {/* 用户区（示例）*/}
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-sm text-slate-600">Guest</span>
              <button className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm">Login / Register</button>
            </div>
          </div>
        </div>
      </header>

      {/* 主体：月视图 */}
      {view === "Month" && (
        <main className="max-w-6xl mx-auto w-full px-4 py-4 flex-1">
          {/* 星期头 Mon–Sun */}
          <div className="grid grid-cols-7 gap-2 text-center text-[12px] text-slate-500 select-none mb-2">
            {WEEK_LABELS.map(w => (<div key={w} className="py-1">{w}</div>))}
          </div>

          {/* 月栅格：按周渲染，每周是一行 grid，能随最高格自动增高 */}
          <div className="flex flex-col gap-2">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-2">
                {week.map((d, di) => {
                  const k = keyOf(d.date);
                  const inMonth = d.date.getMonth() === current.getMonth();
                  const isToday = sameDate(d.date, new Date());
                  const list = (store[k] ?? []);
                  const cap = 15;
                  const shown = list.slice(0, cap);
                  const reachedCap = list.length >= cap;

                  return (
                    <div
                      key={di}
                      onClick={(e) => onCellClick(d.date, e)}
                      className={[
                        "relative rounded-xl bg-white border border-slate-200 p-2 min-h-[90px] cursor-pointer",
                        inMonth ? "" : "opacity-40",
                        sameDate(d.date, selectedDate) ? "ring-2 ring-amber-300" : "hover:bg-amber-50/40"
                      ].join(" ")}
                    >
                      {/* 顶部日期号 & + 按钮 */}
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={"text-sm font-medium " + (isToday ? "bg-amber-200 px-1.5 rounded" : "")}>{d.date.getDate()}</span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); openMultiAdd(d.date); }}
                          className="p-1 rounded hover:bg-slate-100"
                          aria-label="Add task"
                        >
                          <Plus className="w-4 h-4"/>
                        </button>
                      </div>

                      {/* 任务列表（单行省略，完成态半透明） */}
                      <div className="space-y-1">
                        {shown.map(t => (
                          <div key={t.id} className="flex items-start gap-1">
                            <input
                              type="checkbox"
                              checked={t.done}
                              onChange={() => toggleTask(k, t.id)}
                              className="mt-0.5 w-4 h-4 cursor-pointer"
                              onClick={(e)=>e.stopPropagation()}
                            />
                            <div className={["text-[12px] leading-5 truncate w-full", t.done ? "opacity-50" : ""].join(" ")}
                                 title={t.text}
                            >{t.text}</div>
                          </div>
                        ))}
                        {reachedCap && (
                          <div className="text-[11px] text-slate-500">15/15 • Reached limit</div>
                        )}
                        {list.length === 0 && (
                          <div className="text-[12px] text-slate-400 select-none">Click to add…</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* 底部当日任务列表（仅月视图显示） */}
          <section className="mt-4 rounded-2xl bg-white border border-slate-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">
                {selectedDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
              </div>
              <div className="text-xs text-slate-500">Completed {completedCount}/{selectedTasks.length}</div>
            </div>

            {/* 快速新增 */}
            <div className="flex gap-2">
              <input
                id="quickAddInput"
                value={quickAdd}
                onChange={e => setQuickAdd(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleQuickAdd()}
                placeholder="Add a task and press Enter"
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              <button onClick={handleQuickAdd} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm">Add</button>
            </div>

            {/* 当日任务全量列表 */}
            <div className="mt-3 space-y-2">
              {selectedTasks.length === 0 && (
                <div className="text-sm text-slate-500">No tasks yet.</div>
              )}
              {selectedTasks.map(t => (
                <div key={t.id} className="flex items-start gap-2 group">
                  <input type="checkbox" checked={t.done} onChange={() => toggleTask(selectedKey, t.id)} className="mt-0.5 w-4 h-4"/>
                  <div className={["flex-1 text-sm", t.done ? "opacity-50" : ""].join(" ")}>{t.text}</div>
                  <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100" onClick={() => deleteTask(selectedKey, t.id)} aria-label="Delete"><X className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </section>
        </main>
      )}

      {/* Week / Day 视图占位（不显示底部区）*/}
      {view !== "Month" && (
        <main className="max-w-6xl mx-auto w-full px-4 py-8">
          <div className="rounded-xl border bg-white p-6 text-slate-600">
            {view} view is coming soon. Month view contains the full interaction as specified.
          </div>
        </main>
      )}

      {/* 多日期添加弹窗 */}
      <AnimatePresence>
        {multiAddOpen && (
          <motion.div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
            <motion.div className="w-full max-w-lg bg-white rounded-2xl p-4" initial={{scale:0.96, opacity:0}} animate={{scale:1, opacity:1}} exit={{scale:0.96, opacity:0}}>
              <div className="font-medium mb-2">Add task to multiple dates</div>
              <MultiDatePicker current={current} selected={multiDates} onChange={setMultiDates} />
              <MultiAddForm onConfirm={applyMultiAdd} onCancel={() => setMultiAddOpen(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ViewSwitch({ value, onChange }) {
  const disabled = (v) => v !== "Month";
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-3 py-1.5 rounded-lg bg-white border text-sm"
      >
        <option value="Month">Month</option>
        <option value="Week" disabled>Week (soon)</option>
        <option value="Day" disabled>Day (soon)</option>
      </select>
    </div>
  );
}

function MultiAddForm({ onConfirm, onCancel }) {
  const [text, setText] = useState("");
  return (
    <div className="mt-3">
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onConfirm(text)}
        placeholder="Task text"
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg border">Cancel</button>
        <button onClick={() => onConfirm(text)} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white">Add</button>
      </div>
    </div>
  );
}

function MultiDatePicker({ current, selected, onChange }) {
  const weeks = useMemo(() => buildWeeks(current), [current]);
  function toggle(k) {
    if (selected.includes(k)) onChange(selected.filter(x => x !== k));
    else onChange([...selected, k]);
  }
  return (
    <div>
      <div className="grid grid-cols-7 gap-2 text-center text-[12px] text-slate-500 select-none mb-2">
        {WEEK_LABELS.map(w => (<div key={w} className="py-1">{w}</div>))}
      </div>
      <div className="flex flex-col gap-2">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-2">
            {week.map((d, di) => {
              const k = keyOf(d.date);
              const inMonth = d.date.getMonth() === current.getMonth();
              return (
                <button key={di} onClick={() => inMonth && toggle(k)} className={["rounded-lg border p-2 text-sm text-left", inMonth ? "bg-white hover:bg-slate-50" : "opacity-30", selected.includes(k) ? "ring-2 ring-amber-300" : ""].join(" ")}> 
                  {d.date.getDate()}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// —— 工具 & 数据 —— //
function keyOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const WEEK_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function buildWeeks(anchor) {
  // 月第一天（周一开始的周视角）
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const weeks = [];
  let cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      row.push({ date: new Date(cur) });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(row);
    // 如果这一周结束后已经越过当月且本周包含当月最后一天，则可提前结束
    const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    if (cur > endOfWeek(lastOfMonth)) break;
  }
  return weeks;
}

function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // 转为周一=0
  date.setDate(date.getDate() - day);
  date.setHours(0,0,0,0);
  return date;
}
function endOfWeek(d) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23,59,59,999);
  return e;
}
function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function keysOfMonth(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const arr = [];
  const d = new Date(first);
  while (d <= last) { arr.push(keyOf(d)); d.setDate(d.getDate() + 1); }
  return arr;
}
function cryptoRandomId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// 把原来的 useLocalTasks 整块替换为下面这个实现
function useLocalTasks() {
  const KEY = "calendar_tasks_v1";

  // 1) 同步地从 localStorage 初始化 state（避免 effect 顺序覆盖）
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('[useLocalTasks] read error', e);
      return {};
    }
  });

  // 2) 只在 data 实际变化时写回 localStorage（React 会在状态改变后自动触发）
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      // 可选：在控制台看到写入日志，便于调试
      console.log('[useLocalTasks] saved', data);
    } catch (e) {
      console.error('[useLocalTasks] save error', e);
    }
  }, [data]);

  return [data, setData];
}

