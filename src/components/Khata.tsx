import { useState, useEffect, useMemo } from "react";
import {
  Plus, X, Trash2, PiggyBank, ArrowDownLeft, ArrowUpRight,
  Wand2, Check, Search, Lock, LockOpen, Pencil, RotateCcw,
  ArrowLeftRight, Download, RefreshCw, Upload, Eye, EyeOff,
} from "lucide-react";

const PALETTE = ["#b8893d", "#2f6b46", "#3f6f8f", "#9a5b3f", "#6f5a8f", "#a8442f"];

interface Account {
  id: string; name: string; emoji: string; color: string;
  monthlyLimit?: number;
  savingsGoal?: number;
  goalDate?: string;
}

interface Allocation { accountId: string; amount: number; }

interface IncomeTxn   { id: string; type: "income";   note: string; date: string; allocations: Allocation[]; }
interface ExpenseTxn  { id: string; type: "expense";  note: string; date: string; accountId: string; amount: number; }
interface TransferTxn { id: string; type: "transfer"; note: string; date: string; fromAccountId: string; toAccountId: string; amount: number; }

type Txn = IncomeTxn | ExpenseTxn | TransferTxn;

const DEFAULT_ACCOUNTS: Account[] = [
  { id: "acc_savings",  name: "Savings",  emoji: "🐷", color: "#b8893d" },
  { id: "acc_spending", name: "Spending", emoji: "🛍️", color: "#2f6b46" },
];

const fmt = (n: number | undefined) =>
  "Rs " + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

