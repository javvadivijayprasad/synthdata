'use client';
/**
 * /synthdata — Relational Synthetic Data (multi-table, FK-safe).
 *
 * Drop into apps/platform-ui/src/app/synthdata/page.tsx
 *
 * Sections:
 *   1. Hero + "how it works" flow diagram (SVG) + sample distribution chart
 *   2. Create dataset — DDL + optional business case (AI) or auto mode
 *   3. My datasets — per-user history (JWT), download .db / .sql, delete
 */
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { apiFetch, getApiBase } from '@/lib/api';

interface Dataset {
  id: string; name: string; mode: string; seed: number;
  tables_count: number; rows_count: number; status: string; created_at: string;
}

const SAMPLE_DDL = `CREATE TABLE customers (
  customer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  customer_tier VARCHAR(10) NOT NULL CHECK (customer_tier IN ('STANDARD','SILVER','GOLD','PREMIUM'))
);
CREATE TABLE orders (
  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(customer_id),
  order_total NUMERIC(12,2) NOT NULL CHECK (order_total >= 0),
  order_status VARCHAR(15) NOT NULL CHECK (order_status IN ('PENDING','PAID','DELIVERED','CANCELLED'))
);`;

const SAMPLE_CASE = `500 customers: 70% STANDARD, 15% SILVER, 10% GOLD, 5% PREMIUM.
2000 orders, heavy buyers skewed. 65% delivered, 7% cancelled. Totals long-tail up to 99999.`;

// ─── How-it-works diagram (pure SVG, no deps) ──────────────────────────────
function FlowDiagram() {
  const box = 'fill-slate-800 stroke-slate-600';
  const label = 'fill-slate-100 text-[13px] font-semibold';
  const sub = 'fill-slate-400 text-[11px]';
  return (
    <svg viewBox="0 0 900 150" className="w-full max-w-3xl">
      <rect x="10" y="35" width="200" height="80" rx="10" className={box} strokeWidth="1" />
      <text x="110" y="65" textAnchor="middle" className={label}>1 · Your schema</text>
      <text x="110" y="85" textAnchor="middle" className={sub}>CREATE TABLE DDL</text>
      <text x="110" y="100" textAnchor="middle" className={sub}>+ business case (plain English)</text>
      <path d="M215 75 h55" stroke="#4f8cff" strokeWidth="2" markerEnd="url(#arr)" />
      <rect x="280" y="35" width="200" height="80" rx="10" className={box} strokeWidth="1" />
      <text x="380" y="65" textAnchor="middle" className={label}>2 · Generation plan</text>
      <text x="380" y="85" textAnchor="middle" className={sub}>AI writes it (or auto mode)</text>
      <text x="380" y="100" textAnchor="middle" className={sub}>reviewable YAML — you approve</text>
      <path d="M485 75 h55" stroke="#4f8cff" strokeWidth="2" markerEnd="url(#arr)" />
      <rect x="550" y="35" width="200" height="80" rx="10" className={box} strokeWidth="1" />
      <text x="650" y="60" textAnchor="middle" className={label}>3 · Deterministic engine</text>
      <text x="650" y="80" textAnchor="middle" className={sub}>FK-safe · CHECK-aware · seeded</text>
      <text x="650" y="97" textAnchor="middle" className={sub}>same seed = identical data</text>
      <path d="M755 75 h55" stroke="#3ecf8e" strokeWidth="2" markerEnd="url(#arrG)" />
      <text x="835" y="68" textAnchor="middle" className={label}>.db</text>
      <text x="835" y="88" textAnchor="middle" className={sub}>+ CSV + SQL</text>
      <defs>
        <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="#4f8cff" /></marker>
        <marker id="arrG" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="#3ecf8e" /></marker>
      </defs>
    </svg>
  );
}

// Example: business-case weights become real distributions
function DistributionChart() {
  const data = [
    { label: 'STANDARD', pct: 70 }, { label: 'SILVER', pct: 15 },
    { label: 'GOLD', pct: 10 }, { label: 'PREMIUM', pct: 5 },
  ];
  return (
    <svg viewBox="0 0 360 140" className="w-full max-w-sm">
      <text x="10" y="16" className="fill-slate-300 text-[12px] font-semibold">
        &quot;70/15/10/5 customer tiers&quot; → generated exactly</text>
      {data.map((d, i) => (
        <g key={d.label} transform={`translate(10, ${30 + i * 26})`}>
          <text x="0" y="12" className="fill-slate-400 text-[11px]">{d.label}</text>
          <rect x="70" y="2" width={d.pct * 2.6} height="14" rx="3" fill="#4f8cff" opacity={1 - i * 0.18} />
          <text x={76 + d.pct * 2.6} y="13" className="fill-slate-300 text-[11px]">{d.pct}%</text>
        </g>
      ))}
    </svg>
  );
}

