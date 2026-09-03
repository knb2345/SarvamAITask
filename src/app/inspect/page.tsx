'use client';

import { useEffect, useState } from 'react';

/**
 * "Why" — the engineer's surface. Deliberately the fourth item in the rail: a normal person
 * never needs it, but every claim the product makes about itself has to be checkable here.
 */
export default function InspectPage() {
  const [stats, setStats] = useState<any>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/stats').then((r) => r.json()).then(setStats);
    fetch('/api/traces?limit=15').then((r) => r.json()).then(setData);
  }, []);

  if (!stats || !data) return <div className="page">loading…</div>;

  const totals = stats.model.reduce(
    (a: any, m: any) => ({
      calls: a.calls + m.calls,
      cost: a.cost + (m.cost_usd ?? 0),
      inTok: a.inTok + (m.input_tokens ?? 0),
      outTok: a.outTok + (m.output_tokens ?? 0),
    }),
    { calls: 0, cost: 0, inTok: 0, outTok: 0 }
  );
  const decisions: Record<string, number> = Object.fromEntries(
    stats.decisions.map((d: any) => [d.decision, d.c])
  );

  return (
    <div className="page wide">
      <h1>Why</h1>
      <p className="lede">
        The state of the system and the reasoning behind every answer. Nothing on this page is needed
        to use Kivi — it exists so that what the product claims can be checked.
      </p>

      <div className="stats">
        <Stat v={stats.dictations} l="dictations" />
        <Stat v={stats.memories.active} l="active memories" />
        <Stat v={stats.memories.fact} l="facts" />
        <Stat v={stats.memories.preference} l="preferences" />
        <Stat v={stats.memories.episode} l="episodes" />
        <Stat v={stats.memories.superseded} l="superseded" />
        <Stat v={decisions.rejected ?? 0} l="deliberately ignored" />
        <Stat v={stats.personalDictations ?? 0} l="personal, never learned from" />
        <Stat v={`${(stats.dbBytes / 1_048_576).toFixed(1)} MB`} l="database" />
        <Stat v={totals.calls} l="model calls" />
        <Stat v={`$${totals.cost.toFixed(3)}`} l="spent so far" />
      </div>

      <h2>Model usage</h2>
      <table className="cands">
        <thead>
          <tr>
            <th>purpose</th>
            <th className="num">calls</th>
            <th className="num">in</th>
            <th className="num">out</th>
            <th className="num">avg latency</th>
            <th className="num">cost</th>
          </tr>
        </thead>
        <tbody>
          {stats.model.map((m: any) => (
            <tr key={m.purpose}>
              <td className="used">{m.purpose}</td>
              <td className="num">{m.calls}</td>
              <td className="num">{m.input_tokens}</td>
              <td className="num">{m.output_tokens}</td>
              <td className="num">{m.avg_latency_ms} ms</td>
              <td className="num">${(m.cost_usd ?? 0).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Recent Hey Kivi turns</h2>
      {data.turns.length === 0 && <div className="empty">No conversations yet.</div>}
      {data.turns.map((t: any) => (
        <details className="trace" key={t.id}>
          <summary>
            <span>{t.question?.slice(0, 110) ?? t.text.slice(0, 110)}</span>
            <span style={{ color: 'var(--muted-2)', fontSize: 12, whiteSpace: 'nowrap' }}>
              {t.outcome} · {t.latency_ms}ms · ${Number(t.cost_usd ?? 0).toFixed(5)}
            </span>
          </summary>
          <div className="body">
            <div className="step">
              <div className="kv">{t.text}</div>
            </div>
            {t.trace?.steps?.map((s: any, i: number) => (
              <div className="step" key={i}>
                <div className="step-name">
                  {s.tool}({JSON.stringify(s.args)})
                </div>
                <div className="kv">
                  {s.summary} · {s.ms}ms
                </div>
                {s.candidates?.length > 0 && (
                  <table className="cands">
                    <thead>
                      <tr>
                        <th>id</th>
                        <th>candidate</th>
                        <th className="num">fused</th>
                        <th className="num">vec</th>
                        <th className="num">bm25</th>
                        <th>in context</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.candidates.map((c: any) => (
                        <tr key={c.id}>
                          <td className={c.used ? 'used' : ''}>{c.id}</td>
                          <td className={c.used ? 'used' : ''}>{c.text.slice(0, 100)}</td>
                          <td className="num">{c.score}</td>
                          <td className="num">{c.vec}</td>
                          <td className="num">{c.bm25}</td>
                          <td>{c.used ? 'yes' : 'no — below floor'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
            {t.trace?.notes?.length > 0 && (
              <div className="step">
                <div className="kv" style={{ color: 'var(--amber)' }}>{t.trace.notes.join(' · ')}</div>
              </div>
            )}
          </div>
        </details>
      ))}

      <h2>Latest extraction decisions</h2>
      <p className="lede" style={{ marginBottom: 12 }}>
        What the memory writer did with the most recent dictations it read, including what it refused.
      </p>
      <table className="cands">
        <thead>
          <tr>
            <th>dictation</th>
            <th>decision</th>
            <th>reason</th>
          </tr>
        </thead>
        <tbody>
          {data.recentDecisions.map((r: any) => (
            <tr key={r.id}>
              <td>{r.dictation_id}</td>
              <td className={r.decision === 'rejected' || r.decision === 'skipped' ? '' : 'used'}>{r.decision}</td>
              <td>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ v, l }: { v: any; l: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}