const today      = () => new Date().toISOString().slice(0, 10);
const uid        = () => Math.random().toString(36).slice(2, 10);
const prettyDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const store = {
  get<T>(key: string, fallback: T): T {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
  },
  set(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /**/ } },
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function triggerDownload(filename: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

type ModalType = "income" | "expense" | "transfer" | "account" | "reset" | "export" | "unlock" | "change-password" | null;
type DatePreset = "all" | "today" | "week" | "month" | "3months";

export default function Khata() {
  const [accounts, setAccounts]         = useState<Account[]>(DEFAULT_ACCOUNTS);
  const [txns, setTxns]                 = useState<Txn[]>([]);
  const [loaded, setLoaded]             = useState(false);
  const [modal, setModal]               = useState<ModalType>(null);
  const [search, setSearch]             = useState("");
  const [datePreset, setDatePreset]     = useState<DatePreset>("all");
  const [bucketFilter, setBucketFilter] = useState<string | null>(null);
  const [pwHash, setPwHash]             = useState<string | null>(null);
  const [unlocked, setUnlocked]         = useState(false);
  const [editTxn, setEditTxn]           = useState<Txn | null>(null);
  const [repeatTxn, setRepeatTxn]       = useState<Txn | null>(null);
  const [editAccount, setEditAccount]   = useState<Account | null>(null);

  /* ── load ── */
  useEffect(() => {
    setAccounts(store.get("khata:accounts", DEFAULT_ACCOUNTS));
    setTxns(store.get("khata:txns", []));
    setPwHash(store.get("khata:pwHash", null));
    setLoaded(true);
  }, []);

  /* ── auto-lock on tab hide ── */
  useEffect(() => {
    const handle = () => { if (document.visibilityState === "hidden") setUnlocked(false); };
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, []);

  /* ── persist ── */
  useEffect(() => { if (loaded) store.set("khata:accounts", accounts); }, [accounts, loaded]);
  useEffect(() => { if (loaded) store.set("khata:txns",     txns);     }, [txns,     loaded]);
  useEffect(() => { if (loaded) store.set("khata:pwHash",   pwHash);   }, [pwHash,   loaded]);

  /* ── balances ── */
  const balances = useMemo(() => {
    const m = Object.fromEntries(accounts.map((a) => [a.id, 0]));
    for (const t of txns) {
      if (t.type === "income")   { for (const al of t.allocations) if (al.accountId in m) m[al.accountId] += al.amount; }
      else if (t.type === "expense")  { if (t.accountId    in m) m[t.accountId]    -= t.amount; }
      else                            { if (t.fromAccountId in m) m[t.fromAccountId] -= t.amount;
                                        if (t.toAccountId   in m) m[t.toAccountId]   += t.amount; }
    }
    return m;
  }, [accounts, txns]);

  const total = useMemo(() => Object.values(balances).reduce((s, v) => s + v, 0), [balances]);

  /* ── month stats ── */
  const monthStats = useMemo(() => {
    const ym = today().slice(0, 7);
    let inc = 0, exp = 0;
    for (const t of txns) {
      if (!t.date.startsWith(ym)) continue;
      if (t.type === "income")        inc += t.allocations.reduce((s, a) => s + a.amount, 0);
      else if (t.type === "expense")  exp += t.amount;
    }
    return { inc, exp };
  }, [txns]);

  /* ── monthly spend (for limit bar) ── */
  const monthlySpend = useMemo(() => {
    const ym = today().slice(0, 7);
    const m  = Object.fromEntries(accounts.map((a) => [a.id, 0]));
    for (const t of txns)
      if (t.type === "expense" && t.date.startsWith(ym) && t.accountId in m)
        m[t.accountId] += t.amount;
    return m;
  }, [accounts, txns]);

  /* ── 6-month trend ── */
  const monthlyTrend = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d   = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const ym  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const lbl = d.toLocaleDateString("en-IN", { month: "short" });
      const isCurrent = ym === today().slice(0, 7);
      let inc = 0, exp = 0;
      for (const t of txns) {
        if (!t.date.startsWith(ym)) continue;
        if (t.type === "income")        inc += t.allocations.reduce((s, a) => s + a.amount, 0);
        else if (t.type === "expense")  exp += t.amount;
      }
      return { ym, lbl, inc, exp, isCurrent };
    });
  }, [txns]);

  const trendMax = useMemo(
    () => Math.max(1, ...monthlyTrend.flatMap((m) => [m.inc, m.exp])),
    [monthlyTrend]
  );

  /* ── running balances ── */
  const runningBalances = useMemo(() => {
    const bf = bucketFilter;
    // chronological order: sort by date; same-date keeps insertion order (index desc = older)
    const sorted = [...txns].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : txns.indexOf(b) - txns.indexOf(a)
    );
    const map: Record<string, number> = {};
    let running = 0;
    for (const t of sorted) {
      if (bf) {
        if      (t.type === "income")                                  { const al = t.allocations.find(a => a.accountId === bf); if (al) running += al.amount; }
        else if (t.type === "expense"  && t.accountId    === bf)       running -= t.amount;
        else if (t.type === "transfer" && t.fromAccountId === bf)      running -= t.amount;
        else if (t.type === "transfer" && t.toAccountId   === bf)      running += t.amount;
      } else {
        if      (t.type === "income")  running += t.allocations.reduce((s, a) => s + a.amount, 0);
        else if (t.type === "expense") running -= t.amount;
        // transfers net to zero for total
      }
      map[t.id] = running;
    }
    return map;
  }, [txns, bucketFilter]);

  /* ── filtered txns ── */
  const filteredTxns = useMemo(() => {
    const q     = search.trim().toLowerCase();
    const nowMs = new Date().getTime();
    const td    = today();
    return txns.filter((t) => {
      // bucket filter
      if (bucketFilter) {
        const bf = bucketFilter;
        if (t.type === "income"   && !t.allocations.some(a => a.accountId === bf)) return false;
        if (t.type === "expense"  && t.accountId    !== bf)                         return false;
        if (t.type === "transfer" && t.fromAccountId !== bf && t.toAccountId !== bf) return false;
      }
      // text search
      if (q && !t.note.toLowerCase().includes(q) && !prettyDate(t.date).toLowerCase().includes(q) && !t.date.includes(q)) return false;
      // date preset
      if (datePreset === "today")   return t.date === td;
      if (datePreset === "week")    return (nowMs - new Date(t.date + "T00:00:00").getTime()) / 86400000 <= 7;
      if (datePreset === "month")   return t.date.startsWith(td.slice(0, 7));
      if (datePreset === "3months") return (nowMs - new Date(t.date + "T00:00:00").getTime()) / 86400000 <= 92;
      return true;
    });
  }, [txns, search, datePreset, bucketFilter]);

  const isFiltered = search.trim() !== "" || datePreset !== "all" || bucketFilter !== null;

  const accountUsed = (id: string) =>
    txns.some((t) =>
      t.type === "income"   ? t.allocations.some((a) => a.accountId === id)
      : t.type === "expense" ? t.accountId === id
      : t.fromAccountId === id || t.toAccountId === id
    );

  /* ── handlers ── */
  const addIncome   = (note: string, date: string, allocations: Allocation[]) =>
    { setTxns((p) => [{ id: uid(), type: "income",   note, date, allocations }, ...p]); setModal(null); setRepeatTxn(null); };
  const addExpense  = (note: string, date: string, accountId: string, amount: number) =>
    { setTxns((p) => [{ id: uid(), type: "expense",  note, date, accountId, amount }, ...p]); setModal(null); setRepeatTxn(null); };
  const addTransfer = (note: string, date: string, fromAccountId: string, toAccountId: string, amount: number) =>
    { setTxns((p) => [{ id: uid(), type: "transfer", note, date, fromAccountId, toAccountId, amount }, ...p]); setModal(null); setRepeatTxn(null); };
  const addAccount  = (name: string, emoji: string, color: string, monthlyLimit?: number, savingsGoal?: number, goalDate?: string) =>
    { setAccounts((p) => [...p, { id: uid(), name, emoji, color, monthlyLimit, savingsGoal, goalDate }]); setModal(null); };
  const updateAccount = (updated: Account) =>
    { setAccounts((p) => p.map((a) => (a.id === updated.id ? updated : a))); setEditAccount(null); };
  const removeAccount = (id: string) => setAccounts((p) => p.filter((a) => a.id !== id));
  const removeTxn     = (id: string) => setTxns((p) => p.filter((t) => t.id !== id));
  const updateTxn     = (updated: Txn) => { setTxns((p) => p.map((t) => (t.id === updated.id ? updated : t))); setEditTxn(null); };
  const resetAll      = () => { setAccounts(DEFAULT_ACCOUNTS); setTxns([]); setPwHash(null); setUnlocked(false); setModal(null); };

  const toggleBucketFilter = (id: string) => setBucketFilter((prev) => (prev === id ? null : id));

  /* ── export / import ── */
  const accById = Object.fromEntries(accounts.map((a) => [a.id, a]));

  const exportCSV = () => {
    const rows = [["Date", "Type", "Note", "Amount", "Account"]];
    for (const t of txns) {
      if (t.type === "income") {
        for (const al of t.allocations) { const a = accById[al.accountId]; rows.push([prettyDate(t.date), "Income", t.note, String(al.amount), a ? `${a.emoji} ${a.name}` : al.accountId]); }
      } else if (t.type === "expense") {
        const a = accById[t.accountId]; rows.push([prettyDate(t.date), "Expense", t.note, String(t.amount), a ? `${a.emoji} ${a.name}` : t.accountId]);
      } else {
        const fr = accById[t.fromAccountId], to = accById[t.toAccountId];
        rows.push([prettyDate(t.date), "Transfer", t.note, String(t.amount), `${fr ? `${fr.emoji} ${fr.name}` : t.fromAccountId} → ${to ? `${to.emoji} ${to.name}` : t.toAccountId}`]);
      }
    }
    triggerDownload(`khata-${today()}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
  };
  const exportJSON = () => triggerDownload(`khata-backup-${today()}.json`, JSON.stringify({ version: 1, exportedAt: today(), accounts, txns }, null, 2), "application/json");
  const importJSON = (file: File) => {
    const r = new FileReader();
    r.onload = (e) => { try { const d = JSON.parse(e.target?.result as string); if (Array.isArray(d.accounts) && Array.isArray(d.txns)) { setAccounts(d.accounts); setTxns(d.txns); setModal(null); } } catch { /**/ } };
    r.readAsText(file);
  };

  /* ── helpers ── */
  const daysLeft = (goalDate: string) => Math.ceil((new Date(goalDate + "T00:00:00").getTime() - Date.now()) / 86400000);

  return (
    <div className="khata">
      <style>{CSS}</style>
      <div className="sheet">

        {/* masthead */}
        <header className="masthead">
          <div>
            <h1><span className="latin">Khata</span></h1>
            <p className="tag">Your money, sorted into buckets.</p>
          </div>
          <div className="masthead-end">
            {unlocked && <button className="ghost-btn" onClick={() => setModal("export")}><Download size={15} /> Export</button>}
            {unlocked && <button className="ghost-btn" onClick={() => setModal("reset")}><RotateCcw size={15} /> Reset</button>}
            {unlocked && <button className="ghost-btn change-pwd-btn" onClick={() => setModal("change-password")}>Change password</button>}
            <button className={`ghost-btn lock-btn ${unlocked ? "is-unlocked" : ""}`}
              onClick={() => unlocked ? setUnlocked(false) : setModal("unlock")}>
              {unlocked ? <LockOpen size={15} /> : <Lock size={15} />}
              {unlocked ? "Lock" : "Unlock"}
            </button>
          </div>
        </header>

        {/* hero */}
        <section className="hero">
          <span className="hero-label">Total balance</span>
          <div className="hero-amount">{fmt(total)}</div>
          <div className="hero-stats">
            <span className="stat in"><ArrowDownLeft size={14} /> {fmt(monthStats.inc)} in</span>
            <span className="dot" />
            <span className="stat out"><ArrowUpRight size={14} /> {fmt(monthStats.exp)} out</span>
            <span className="stat-note">this month</span>
          </div>
        </section>

        {/* 6-month trend */}
        {txns.length > 0 && (
          <section className="trend">
            <span className="trend-title">6-month trend</span>
            <div className="trend-chart">
              {monthlyTrend.map((m) => (
                <div className="trend-col" key={m.ym}>
                  <div className="trend-bars">
                    <div className="trend-bar inc" style={{ height: `${Math.max(2, (m.inc / trendMax) * 60)}px` }} title={`Income: ${fmt(m.inc)}`} />
                    <div className="trend-bar exp" style={{ height: `${Math.max(2, (m.exp / trendMax) * 60)}px` }} title={`Expense: ${fmt(m.exp)}`} />
                  </div>
                  <span className={`trend-lbl ${m.isCurrent ? "now" : ""}`}>{m.lbl}</span>
                </div>
              ))}
            </div>
            <div className="trend-legend">
              <span className="tleg inc" /> Income
              <span className="tleg exp" /> Expense
            </div>
          </section>
        )}

        {/* buckets */}
        <section className="buckets">
          {accounts.map((a) => {
            const spend    = monthlySpend[a.id] || 0;
            const bal      = balances[a.id] || 0;
            const limitPct = a.monthlyLimit ? Math.min((spend / a.monthlyLimit) * 100, 100) : 0;
            const limitOver = !!a.monthlyLimit && spend > a.monthlyLimit;
            const limitWarn = !limitOver && !!a.monthlyLimit && limitPct >= 80;
            const goalPct  = a.savingsGoal  ? Math.min((bal  / a.savingsGoal)  * 100, 100) : 0;
            const goalDone = !!a.savingsGoal && bal >= a.savingsGoal;
            const dl       = a.goalDate ? daysLeft(a.goalDate) : null;
            const isActive = bucketFilter === a.id;
            return (
              <div className={`bucket ${isActive ? "active" : ""}`} key={a.id}
                style={{ "--c": a.color } as React.CSSProperties}
                onClick={() => toggleBucketFilter(a.id)}>
                <button className="bucket-x" title={accountUsed(a.id) ? "Has transactions — can't delete" : "Delete bucket"}
                  disabled={accountUsed(a.id) || accounts.length <= 1}
                  onClick={(e) => { e.stopPropagation(); removeAccount(a.id); }}>
                  <X size={13} />
                </button>
                {unlocked && (
                  <button className="bucket-edit" title="Edit bucket"
                    onClick={(e) => { e.stopPropagation(); setEditAccount(a); }}>
                    <Pencil size={11} />
                  </button>
                )}
                <span className="bucket-emoji">{a.emoji}</span>
                <span className="bucket-name">{a.name}</span>
                <span className="bucket-bal" style={{ color: bal < 0 ? "var(--red)" : undefined }}>{fmt(bal)}</span>
                {a.monthlyLimit && (
                  <div className="bucket-bar-wrap">
                    <div className="b-track"><div className="b-fill" style={{ width: `${limitPct}%`, background: limitOver ? "var(--red)" : limitWarn ? "var(--brass)" : "var(--green)" }} /></div>
                    <span className="b-label" style={{ color: limitOver ? "var(--red)" : limitWarn ? "var(--brass)" : "var(--ink-faint)" }}>
                      {fmt(spend)} / {fmt(a.monthlyLimit)} limit
                    </span>
                  </div>
                )}
                {a.savingsGoal && (
                  <div className="bucket-bar-wrap">
                    <div className="b-track"><div className="b-fill" style={{ width: `${goalPct}%`, background: goalDone ? "var(--green)" : "var(--brass)" }} /></div>
                    <span className="b-label" style={{ color: goalDone ? "var(--green)" : "var(--ink-faint)" }}>
                      {goalDone ? "✓ Goal reached!" : `${fmt(bal)} / ${fmt(a.savingsGoal)} goal`}
                      {!goalDone && dl !== null && <> · {dl > 0 ? `${dl}d left` : "overdue"}</>}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          <button className="bucket add" onClick={() => setModal("account")}>
            <Plus size={20} /><span>New bucket</span>
          </button>
        </section>

        {/* actions */}
        <section className="actions">
          <button className="act income"   onClick={() => setModal("income")}><ArrowDownLeft size={18} /> Add income</button>
          <button className="act transfer" onClick={() => setModal("transfer")}><ArrowLeftRight size={18} /> Transfer</button>
          <button className="act expense"  onClick={() => setModal("expense")}><ArrowUpRight size={18} /> Add expense</button>
        </section>

        {/* ledger */}
        <section className="ledger">
          <div className="ledger-head">
            <span>Ledger</span>
            <span className="ledger-count">{isFiltered ? `${filteredTxns.length} of ${txns.length}` : `${txns.length} entries`}</span>
          </div>

          {txns.length > 0 && (
            <div className="filter-bar">
              {bucketFilter && (
                <div className="bucket-chip">
                  <span style={{ color: accById[bucketFilter]?.color }}>{accById[bucketFilter]?.emoji}</span>
                  {accById[bucketFilter]?.name}
                  <button onClick={() => setBucketFilter(null)}><X size={11} /></button>
                </div>
              )}
              <div className="search-wrap">
                <Search size={14} />
                <input className="search-input" placeholder="Search entries, dates…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {search && <button className="search-clear" onClick={() => setSearch("")}><X size={12} /></button>}
              </div>
              <div className="date-chips">
                {(["all", "today", "week", "month", "3months"] as DatePreset[]).map((p) => (
                  <button key={p} className={`chip ${datePreset === p ? "on" : ""}`} onClick={() => setDatePreset(p)}>
                    {p === "all" ? "All time" : p === "today" ? "Today" : p === "week" ? "7 days" : p === "month" ? "This month" : "3 months"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {txns.length === 0 && (
            <div className="empty">
              <PiggyBank size={34} strokeWidth={1.4} />
              <p>No entries yet.</p>
              <p className="empty-sub">Add your salary, split Rs 70 into Savings and Rs 30 into Spending — your buckets fill up.</p>
            </div>
          )}

          {txns.length > 0 && filteredTxns.length === 0 && (
            <div className="no-match">No entries match your filter.</div>
          )}

          {filteredTxns.map((t) => {
            const runBal = runningBalances[t.id];
            return (
              <div className="row" key={t.id}>
                <span className={`row-icon ${t.type}`}>
                  {t.type === "income" ? <ArrowDownLeft size={15} /> : t.type === "expense" ? <ArrowUpRight size={15} /> : <ArrowLeftRight size={15} />}
                </span>
                <div className="row-mid">
                  <span className="row-note">{highlight(t.note || (t.type === "income" ? "Income" : t.type === "expense" ? "Expense" : "Transfer"), search)}</span>
                  <span className="row-meta">
                    {prettyDate(t.date)}{" · "}
                    {t.type === "income"
                      ? t.allocations.map((al) => `${accById[al.accountId]?.emoji || "•"} ${fmt(al.amount)}`).join("  ")
                      : t.type === "expense"
                      ? <>{accById[t.accountId]?.emoji || "•"} {accById[t.accountId]?.name || "—"}</>
                      : <>{accById[t.fromAccountId]?.emoji || "•"} {accById[t.fromAccountId]?.name || "?"} → {accById[t.toAccountId]?.emoji || "•"} {accById[t.toAccountId]?.name || "?"}</>
                    }
                  </span>
                </div>
                <div className="row-right">
                  <span className={`row-amt ${t.type}`}>
                    {t.type === "income" ? "+" : t.type === "expense" ? "−" : "⇄ "}
                    {fmt(t.type === "income" ? t.allocations.reduce((s, a) => s + a.amount, 0) : t.amount)}
                  </span>
                  {runBal !== undefined && (
                    <span className="row-bal" style={{ color: runBal < 0 ? "var(--red)" : undefined }}>{fmt(runBal)}</span>
                  )}
                </div>
                <button className="row-repeat" onClick={() => setRepeatTxn({ ...t, date: today() })} title="Repeat"><RefreshCw size={13} /></button>
                {unlocked && t.id === txns[0]?.id && <button className="row-edit" onClick={() => setEditTxn(t)} title="Edit"><Pencil size={14} /></button>}
                {unlocked && <button className="row-del" onClick={() => removeTxn(t.id)} title="Delete"><Trash2 size={14} /></button>}
              </div>
            );
          })}
        </section>

        <footer className="foot">Saved on this device</footer>
      </div>

      {/* ── modals ── */}
      {modal === "income"   && <IncomeModal   accounts={accounts} onClose={() => setModal(null)} onSave={addIncome} />}
      {modal === "expense"  && <ExpenseModal  accounts={accounts} balances={balances} monthlySpend={monthlySpend} onClose={() => setModal(null)} onSave={addExpense} />}
      {modal === "transfer" && <TransferModal accounts={accounts} balances={balances} onClose={() => setModal(null)} onSave={addTransfer} />}
      {modal === "account"  && <AccountModal  onClose={() => setModal(null)} onSave={addAccount} />}
      {modal === "export"   && <ExportModal   onClose={() => setModal(null)} onCSV={exportCSV} onJSON={exportJSON} onImport={importJSON} />}
      {modal === "reset"    && <ConfirmModal  title="Clear everything?" confirm="Yes, reset" body="This wipes all buckets, ledger entries, and your password. Can't be undone." onClose={() => setModal(null)} onConfirm={resetAll} />}
      {editAccount && <AccountModal initial={editAccount} onClose={() => setEditAccount(null)} onSave={(n, e, c, ml, sg, gd) => updateAccount({ ...editAccount, name: n, emoji: e, color: c, monthlyLimit: ml, savingsGoal: sg, goalDate: gd })} />}
      {editTxn?.type === "income"   && <IncomeModal   accounts={accounts} initial={editTxn} onClose={() => setEditTxn(null)} onSave={(note, date, allocations) => updateTxn({ ...editTxn, note, date, allocations })} />}
      {editTxn?.type === "expense"  && <ExpenseModal  accounts={accounts} balances={balances} monthlySpend={monthlySpend} initial={editTxn} onClose={() => setEditTxn(null)} onSave={(note, date, accountId, amount) => updateTxn({ ...editTxn, note, date, accountId, amount })} />}
      {editTxn?.type === "transfer" && <TransferModal accounts={accounts} balances={balances} initial={editTxn} onClose={() => setEditTxn(null)} onSave={(note, date, from, to, amount) => updateTxn({ ...editTxn, note, date, fromAccountId: from, toAccountId: to, amount })} />}
      {repeatTxn?.type === "income"   && <IncomeModal   accounts={accounts} initial={repeatTxn} isRepeat onClose={() => setRepeatTxn(null)} onSave={addIncome} />}
      {repeatTxn?.type === "expense"  && <ExpenseModal  accounts={accounts} balances={balances} monthlySpend={monthlySpend} initial={repeatTxn} isRepeat onClose={() => setRepeatTxn(null)} onSave={addExpense} />}
      {repeatTxn?.type === "transfer" && <TransferModal accounts={accounts} balances={balances} initial={repeatTxn} isRepeat onClose={() => setRepeatTxn(null)} onSave={addTransfer} />}
      {modal === "unlock" && !pwHash && <SetPasswordModal  onClose={() => setModal(null)} onSet={(h) => { setPwHash(h); setUnlocked(true); setModal(null); }} />}
      {modal === "unlock" &&  pwHash && <VerifyPasswordModal pwHash={pwHash} onClose={() => setModal(null)} onVerify={() => { setUnlocked(true); setModal(null); }} />}
      {modal === "change-password" && pwHash && <ChangePasswordModal pwHash={pwHash} onClose={() => setModal(null)} onChange={(h) => { setPwHash(h); setModal(null); }} />}
    </div>
  );
}

/* ─── helpers ─── */

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return <>{text.slice(0, idx)}<mark className="hl">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
}

function PasswordInput({ value, onChange, placeholder, autoFocus, onEnter }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; onEnter?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-input-wrap">
      <input className="txt" type={show ? "text" : "password"} placeholder={placeholder} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onEnter?.()} />
      <button type="button" className="pw-toggle" tabIndex={-1} onClick={() => setShow((s) => !s)}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

/* ─── IncomeModal ─── */

function IncomeModal({ accounts, onClose, onSave, initial, isRepeat }: {
  accounts: Account[]; onClose: () => void;
  onSave: (note: string, date: string, allocations: Allocation[]) => void;
  initial?: IncomeTxn; isRepeat?: boolean;
}) {
  const [amount, setAmount] = useState(initial ? String(initial.allocations.reduce((s, a) => s + a.amount, 0)) : "");
  const [note,   setNote]   = useState(initial?.note ?? "");
  const [date,   setDate]   = useState(initial?.date ?? today());
  const [alloc,  setAlloc]  = useState<Record<string, string>>(
    initial ? Object.fromEntries(initial.allocations.map((a) => [a.accountId, String(a.amount)])) : {}
  );
  const total     = parseFloat(amount) || 0;
  const allocated = accounts.reduce((s, a) => s + (parseFloat(alloc[a.id]) || 0), 0);
  const remaining = +(total - allocated).toFixed(2);
  const canSave   = total > 0 && Math.abs(remaining) < 0.005;
  const fill = (id: string) => setAlloc((p) => ({ ...p, [id]: String(+((parseFloat(p[id]) || 0) + (remaining > 0 ? remaining : 0)).toFixed(2)) }));
  const autoSplit = () => {
    if (total <= 0 || !accounts.length) return;
    const each = Math.floor((total / accounts.length) * 100) / 100;
    const next: Record<string, string> = {};
    accounts.forEach((a, i) => { next[a.id] = String(i === accounts.length - 1 ? +(total - each * (accounts.length - 1)).toFixed(2) : each); });
    setAlloc(next);
  };
  const save = () => onSave(note.trim(), date, accounts.map((a) => ({ accountId: a.id, amount: parseFloat(alloc[a.id]) || 0 })).filter((a) => a.amount > 0));
  return (
    <Modal title={isRepeat ? "Repeat income" : initial ? "Edit income" : "Add income"} accent="var(--green)" onClose={onClose}>
      <Field label="Amount received">
        <div className="rupee-input"><span>Rs </span><input type="number" inputMode="decimal" placeholder="100" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} /></div>
      </Field>
      <div className="two">
        <Field label="What for?"><input className="txt" placeholder="Salary" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Date"><input className="txt" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="alloc-head"><span>Split into buckets</span><button className="mini-btn" onClick={autoSplit} disabled={total <= 0}><Wand2 size={13} /> Split evenly</button></div>
      <div className="alloc-list">
        {accounts.map((a) => (
          <div className="alloc-row" key={a.id} style={{ "--c": a.color } as React.CSSProperties}>
            <span className="alloc-name"><b>{a.emoji}</b> {a.name}</span>
            <div className="alloc-input"><span>Rs </span><input type="number" inputMode="decimal" placeholder="0" value={alloc[a.id] || ""} onChange={(e) => setAlloc((p) => ({ ...p, [a.id]: e.target.value }))} /></div>
            <button className="fill-btn" disabled={remaining <= 0} onClick={() => fill(a.id)}>+ rest</button>
          </div>
        ))}
      </div>
      <div className={`remaining ${remaining === 0 ? "ok" : remaining < 0 ? "over" : ""}`}>
        {remaining > 0 && <>Still to allocate: <b>{fmt(remaining)}</b></>}
        {remaining < 0 && <>Over-allocated by <b>{fmt(-remaining)}</b></>}
        {remaining === 0 && total > 0 && <><Check size={14} /> Fully allocated</>}
        {total === 0 && <>Enter an amount above</>}
      </div>
      <button className="save-btn green" disabled={!canSave} onClick={save}>{isRepeat ? "Add income" : initial ? "Save changes" : "Save income"}</button>
    </Modal>
  );
}

/* ─── ExpenseModal ─── */

function ExpenseModal({ accounts, balances, monthlySpend, onClose, onSave, initial, isRepeat }: {
  accounts: Account[]; balances: Record<string, number>; monthlySpend: Record<string, number>;
  onClose: () => void; onSave: (note: string, date: string, accountId: string, amount: number) => void;
  initial?: ExpenseTxn; isRepeat?: boolean;
}) {
  const [amount,    setAmount]    = useState(initial ? String(initial.amount) : "");
  const [note,      setNote]      = useState(initial?.note ?? "");
  const [date,      setDate]      = useState(initial?.date ?? today());
  const [accountId, setAccountId] = useState(initial?.accountId ?? (accounts[0]?.id || ""));
  const amt  = parseFloat(amount) || 0;
  const sel  = accounts.find((a) => a.id === accountId);
  const over = amt > (balances[accountId] || 0);
  const limitWarn = sel?.monthlyLimit && amt > 0 && (monthlySpend[accountId] || 0) + amt > sel.monthlyLimit;
  return (
    <Modal title={isRepeat ? "Repeat expense" : initial ? "Edit expense" : "Add expense"} accent="var(--red)" onClose={onClose}>
      <Field label="Amount spent">
        <div className="rupee-input"><span>Rs </span><input type="number" inputMode="decimal" placeholder="20" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} /></div>
      </Field>
      <div className="two">
        <Field label="What for?"><input className="txt" placeholder="Lunch" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Date"><input className="txt" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Take it from">
        <div className="pick-list">
          {accounts.map((a) => (
            <button key={a.id} className={`pick ${accountId === a.id ? "on" : ""}`} style={{ "--c": a.color } as React.CSSProperties} onClick={() => setAccountId(a.id)}>
              <span>{a.emoji} {a.name}</span><small>{fmt(balances[a.id])}</small>
            </button>
          ))}
        </div>
      </Field>
      {over      && amt > 0 && <div className="warn">⚠ More than {sel?.name} holds — it'll go negative.</div>}
      {limitWarn &&            <div className="warn">⚠ This will exceed {sel?.name}'s monthly limit of {fmt(sel?.monthlyLimit)}.</div>}
      <button className="save-btn red" disabled={!(amt > 0 && accountId)} onClick={() => onSave(note.trim(), date, accountId, amt)}>
        {isRepeat ? "Add expense" : initial ? "Save changes" : "Save expense"}
      </button>
    </Modal>
  );
}

/* ─── TransferModal ─── */

function TransferModal({ accounts, balances, onClose, onSave, initial, isRepeat }: {
  accounts: Account[]; balances: Record<string, number>;
  onClose: () => void; onSave: (note: string, date: string, from: string, to: string, amount: number) => void;
  initial?: TransferTxn; isRepeat?: boolean;
}) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [note,   setNote]   = useState(initial?.note ?? "");
  const [date,   setDate]   = useState(initial?.date ?? today());
  const [fromId, setFromId] = useState(initial?.fromAccountId ?? (accounts[0]?.id || ""));
  const [toId,   setToId]   = useState(initial?.toAccountId   ?? (accounts[1]?.id || accounts[0]?.id || ""));
  const amt  = parseFloat(amount) || 0;
  const over = amt > (balances[fromId] || 0);
  const same = fromId === toId;
  const setFrom = (id: string) => { setFromId(id); if (toId === id) setToId(accounts.find((a) => a.id !== id)?.id || id); };
  return (
    <Modal title={isRepeat ? "Repeat transfer" : initial ? "Edit transfer" : "Transfer"} accent="var(--brass)" onClose={onClose}>
      <Field label="Amount">
        <div className="rupee-input"><span>Rs </span><input type="number" inputMode="decimal" placeholder="0" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} /></div>
      </Field>
      <div className="two">
        <Field label="Note (optional)"><input className="txt" placeholder="Moving funds" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Date"><input className="txt" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="From bucket">
        <div className="pick-list">{accounts.map((a) => <button key={a.id} className={`pick ${fromId === a.id ? "on" : ""}`} style={{ "--c": a.color } as React.CSSProperties} onClick={() => setFrom(a.id)}><span>{a.emoji} {a.name}</span><small>{fmt(balances[a.id])}</small></button>)}</div>
      </Field>
      <Field label="To bucket">
        <div className="pick-list">{accounts.filter((a) => a.id !== fromId).map((a) => <button key={a.id} className={`pick ${toId === a.id ? "on" : ""}`} style={{ "--c": a.color } as React.CSSProperties} onClick={() => setToId(a.id)}><span>{a.emoji} {a.name}</span><small>{fmt(balances[a.id])}</small></button>)}</div>
      </Field>
      {over && amt > 0 && <div className="warn">⚠ More than {accounts.find((a) => a.id === fromId)?.name} holds — it'll go negative.</div>}
      {same &&             <div className="warn">⚠ From and To must be different buckets.</div>}
      <button className="save-btn" style={{ background: "var(--brass)" }} disabled={!(amt > 0 && fromId && toId && !same)} onClick={() => onSave(note.trim(), date, fromId, toId, amt)}>
        {isRepeat ? "Transfer" : initial ? "Save changes" : "Transfer"}
      </button>
    </Modal>
  );
}

/* ─── AccountModal ─── */

function AccountModal({ onClose, onSave, initial }: {
  onClose: () => void;
  onSave: (name: string, emoji: string, color: string, monthlyLimit?: number, savingsGoal?: number, goalDate?: string) => void;
  initial?: Account;
}) {
  const [name,      setName]      = useState(initial?.name  ?? "");
  const [emoji,     setEmoji]     = useState(initial?.emoji ?? "💼");
  const [color,     setColor]     = useState(initial?.color ?? PALETTE[2]);
  const [limitStr,  setLimitStr]  = useState(initial?.monthlyLimit ? String(initial.monthlyLimit) : "");
  const [goalStr,   setGoalStr]   = useState(initial?.savingsGoal  ? String(initial.savingsGoal)  : "");
  const [goalDate,  setGoalDate]  = useState(initial?.goalDate ?? "");
  const limit = parseFloat(limitStr) > 0 ? parseFloat(limitStr) : undefined;
  const goal  = parseFloat(goalStr)  > 0 ? parseFloat(goalStr)  : undefined;
  return (
    <Modal title={initial ? "Edit bucket" : "New bucket"} accent={color} onClose={onClose}>
      <div className="two">
        <Field label="Name"><input className="txt" placeholder="Rent, Emergency fund…" value={name} autoFocus onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Emoji"><input className="txt center" maxLength={2} value={emoji} onChange={(e) => setEmoji(e.target.value)} /></Field>
      </div>
      <Field label="Colour">
        <div className="swatches">{PALETTE.map((c) => <button key={c} className={`swatch ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
      </Field>
      <div className="two">
        <Field label="Monthly spend limit">
          <div className="rupee-input" style={{ "--accent": color } as React.CSSProperties}>
            <span>Rs </span><input type="number" inputMode="decimal" placeholder="No limit" value={limitStr} onChange={(e) => setLimitStr(e.target.value)} style={{ fontSize: "18px" }} />
          </div>
        </Field>
        <Field label="Savings goal">
          <div className="rupee-input" style={{ "--accent": color } as React.CSSProperties}>
            <span>Rs </span><input type="number" inputMode="decimal" placeholder="No goal" value={goalStr} onChange={(e) => setGoalStr(e.target.value)} style={{ fontSize: "18px" }} />
          </div>
        </Field>
      </div>
      {goal && (
        <Field label="Goal target date (optional)">
          <input className="txt" type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)} />
        </Field>
      )}
      <button className="save-btn" style={{ background: color }} disabled={!name.trim()} onClick={() => onSave(name.trim(), emoji || "💼", color, limit, goal, goalDate || undefined)}>
        {initial ? "Save changes" : "Create bucket"}
      </button>
    </Modal>
  );
}

