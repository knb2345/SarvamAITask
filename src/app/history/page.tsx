'use client';

import { useEffect, useState } from 'react';

export default function HistoryPage() {
  const [q, setQ] = useState('');
  const [app, setApp] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (app) p.set('app', app);
      fetch(`/api/dictations?${p}`).then((r) => r.json()).then((d) => setRows(d.dictations ?? []));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, app]);

  const apps = ['', 'slack', 'gmail', 'linear', 'notion', 'notes', 'whatsapp', 'docs'];

  return (
    <div className="page wide">
      <h1>Dictation history</h1>
      <p className="lede">
        Everything you have dictated, exactly as Kivi received it. This is the raw material — memory is
        derived from it, never the other way round.
      </p>

      <div className="filters">
        <input className="search" placeholder="Search what you said…" value={q} onChange={(e) => setQ(e.target.value)} />
        {apps.map((a) => (
          <button key={a || 'all'} className={`pill ${app === a ? 'on' : ''}`} onClick={() => setApp(a)}>
            {a || 'all apps'}
          </button>
        ))}
      </div>

      {rows.map((d) => (
        <div key={d.id}>
          <div className="drow" onClick={() => setOpen(open === d.id ? null : d.id)}>
            <span className="dtime">
              {new Date(d.spoken_at).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
            </span>
            <span className="dapp">{d.app}</span>
            <span className="dtext">
              {d.sensitivity === 'personal' && <span style={{ color: 'var(--muted-2)' }}>· personal · </span>}
              {d.formatted}
            </span>
          </div>
          {open === d.id && <DictationDetail id={d.id} />}
        </div>
      ))}
      {rows.length === 0 && <div className="empty">Nothing matches.</div>}
    </div>
  );
}

function DictationDetail({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch(`/api/dictations/${id}`).then((r) => r.json()).then(setData);
  }, [id]);
  if (!data) return <div className="detail">loading…</div>;

  return (
    <div className="detail">
      <div className="block">
        <h3>What was sent</h3>
        <div>{data.dictation.formatted}</div>
      </div>
      <div className="block">
        <h3>What the recogniser heard</h3>
        <div className="raw">{data.dictation.raw_asr}</div>
      </div>
      {data.dictation.sensitivity === 'personal' && (
        <div className="block">
          <h3>Kept out of Hey Kivi</h3>
          <div className="esrc">
            Kivi recognised this as personal rather than working material, so it learned nothing
            from it and will not use it to answer anything.
            {data.dictation.sensitivity_reason ? ` (${data.dictation.sensitivity_reason})` : ''}
          </div>
        </div>
      )}
      <div className="block">
        <h3>What Kivi kept from this</h3>
        {data.memories.length === 0 && (
          <div className="esrc">Nothing. Not everything is worth remembering.</div>
        )}
        {data.memories.map((m: any) => (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <span className={`kindtag ${m.kind}`}>{m.kind}</span> {m.statement}
          </div>
        ))}
      </div>
      {data.decisions.length > 0 && (
        <div className="block">
          <h3>And what it decided not to keep</h3>
          {data.decisions
            .filter((x: any) => x.decision === 'rejected' || x.decision === 'skipped')
            .map((x: any) => (
              <div className="esrc" key={x.id} style={{ marginBottom: 6 }}>
                {x.reason}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
