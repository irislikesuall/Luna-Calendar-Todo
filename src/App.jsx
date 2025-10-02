import React, { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { supabase } from './supabaseClient';
import './index.css'; // ensure Tailwind is loaded

export default function App() {
  const today = new Date();
  const [view, setView] = useState("Month");
  const [current, setCurrent] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [store, setStore] = useLocalTasks(); // local storage by default
  const [quickAdd, setQuickAdd] = useState("");
  const [multiAddOpen, setMultiAddOpen] = useState(false);
  const [multiDates, setMultiDates] = useState([]);
  const [user, setUser] = useState(null);

  const channelRef = useRef(null); // store realtime channel to unsubscribe
  const monthLabel = current.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  const weeks = useMemo(() => buildWeeks(current), [current]);

  // ----- AUTH: initial check + on change -----
  // 替换现有的 auth useEffect 为下面这段（整段替换）
useEffect(() => {
  (async () => {
    try {
      // 读取当前会话用户（首次载入）
      const { data } = await supabase.auth.getUser();
      const currentUser = data?.user ?? null;
      setUser(currentUser);

      // 如果已登录并且本地尚未迁移，则尝试迁移 localStorage -> Supabase
      if (currentUser) {
        const MIGRATED_FLAG = 'calendar_tasks_migrated_v1';
        if (!localStorage.getItem(MIGRATED_FLAG)) {
          const raw = localStorage.getItem('calendar_tasks_v1');
          if (raw) {
            try {
              const local = JSON.parse(raw);
              const rows = [];
              for (const [date, list] of Object.entries(local)) {
                for (const t of (list || [])) {
                  // 让数据库生成 id（不强行写入 id），把任务与当前 user 绑定
                  rows.push({
                    user_id: currentUser.id,
                    date: date,
                    text: t.text ?? '',
                    done: !!t.done,
                    // optional: preserve original createdAt if present
                    created_at: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString()
                  });
                }
              }

              if (rows.length > 0) {
                console.log('[MIGRATE] inserting rows count=', rows.length);
                const { error } = await supabase.from('tasks').insert(rows);
                if (error) {
                  console.error('[MIGRATE] insert error', error);
                  // 不要自动清除 localStorage，便于排错
                  alert('迁移失败（已记录控制台），稍后我帮你看错误详情。');
                } else {
                  console.log('[MIGRATE] success, clearing local copy');
                  // 标记为已迁移并移除本地备份（避免重复迁移）
                  localStorage.setItem(MIGRATED_FLAG, '1');
                  localStorage.removeItem('calendar_tasks_v1');
                  // 清空当前 UI 的 local store（会触发从云端重载）
                  setStore({});
                  // 触发页面重载以从云端拉取最新数据（更稳妥）
                  // 若你不喜欢重载，可以改成调用“按月拉取”函数
                  setTimeout(() => window.location.reload(), 250);
                }
              } else {
                // 本地无任务，仍标记已迁移以免重复检查
                localStorage.setItem(MIGRATED_FLAG, '1');
              }
            } catch (e) {
              console.error('[MIGRATE] parse/insert error', e);
            }
          } else {
            // 没有本地数据，也标记为已迁移
            localStorage.setItem(MIGRATED_FLAG, '1');
          }
        } // end if not migrated
      } // end if currentUser
    } catch (e) {
      console.warn('supabase getUser error', e);
    }
  })();

  // 订阅 auth 状态变化（登录/登出）
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    setUser(session?.user ?? null);
    // 当用户登出时，确保本地 UI 不显示过时 localStorage（可选）
    if (!session?.user) {
      // 不立刻删除本地任务（谨慎），仅清空 UI：
      setStore({});
    }
  });

  return () => {
    try { sub.subscription.unsubscribe(); } catch (e) {}
  };
}, []);
  function onCellClick(date, e) {
    const target = e.target;
    if (target.closest("button") || target.closest("input")) return;
    setSelectedDate(date);
    setTimeout(() => {
      const el = document.getElementById("quickAddInput");
      if (el) el.focus();
    }, 0);
  }

  // ----- core CRUD: if logged in use cloud, else local -----
  async function addTask(date, text) {
    const t = (text ?? "").trim();
    if (!t) return;
    const key = keyOf(date);

    if (user) {
      // insert into supabase and reload this month
      const payload = {
        user_id: user.id,
        date: key,
        text: t,
        done: false
      };
      const { error } = await supabase.from('tasks').insert(payload);
      if (error) {
        console.error('addTask supabase insert error', error);
        alert('添加失败，请稍后重试');
      } else {
        await loadMonthFromCloud(currentDateToKey(current));
      }
    } else {
      // local fallback
      const cur = store[key] ?? [];
      const next = { ...store, [key]: [...cur, { id: cryptoRandomId(), text: t, done: false, createdAt: Date.now(), updatedAt: Date.now() }] };
      setStore(next);
    }
  }

  async function toggleTask(dateKey, id) {
    if (user) {
      // find the task id in cloud (we assume id is uuid in cloud)
      const t = (store[dateKey] || []).find(x => x.id === id);
      if (!t) return;
      const { error } = await supabase.from('tasks').update({ done: !t.done }).eq('id', id);
      if (error) console.error('toggleTask error', error);
      else await loadMonthFromCloud(currentDateToKey(current));
    } else {
      const list = store[dateKey] ?? [];
      const next = list.map(t => (t.id === id ? { ...t, done: !t.done, updatedAt: Date.now() } : t));
      setStore({ ...store, [dateKey]: next });
    }
  }

  async function deleteTask(dateKey, id) {
    if (user) {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) console.error('deleteTask error', error);
      else await loadMonthFromCloud(currentDateToKey(current));
    } else {
      const list = store[dateKey] ?? [];
      const next = list.filter(t => t.id !== id);
      setStore({ ...store, [dateKey]: next });
    }
  }

  function handleQuickAdd() {
    const txt = quickAdd.trim();
    if (!txt) return;
    addTask(selectedDate, txt);
    setQuickAdd("");
  }

  function openMultiAdd(date) {
    setSelectedDate(date);
    setMultiDates([keyOf(date)]);
    setMultiAddOpen(true);
  }

  async function applyMultiAdd(text) {
    const t = text.trim();
    if (!t || multiDates.length === 0) return;
    if (user) {
      // insert many
      const inserts = multiDates.map(k => ({ user_id: user.id, date: k, text: t }));
      const { error } = await supabase.from('tasks').insert(inserts);
      if (error) console.error('applyMultiAdd insert error', error);
      else await loadMonthFromCloud(currentDateToKey(current));
    } else {
      const next = { ...store };
      multiDates.forEach(k => {
        const dList = next[k] ?? [];
        next[k] = [...dList, { id: cryptoRandomId(), text: t, done: false, createdAt: Date.now(), updatedAt: Date.now() }];
      });
      setStore(next);
    }
    setMultiAddOpen(false);
  }

  // ----- simple magic-link sender UI -----
  async function sendMagicLink(email) {
    if (!email) return;
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) {
      alert('发送失败：' + error.message);
      console.error(error);
    } else {
      alert('已发送魔法链接到该邮箱，打开邮件并点击链接完成登录。');
    }
  }

  // ----- migration & cloud loader & realtime ----- //
  async function migrateLocalToCloud(currentUser) {
    if (!currentUser || !currentUser.id) return;
    const raw = localStorage.getItem('calendar_tasks_v1');
    if (!raw) return;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { console.warn('parse local tasks failed', e); return; }
    const inserts = [];
    for (const dateKey of Object.keys(parsed)) {
      const list = parsed[dateKey] || [];
      for (const t of list) {
        // avoid duplicating by not checking here; simpler to insert and rely on uniqueness of id not enforced
        inserts.push({
          user_id: currentUser.id,
          date: dateKey,
          text: t.text ?? '',
          done: !!t.done,
          created_at: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString()
        });
      }
    }
    if (inserts.length === 0) {
      try { localStorage.removeItem('calendar_tasks_v1'); } catch {}
      return;
    }
    const { error } = await supabase.from('tasks').insert(inserts);
    if (error) {
      console.error('migrateLocalToCloud error', error);
      return;
    }
    try { localStorage.removeItem('calendar_tasks_v1'); } catch (e) {}
  }

  async function loadMonthFromCloud(ymKey) {
    if (!user) return;
    // ymKey here is Date object; we'll compute first/last based on current state
    const first = new Date(current.getFullYear(), current.getMonth(), 1);
    const last = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const from = first.toISOString().slice(0, 10);
    const to = last.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('tasks')
      .select('id,user_id,date,text,done,created_at,updated_at')
      .eq('user_id', user.id)
      .gte('date', from)
      .lte('date', to)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadMonthFromCloud error', error);
      return;
    }

    const next = {};
    (data || []).forEach(t => {
      const k = t.date;
      if (!next[k]) next[k] = [];
      next[k].push({
        id: t.id,
        text: t.text,
        done: t.done,
        createdAt: t.created_at,
        updatedAt: t.updated_at
      });
    });
    setStore(next);
  }

  function subscribeToRealtime(currentUser) {
    if (!currentUser) return;
    // unsubscribe previous
    if (channelRef.current) {
      try { channelRef.current.unsubscribe(); } catch (e) { /* ignore */ }
      channelRef.current = null;
    }

    const filter = `user_id=eq.${currentUser.id}`;
    const ch = supabase
      .channel('realtime:tasks:' + currentUser.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter }, async (payload) => {
        // payload: { eventType, new, old, ... }
        try {
          // Simplest: reload current month after any change
          await loadMonthFromCloud(currentDateToKey(current));
        } catch (e) {
          console.warn('realtime handler error', e);
        }
      })
      .subscribe();

    channelRef.current = ch;
  }

  // utility to convert Date to a key (not strictly needed)
  function currentDateToKey(d) { return d; }

  // ------------------ render UI ------------------
  return (
    <div className="min-h-screen w-full bg-[#FAFAF7] text-slate-900 flex flex-col">
      <header className="sticky top-0 z-10 bg-[#FAFAF7]/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-amber-200" aria-hidden />
            <span className="font-semibold">My Calendar</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => jumpMonth(-1)} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Prev Month"><ChevronLeft className="w-5 h-5"/></button>
              <div className="px-3 py-1 rounded-lg bg-white border text-sm select-none">{monthLabel}</div>
              <button onClick={() => jumpMonth(1)} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Next Month"><ChevronRight className="w-5 h-5"/></button>
            </div>

            <ViewSwitch value={view} onChange={setView} />

            {/* 用户区 */}
            <div className="flex items-center gap-2">
              {user ? (
                <>
                  <span className="text-sm text-slate-600">{user.email}</span>
                  <button
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm"
                    onClick={async () => {
                      try { await supabase.auth.signOut(); } catch (e) { console.warn(e); }
                      try { localStorage.removeItem('calendar_tasks_v1'); } catch {}
                      setStore({});
                    }}
                  >
                    Logout
                  </button>
                </>
              ) : (
                <button
                  className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm"
                  onClick={async () => {
                    const email = window.prompt('请输入你的邮箱（会发送魔法链接）:');
                    if (!email) return;
                    await sendMagicLink(email);
                  }}
                >
                  Login / Register
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {view === "Month" && (
        <main className="max-w-6xl mx-auto w-full px-4 py-4 flex-1">
          <div className="grid grid-cols-7 gap-2 text-center text-[12px] text-slate-500 select-none mb-2">
            {WEEK_LABELS.map(w => (<div key={w} className="py-1">{w}</div>))}
          </div>

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

          <section className="mt-8 rounded-2xl bg-white border border-slate-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">
                {selectedDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
              </div>
              <div className="text-xs text-slate-500">Completed {completedCount}/{selectedTasks.length}</div>
            </div>

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

      {view !== "Month" && (
        <main className="max-w-6xl mx-auto w-full px-4 py-8">
          <div className="rounded-xl border bg-white p-6 text-slate-600">
            {view} view is coming soon. Month view contains the full interaction as specified.
          </div>
        </main>
      )}

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

/* ---------- helper components & utils (unchanged) --------- */

function ViewSwitch({ value, onChange }) {
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

/* utils */
function keyOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const WEEK_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function buildWeeks(anchor) {
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
    const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    if (cur > endOfWeek(lastOfMonth)) break;
  }
  return weeks;
}
function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon = 0
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

/* local storage hook (synchronous init, respects migrated flag) */
function useLocalTasks() {
  const KEY = "calendar_tasks_v1";
  const MIGRATED_FLAG = "calendar_tasks_migrated_v1";

  // 初始化时，如果已迁移，则直接返回空对象（不去读旧 key）
  const [data, setData] = useState(() => {
    try {
      if (localStorage.getItem(MIGRATED_FLAG)) {
        // 已迁移 -> 不再使用本地备份
        return {};
      }
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('[useLocalTasks] read error', e);
      return {};
    }
  });

  // 写回时：仅当未迁移时才写（避免迁移后把空对象写回覆盖）
  useEffect(() => {
    try {
      if (localStorage.getItem(MIGRATED_FLAG)) {
        // 已迁移 -> 不再写本地 key
        return;
      }
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.error('[useLocalTasks] save error', e);
    }
  }, [data]);

  return [data, setData];
}