/* ─── ExportModal ─── */

function ExportModal({ onClose, onCSV, onJSON, onImport }: {
  onClose: () => void; onCSV: () => void; onJSON: () => void; onImport: (f: File) => void;
}) {
  const [err, setErr] = useState("");
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.endsWith(".json")) { setErr("Please select a .json backup file."); return; }
    setErr(""); onImport(f);
  };
  return (
    <Modal title="Export & backup" accent="var(--brass)" onClose={onClose}>
      <p className="pw-hint">Download your data or restore from a previous backup.</p>
      <div className="export-btns">
        <button className="export-btn" onClick={onCSV}><Download size={16} /><span>Download CSV</span><small>Open in Excel / Sheets</small></button>
        <button className="export-btn" onClick={onJSON}><Download size={16} /><span>Download JSON</span><small>Full backup, restorable</small></button>
      </div>
      <div className="export-divider"><span>Restore from backup</span></div>
      <label className="restore-label"><Upload size={15} /><span>Choose a .json backup file</span><input type="file" accept=".json" style={{ display: "none" }} onChange={handleFile} /></label>
      {err && <div className="warn" style={{ marginTop: "8px" }}>{err}</div>}
    </Modal>
  );
}

/* ─── ConfirmModal ─── */

function ConfirmModal({ title, body, confirm, onClose, onConfirm }: {
  title: string; body: string; confirm: string; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal title={title} accent="var(--red)" onClose={onClose}>
      <p className="confirm-body">{body}</p>
      <div className="confirm-row"><button className="ghost-btn big" onClick={onClose}>Cancel</button><button className="save-btn red" onClick={onConfirm}>{confirm}</button></div>
    </Modal>
  );
}