export default function SynthdataPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [name, setName] = useState('');
  const [ddl, setDdl] = useState('');
  const [bcase, setBcase] = useState('');
  const [mode, setMode] = useState<'auto' | 'ai'>('auto');
  const [rows, setRows] = useState(100);
  const [seed, setSeed] = useState(42);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const load = async () => {
    try {
      const r = await apiFetch<{ datasets: Dataset[] }>('/api/v1/synthdata');
      setDatasets(r.datasets);
    } catch { /* not logged in — history stays empty */ }
  };
  useEffect(() => { load(); }, []);

  const generate = async () => {
    if (!ddl.trim()) return setMsg({ text: 'Paste your CREATE TABLE DDL first.', err: true });
    setBusy(true); setMsg({ text: mode === 'ai' ? 'AI is writing the plan, then generating…' : 'Generating…' });
    try {
      let planYaml: string | undefined;
      if (mode === 'ai') {
        if (!bcase.trim()) throw new Error('AI mode needs a business case (or switch to Auto).');
        const p = await apiFetch<{ planYaml: string }>('/api/v1/synthdata/plan', {
          method: 'POST', body: JSON.stringify({ ddl, businessCase: bcase }),
        });
        planYaml = p.planYaml;
      }
      const r = await apiFetch<{ id: string; tables: number; rows: number }>('/api/v1/synthdata', {
        method: 'POST',
        body: JSON.stringify({ name: name || undefined, ddl, planYaml, businessCase: bcase || undefined, seed, rows }),
      });
      setMsg({ text: `Done: ${r.tables} tables, ${r.rows.toLocaleString()} rows — saved to your account.` });
      await load();
    } catch (e: any) { setMsg({ text: e.message, err: true }); }
    setBusy(false);
  };

  const download = async (id: string, format: string) => {
    const res = await fetch(`${getApiBase()}/api/v1/synthdata/${id}/file?format=${format}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? `dataset.${format}`;
    a.click();
  };

  const del = async (id: string) => {
    await apiFetch(`/api/v1/synthdata/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <AppShell>
      <Header title="Synthetic Data — Relational" />
      <div className="mx-auto max-w-6xl space-y-8 p-6">

        {/* 1 · Hero + how it works */}
        <section className="rounded-xl border border-slate-700 bg-slate-900 p-6">
          <h1 className="text-2xl font-bold text-slate-100">
            Realistic multi-table test data. <span className="text-blue-400">No production data.</span>
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Paste your schema and describe your business in plain English. TestForge generates
            relationally consistent data — every foreign key resolves, every CHECK constraint holds,
            and the same seed reproduces identical data for regression runs.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-8">
            <FlowDiagram />
            <DistributionChart />
          </div>
        </section>

        {/* 2 · Create */}
        <section className="rounded-xl border border-slate-700 bg-slate-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">Create dataset</h2>
            <button className="text-xs text-blue-400 hover:underline"
              onClick={() => { setDdl(SAMPLE_DDL); setBcase(SAMPLE_CASE); setMode('ai'); }}>
              Load sample
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">SQL schema (CREATE TABLE …)</label>
              <textarea value={ddl} onChange={e => setDdl(e.target.value)} rows={10}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Business case {mode === 'auto' && <span className="text-slate-500">(optional in Auto mode)</span>}
              </label>
              <textarea value={bcase} onChange={e => setBcase(e.target.value)} rows={6}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200" />
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Mode</label>
                  <select value={mode} onChange={e => setMode(e.target.value as 'auto' | 'ai')}
                    className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200">
                    <option value="auto">Auto (schema only, instant)</option>
                    <option value="ai">AI (uses the business case)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Rows/table (auto)</label>
                  <input type="number" value={rows} onChange={e => setRows(+e.target.value)}
                    className="w-24 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Seed</label>
                  <input type="number" value={seed} onChange={e => setSeed(+e.target.value)}
                    className="w-24 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Name</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="optional"
                    className="w-36 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200" />
                </div>
                <button onClick={generate} disabled={busy}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                  {busy ? 'Working…' : 'Generate'}
                </button>
              </div>
            </div>
          </div>
          {msg && <p className={`mt-3 text-sm ${msg.err ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}
        </section>

        {/* 3 · History (per-user) */}
        <section className="rounded-xl border border-slate-700 bg-slate-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">My datasets</h2>
          {datasets.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing yet — generated datasets are saved to your account and listed here.</p>
          ) : (
            <table className="w-full text-left text-sm text-slate-300">
              <thead><tr className="border-b border-slate-700 text-xs text-slate-500">
                <th className="py-2">Name</th><th>Mode</th><th>Tables</th><th>Rows</th><th>Seed</th><th>Created</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {datasets.map(d => (
                  <tr key={d.id} className="border-b border-slate-800">
                    <td className="py-2 font-medium text-slate-200">{d.name}</td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs ${d.mode === 'ai' ? 'bg-purple-900 text-purple-300' : 'bg-slate-800 text-slate-400'}`}>{d.mode}</span></td>
                    <td>{d.tables_count}</td>
                    <td>{d.rows_count.toLocaleString()}</td>
                    <td>{d.seed}</td>
                    <td className="text-xs text-slate-500">{d.created_at}</td>
                    <td className="space-x-3 text-xs">
                      <button className="text-blue-400 hover:underline" onClick={() => download(d.id, 'db')}>.db</button>
                      <button className="text-blue-400 hover:underline" onClick={() => download(d.id, 'sql')}>.sql</button>
                      <button className="text-red-400 hover:underline" onClick={() => del(d.id)}>delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}