/* ─── password modals ─── */

function SetPasswordModal({ onClose, onSet }: { onClose: () => void; onSet: (h: string) => void }) {
  const [pw, setPw] = useState(""); const [confirm, setConfirm] = useState(""); const [err, setErr] = useState("");
  const submit = async () => {
    if (pw.length < 6)  { setErr("Password must be at least 6 characters."); return; }
    if (pw !== confirm) { setErr("Passwords don't match."); return; }
    onSet(await sha256(pw));
  };
  return (
    <Modal title="Set a password" accent="var(--brass)" onClose={onClose}>
      <p className="pw-hint">Set a password to unlock edit, delete, and reset. You'll need it each time you unlock.</p>
      <Field label="New password"><PasswordInput value={pw} placeholder="Min. 6 characters" autoFocus onChange={(v) => { setPw(v); setErr(""); }} /></Field>
      <Field label="Confirm password"><PasswordInput value={confirm} placeholder="Repeat password" onChange={(v) => { setConfirm(v); setErr(""); }} onEnter={submit} /></Field>
      {err && <div className="warn">{err}</div>}
      <button className="save-btn" style={{ background: "var(--brass)" }} disabled={!pw || !confirm} onClick={submit}>Set password &amp; unlock</button>
    </Modal>
  );
}

function VerifyPasswordModal({ pwHash, onClose, onVerify }: { pwHash: string; onClose: () => void; onVerify: () => void }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  const submit = async () => { if ((await sha256(pw)) === pwHash) { onVerify(); } else { setErr("Wrong password."); setPw(""); } };
  return (
    <Modal title="Enter password" accent="var(--brass)" onClose={onClose}>
      <p className="pw-hint">Enter your password to unlock edit, delete, and reset.</p>
      <Field label="Password"><PasswordInput value={pw} placeholder="Your password" autoFocus onChange={(v) => { setPw(v); setErr(""); }} onEnter={submit} /></Field>
      {err && <div className="warn">{err}</div>}
      <button className="save-btn" style={{ background: "var(--brass)" }} disabled={!pw} onClick={submit}>Unlock</button>
    </Modal>
  );
}

function ChangePasswordModal({ pwHash, onClose, onChange }: { pwHash: string; onClose: () => void; onChange: (h: string) => void }) {
  const [oldPw, setOldPw] = useState(""); const [newPw, setNewPw] = useState(""); const [confirmPw, setConfirmPw] = useState(""); const [err, setErr] = useState("");
  const submit = async () => {
    if ((await sha256(oldPw)) !== pwHash) { setErr("Current password is wrong."); return; }
    if (newPw.length < 6)                 { setErr("New password must be at least 6 characters."); return; }
    if (newPw !== confirmPw)              { setErr("New passwords don't match."); return; }
    onChange(await sha256(newPw));
  };
  return (
    <Modal title="Change password" accent="var(--brass)" onClose={onClose}>
      <p className="pw-hint">Verify your current password, then set a new one.</p>
      <Field label="Current password"><PasswordInput value={oldPw} placeholder="Current password" autoFocus onChange={(v) => { setOldPw(v); setErr(""); }} /></Field>
      <Field label="New password"><PasswordInput value={newPw} placeholder="Min. 6 characters" onChange={(v) => { setNewPw(v); setErr(""); }} /></Field>
      <Field label="Confirm new password"><PasswordInput value={confirmPw} placeholder="Repeat new password" onChange={(v) => { setConfirmPw(v); setErr(""); }} onEnter={submit} /></Field>
      {err && <div className="warn">{err}</div>}
      <button className="save-btn" style={{ background: "var(--brass)" }} disabled={!oldPw || !newPw || !confirmPw} onClick={submit}>Update password</button>
    </Modal>
  );
}

/* ─── shells ─── */

function Modal({ title, accent, children, onClose }: { title: string; accent: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" style={{ "--accent": accent } as React.CSSProperties} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>{title}</h3><button className="modal-x" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

/* ─── CSS ─── */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,500&family=Spline+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500;600&display=swap');

.khata{
  --paper:#f3ecdb; --paper-2:#ece3cc; --card:#fbf7ec;
  --ink:#1b3a2b; --ink-soft:#4a6353; --ink-faint:#8b9990;
  --brass:#b8893d; --green:#2f6b46; --red:#a8442f;
  --line:rgba(27,58,43,.13);
  --display:'Fraunces',serif; --sans:'Spline Sans',sans-serif; --mono:'Spline Sans Mono',monospace;
  font-family:var(--sans); color:var(--ink);
  min-height:100%; width:100%; box-sizing:border-box;
  padding:26px 16px 40px;
  background:radial-gradient(120% 80% at 50% -10%, #f7f1e2 0%, var(--paper) 55%, var(--paper-2) 100%);
  -webkit-font-smoothing:antialiased;
}
.khata *{box-sizing:border-box}
.sheet{max-width:560px; margin:0 auto;}

/* masthead */
.masthead{display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:22px;}
.masthead h1{font-family:var(--display); font-weight:600; font-size:30px; margin:0; letter-spacing:-.01em; line-height:1;}
.masthead h1 .latin{font-style:italic; font-weight:500; font-size:20px; color:var(--brass); margin-left:6px;}
.tag{margin:7px 0 0; font-size:13.5px; color:var(--ink-soft);}
.masthead-end{display:flex; align-items:center; gap:7px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;}
.ghost-btn{display:inline-flex; align-items:center; gap:6px; font-family:var(--sans); font-size:12.5px; color:var(--ink-soft);
  background:transparent; border:1px solid var(--line); padding:7px 11px; border-radius:9px; cursor:pointer; transition:.15s;}
.ghost-btn:hover{background:rgba(168,68,47,.07); color:var(--red); border-color:rgba(168,68,47,.3);}
.ghost-btn.big{flex:1; justify-content:center; padding:13px; font-size:14px;}
.lock-btn.is-unlocked{background:rgba(47,107,70,.1); color:var(--green); border-color:rgba(47,107,70,.3);}
.lock-btn.is-unlocked:hover{background:rgba(47,107,70,.16); color:var(--green); border-color:rgba(47,107,70,.5);}
.change-pwd-btn{font-size:11.5px !important; padding:6px 10px !important; color:var(--ink-faint) !important; border-color:transparent !important;}
.change-pwd-btn:hover{color:var(--brass) !important; border-color:rgba(184,137,61,.3) !important; background:rgba(184,137,61,.06) !important;}

/* hero */
.hero{background:linear-gradient(160deg,#1f4231,#173627); color:#f3ecdb; border-radius:20px;
  padding:24px 26px 22px; box-shadow:0 18px 40px -18px rgba(23,54,39,.6); position:relative; overflow:hidden;}
.hero::after{content:""; position:absolute; inset:0; background:radial-gradient(80% 120% at 90% -20%, rgba(184,137,61,.35), transparent 60%); pointer-events:none;}
.hero-label{font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:rgba(243,236,219,.6);}
.hero-amount{font-family:var(--display); font-weight:600; font-size:46px; line-height:1.05; margin:6px 0 14px; letter-spacing:-.02em;}
.hero-stats{display:flex; align-items:center; gap:10px; font-family:var(--mono); font-size:12.5px; flex-wrap:wrap;}
.stat{display:inline-flex; align-items:center; gap:4px;}
.stat.in{color:#8fd3a8;} .stat.out{color:#e6a08c;}
.dot{width:3px; height:3px; border-radius:50%; background:rgba(243,236,219,.4);}
.stat-note{color:rgba(243,236,219,.5); margin-left:auto;}

/* trend */
.trend{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px 14px; margin:16px 0;}
.trend-title{font-family:var(--display); font-size:14px; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:14px;}
.trend-chart{display:flex; align-items:flex-end; gap:6px; height:80px;}
.trend-col{flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;}
.trend-bars{display:flex; gap:3px; align-items:flex-end; height:60px;}
.trend-bar{width:12px; border-radius:3px 3px 0 0; min-height:2px; transition:height .3s ease;}
.trend-bar.inc{background:var(--green); opacity:.85;}
.trend-bar.exp{background:var(--red); opacity:.75;}
.trend-lbl{font-family:var(--mono); font-size:10px; color:var(--ink-faint); letter-spacing:.02em;}
.trend-lbl.now{color:var(--brass); font-weight:600;}
.trend-legend{display:flex; align-items:center; gap:14px; margin-top:10px; font-family:var(--mono); font-size:11px; color:var(--ink-faint);}
.tleg{display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px;}
.tleg.inc{background:var(--green);}
.tleg.exp{background:var(--red);}

/* buckets */
.buckets{display:flex; gap:12px; flex-wrap:wrap; margin:20px 0;}
.bucket{position:relative; flex:1 1 150px; min-width:140px; background:var(--card); border:1px solid var(--line);
  border-left:4px solid var(--c, var(--brass)); border-radius:14px; padding:15px 16px 14px;
  display:flex; flex-direction:column; gap:3px; cursor:pointer; transition:.15s; user-select:none;}
.bucket:hover{background:color-mix(in srgb, var(--c) 5%, var(--card));}
.bucket.active{border-color:var(--c); box-shadow:0 0 0 3px color-mix(in srgb, var(--c) 22%, transparent); background:color-mix(in srgb, var(--c) 8%, var(--card));}
.bucket-emoji{font-size:19px;}
.bucket-name{font-size:13px; color:var(--ink-soft); font-weight:500;}
.bucket-bal{font-family:var(--mono); font-weight:600; font-size:21px; letter-spacing:-.01em; margin-top:2px;}
.bucket-x{position:absolute; top:8px; right:8px; width:22px; height:22px; border-radius:6px; border:none;
  background:transparent; color:var(--ink-faint); cursor:pointer; display:grid; place-items:center; opacity:0; transition:.15s;}
.bucket:hover .bucket-x{opacity:1;}
.bucket-x:hover:not(:disabled){background:rgba(168,68,47,.12); color:var(--red);}
.bucket-x:disabled{cursor:not-allowed;}
.bucket-edit{position:absolute; top:8px; right:32px; width:22px; height:22px; border-radius:6px; border:none;
  background:transparent; color:var(--ink-faint); cursor:pointer; display:grid; place-items:center; opacity:0; transition:.15s;}
.bucket:hover .bucket-edit{opacity:1;}
.bucket-edit:hover{background:rgba(47,107,70,.12); color:var(--green);}
.bucket.add{align-items:center; justify-content:center; flex-direction:column; gap:6px; color:var(--ink-soft);
  border:1.5px dashed var(--line); border-left:1.5px dashed var(--line); background:transparent; min-height:84px; font-size:12.5px;}
.bucket.add:hover{border-color:var(--brass); color:var(--brass); background:rgba(184,137,61,.05); box-shadow:none;}
.bucket-bar-wrap{margin-top:8px;}
.b-track{height:4px; background:var(--line); border-radius:2px; overflow:hidden; margin-bottom:4px;}
.b-fill{height:100%; border-radius:2px; transition:width .3s ease, background .3s ease;}
.b-label{font-family:var(--mono); font-size:10px; letter-spacing:.01em; line-height:1.3; display:block;}

/* actions */
.actions{display:flex; gap:10px; margin-bottom:24px; flex-wrap:wrap;}
.act{flex:1; min-width:120px; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:13px 10px; border-radius:13px;
  font-family:var(--sans); font-weight:600; font-size:13.5px; cursor:pointer; border:none; transition:.15s; color:#fff; white-space:nowrap;}
.act.income{background:var(--green);} .act.income:hover{background:#27583a;}
.act.transfer{background:var(--card); color:var(--brass); border:1px solid rgba(184,137,61,.35);}
.act.transfer:hover{background:rgba(184,137,61,.08);}
.act.expense{background:var(--card); color:var(--red); border:1px solid rgba(168,68,47,.3);}
.act.expense:hover{background:rgba(168,68,47,.07);}

/* ledger */
.ledger{background:var(--card); border:1px solid var(--line); border-radius:16px; overflow:hidden;}
.ledger-head{display:flex; justify-content:space-between; align-items:baseline; padding:16px 18px 12px;
  font-family:var(--display); font-size:17px; font-weight:600; border-bottom:1px solid var(--line);}
.ledger-count{font-family:var(--mono); font-size:11.5px; color:var(--ink-faint); font-weight:400;}
.empty{text-align:center; padding:42px 26px; color:var(--ink-faint);}
.empty p{margin:10px 0 0; font-size:14px; color:var(--ink-soft);}
.empty-sub{font-size:12.5px !important; color:var(--ink-faint) !important; max-width:300px; margin:6px auto 0 !important;}
.row{display:flex; align-items:center; gap:10px; padding:13px 18px; border-bottom:1px solid var(--line); transition:.12s;}
.row:last-child{border-bottom:none;}
.row:hover{background:rgba(184,137,61,.05);}
.row-icon{width:30px; height:30px; border-radius:9px; display:grid; place-items:center; flex-shrink:0;}
.row-icon.income{background:rgba(47,107,70,.14); color:var(--green);}
.row-icon.expense{background:rgba(168,68,47,.13); color:var(--red);}
.row-icon.transfer{background:rgba(184,137,61,.15); color:var(--brass);}
.row-mid{flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;}
.row-note{font-size:14px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.row-meta{font-family:var(--mono); font-size:11px; color:var(--ink-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.row-right{display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex-shrink:0;}
.row-amt{font-family:var(--mono); font-weight:600; font-size:15px;}
.row-amt.income{color:var(--green);} .row-amt.expense{color:var(--red);} .row-amt.transfer{color:var(--brass);}
.row-bal{font-family:var(--mono); font-size:10.5px; color:var(--ink-faint);}
.row-repeat,.row-edit,.row-del{width:26px; height:26px; border:none; background:transparent; color:var(--ink-faint); border-radius:7px;
  cursor:pointer; display:grid; place-items:center; opacity:0; transition:.15s; flex-shrink:0;}
.row:hover .row-repeat,.row:hover .row-edit,.row:hover .row-del{opacity:1;}
.row-repeat:hover{background:rgba(47,107,70,.12); color:var(--green);}
.row-edit:hover{background:rgba(184,137,61,.15); color:var(--brass);}
.row-del:hover{background:rgba(168,68,47,.12); color:var(--red);}
.foot{text-align:center; font-family:var(--mono); font-size:11px; color:var(--ink-faint); margin-top:22px; letter-spacing:.04em;}

/* filter */
.filter-bar{padding:12px 18px 11px; border-bottom:1px solid var(--line); display:flex; flex-direction:column; gap:8px;}
.bucket-chip{display:inline-flex; align-items:center; gap:6px; background:rgba(184,137,61,.12); border:1px solid rgba(184,137,61,.3);
  border-radius:20px; padding:4px 10px 4px 8px; font-family:var(--mono); font-size:12px; color:var(--brass); width:fit-content;}
.bucket-chip button{border:none; background:transparent; color:var(--brass); cursor:pointer; display:grid; place-items:center; padding:1px; border-radius:3px; opacity:.7;}
.bucket-chip button:hover{opacity:1;}
.search-wrap{display:flex; align-items:center; gap:8px; background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:0 11px; transition:.15s;}
.search-wrap:focus-within{border-color:var(--brass); box-shadow:0 0 0 3px rgba(184,137,61,.12);}
.search-wrap svg{color:var(--ink-faint); flex-shrink:0;}
.search-input{flex:1; border:none; background:transparent; outline:none; font-family:var(--sans); font-size:13.5px; color:var(--ink); padding:9px 0;}
.search-input::placeholder{color:var(--ink-faint);}
.search-clear{border:none; background:transparent; color:var(--ink-faint); cursor:pointer; display:grid; place-items:center; padding:3px; border-radius:5px; transition:.12s;}
.search-clear:hover{color:var(--red); background:rgba(168,68,47,.1);}
.date-chips{display:flex; gap:6px; flex-wrap:wrap;}
.chip{font-family:var(--mono); font-size:11.5px; padding:5px 11px; border-radius:20px; border:1px solid var(--line);
  background:transparent; color:var(--ink-soft); cursor:pointer; transition:.13s; white-space:nowrap; letter-spacing:.01em;}
.chip:hover{border-color:var(--brass); color:var(--brass);}
.chip.on{background:var(--brass); color:#fff; border-color:var(--brass);}
.no-match{text-align:center; padding:32px 26px; font-size:13.5px; color:var(--ink-faint);}
.hl{background:rgba(184,137,61,.28); color:var(--ink); border-radius:2px; padding:0 1px; font-style:normal;}

/* modal chrome */
.overlay{position:fixed; inset:0; background:rgba(23,42,32,.42); backdrop-filter:blur(3px);
  display:flex; align-items:center; justify-content:center; padding:18px; z-index:50; animation:fade .18s ease;}
@keyframes fade{from{opacity:0}to{opacity:1}}
.modal{background:var(--paper); border-radius:20px; width:100%; max-width:430px; max-height:92vh; overflow-y:auto;
  box-shadow:0 30px 70px -20px rgba(23,42,32,.5); border-top:5px solid var(--accent); animation:pop .2s cubic-bezier(.2,.9,.3,1.2);}
@keyframes pop{from{transform:translateY(14px) scale(.98); opacity:0}to{transform:none; opacity:1}}
.modal-head{display:flex; align-items:center; justify-content:space-between; padding:18px 20px 4px;}
.modal-head h3{font-family:var(--display); font-weight:600; font-size:21px; margin:0;}
.modal-x{border:none; background:transparent; color:var(--ink-faint); cursor:pointer; padding:5px; border-radius:8px; display:grid; place-items:center;}
.modal-x:hover{background:rgba(27,58,43,.08); color:var(--ink);}
.modal-body{padding:14px 20px 22px;}
.field{display:block; margin-bottom:14px;}
.field-label{display:block; font-size:12px; font-weight:500; color:var(--ink-soft); margin-bottom:6px; letter-spacing:.01em;}
.two{display:flex; gap:12px;}
.two .field{flex:1;}
.txt{width:100%; font-family:var(--sans); font-size:15px; color:var(--ink); background:var(--card);
  border:1px solid var(--line); border-radius:11px; padding:12px 13px; outline:none; transition:.15s;}
.txt.center{text-align:center;}
.txt:focus{border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);}
.rupee-input{display:flex; align-items:center; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:0 14px; transition:.15s;}
.rupee-input:focus-within{border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);}
.rupee-input span{font-family:var(--display); font-size:17px; font-weight:600; color:var(--ink-soft); margin-right:8px;}
.rupee-input input{flex:1; border:none; background:transparent; outline:none; font-family:var(--mono); font-weight:600; font-size:26px; color:var(--ink); padding:13px 0; width:100%;}
.warn{background:rgba(168,68,47,.1); color:var(--red); font-size:12.5px; padding:10px 13px; border-radius:10px; margin-bottom:6px;}
.save-btn{width:100%; margin-top:14px; padding:14px; border:none; border-radius:13px; color:#fff;
  font-family:var(--sans); font-weight:600; font-size:15px; cursor:pointer; transition:.15s; letter-spacing:.01em;}
.save-btn.green{background:var(--green);} .save-btn.red{background:var(--red);}
.save-btn:hover:not(:disabled){filter:brightness(1.07);}
.save-btn:disabled{opacity:.4; cursor:not-allowed;}
.confirm-body{font-size:14px; color:var(--ink-soft); line-height:1.55; margin:4px 0 18px;}
.confirm-row{display:flex; gap:10px;}
.confirm-row .save-btn{margin-top:0; flex:1;}
.pw-hint{font-size:13px; color:var(--ink-soft); line-height:1.6; margin:2px 0 14px;}
.pw-input-wrap{position:relative;}
.pw-input-wrap .txt{padding-right:42px;}
.pw-toggle{position:absolute; right:10px; top:50%; transform:translateY(-50%); border:none; background:transparent;
  color:var(--ink-faint); cursor:pointer; display:grid; place-items:center; padding:5px; border-radius:6px; transition:.12s;}
.pw-toggle:hover{color:var(--ink); background:rgba(27,58,43,.07);}

/* allocation */
.alloc-head{display:flex; align-items:center; justify-content:space-between; margin:6px 0 10px; font-size:12px; font-weight:600; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.06em;}
.mini-btn{display:inline-flex; align-items:center; gap:5px; font-family:var(--sans); font-size:12px; text-transform:none; letter-spacing:0;
  color:var(--brass); background:rgba(184,137,61,.1); border:none; padding:6px 10px; border-radius:8px; cursor:pointer; font-weight:500;}
.mini-btn:hover:not(:disabled){background:rgba(184,137,61,.2);}
.mini-btn:disabled{opacity:.4; cursor:not-allowed;}
.alloc-list{display:flex; flex-direction:column; gap:8px;}
.alloc-row{display:flex; align-items:center; gap:9px; background:var(--card); border:1px solid var(--line);
  border-left:3px solid var(--c); border-radius:11px; padding:8px 10px 8px 12px;}
.alloc-name{flex:1; font-size:13.5px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.alloc-name b{font-weight:400;}
.alloc-input{display:flex; align-items:center; background:var(--paper); border:1px solid var(--line); border-radius:9px; padding:0 9px; width:108px;}
.alloc-input span{color:var(--ink-soft); font-family:var(--mono); font-size:13px;}
.alloc-input input{width:100%; border:none; background:transparent; outline:none; font-family:var(--mono); font-weight:600; font-size:14px; padding:9px 0 9px 4px; color:var(--ink);}
.fill-btn{font-family:var(--mono); font-size:11px; color:var(--brass); background:transparent; border:1px solid rgba(184,137,61,.4);
  padding:8px; border-radius:8px; cursor:pointer; white-space:nowrap; transition:.15s;}
.fill-btn:hover:not(:disabled){background:rgba(184,137,61,.12);}
.fill-btn:disabled{opacity:.3; cursor:not-allowed;}
.remaining{margin:13px 0 4px; padding:11px 14px; border-radius:11px; font-size:13.5px; font-family:var(--mono);
  display:flex; align-items:center; gap:7px; background:rgba(184,137,61,.1); color:var(--brass);}
.remaining.ok{background:rgba(47,107,70,.12); color:var(--green);}
.remaining.over{background:rgba(168,68,47,.12); color:var(--red);}
.remaining b{font-weight:600;}

/* pick list */
.pick-list{display:flex; flex-direction:column; gap:8px;}
.pick{display:flex; align-items:center; justify-content:space-between; background:var(--card); border:1px solid var(--line);
  border-left:3px solid var(--c); border-radius:11px; padding:12px 14px; cursor:pointer; font-family:var(--sans); transition:.13s; color:var(--ink);}
.pick span{font-size:14px; font-weight:500;}
.pick small{font-family:var(--mono); font-size:12.5px; color:var(--ink-soft);}
.pick:hover{background:color-mix(in srgb, var(--c) 7%, var(--card));}
.pick.on{border-color:var(--c); box-shadow:0 0 0 2px color-mix(in srgb, var(--c) 30%, transparent); background:color-mix(in srgb, var(--c) 9%, var(--card));}
.swatches{display:flex; gap:10px;}
.swatch{width:34px; height:34px; border-radius:50%; border:2px solid transparent; cursor:pointer; transition:.13s;}
.swatch.on{border-color:var(--ink); transform:scale(1.08);}

/* export */
.export-btns{display:flex; gap:10px; margin-bottom:14px;}
.export-btn{flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; background:var(--card);
  border:1px solid var(--line); border-radius:13px; padding:16px 12px; cursor:pointer; transition:.15s; color:var(--ink);}
.export-btn:hover{border-color:var(--brass); background:rgba(184,137,61,.05);}
.export-btn svg{color:var(--brass);}
.export-btn span{font-size:13.5px; font-weight:600;}
.export-btn small{font-size:11px; color:var(--ink-faint);}
.export-divider{display:flex; align-items:center; gap:10px; margin:10px 0 12px; font-size:11.5px; color:var(--ink-faint); font-family:var(--mono);}
.export-divider::before,.export-divider::after{content:""; flex:1; height:1px; background:var(--line);}
.restore-label{display:flex; align-items:center; gap:9px; background:var(--card); border:1.5px dashed var(--line);
  border-radius:12px; padding:13px 16px; cursor:pointer; font-size:13.5px; color:var(--ink-soft); transition:.15s;}
.restore-label:hover{border-color:var(--brass); color:var(--brass);}
.restore-label svg{color:var(--brass); flex-shrink:0;}

@media(max-width:420px){
  .hero-amount{font-size:38px;}
  .two{flex-direction:column; gap:0;}
  .masthead-end{gap:5px;}
}
`;
