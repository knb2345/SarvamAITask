'use client';

import { useCallback, useEffect, useState } from 'react';

type Memory = {
  id: string;
  kind: 'fact' | 'preference' | 'episode';
  statement: string;
  subject: string | null;
  confidence: number;
  support_count: number;
  status: string;
  source: string;
  first_seen_at: string;
  last_seen_at: string;
  evidence?: { dictation_id: string; quote: string; spoken_at: string; app: string }[];
};

const KINDS = [
  { key: '', label: 'Everything' },
  { key: 'fact', label: 'Facts' },
  { key: 'preference', label: 'How you like things' },
  { key: 'episode', label: 'What you dictated' },
];

export default function MemoryPage() {
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [inactive, setInactive] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (q) params.set('q', q);
    if (inactive) params.set('inactive', '1');
    const r = await fetch(`/api/memories?${params}`).then((x) => x.json());
    setMemories(r.memories ?? []);
    setLoading(false);
  }, [kind, q, inactive]);

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div className="page">
      <h1>What Kivi knows</h1>
      <p className="lede">
        Everything here was learned from something you dictated, and every line can be traced back to
        the words you said. Nothing here changes how dictation works — it is only used when you ask
        Hey Kivi for something.
      </p>

      <div className="filters">
        {KINDS.map((k) => (
          <button key={k.key} className={`pill ${kind === k.key ? 'on' : ''}`} onClick={() => setKind(k.key)}>
            {k.label}
          </button>
        ))}
        <input className="search" placeholder="Search your memory…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`pill ${inactive ? 'on' : ''}`} onClick={() => setInactive(!inactive)}>
          Show changed &amp; removed
        </button>
      </div>

      {loading && <div className="empty">reading…</div>}
      {!loading && memories.length === 0 && (
        <div className="empty">Nothing here yet. Kivi only remembers what you have actually said.</div>
      )}

      {memories.map((m) => (
        <MemoryCard key={m.id} memory={m} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} onChanged={load} />
      ))}
    </div>
  );
}

function MemoryCard({
  memory, open, onToggle, onChanged,
}: {
  memory: Memory;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.statement);

  useEffect(() => {
    if (open && !detail) fetch(`/api/memories/${memory.id}`).then((r) => r.json()).then(setDetail);
  }, [open, detail, memory.id]);

  async function act(action: string, body: any = {}) {
    await fetch(`/api/memories/${memory.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    setEditing(false);
    setDetail(null);
    onChanged();
  }

  const evidence = detail?.evidence ?? memory.evidence ?? [];

  return (
    <div className={`mcard ${memory.status}`}>
      <div className="mcard-top">
        <div style={{ flex: 1 }}>
          {editing ? (
            <textarea
              className="search"
              style={{ width: '100%', borderRadius: 10, minHeight: 64 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          ) : (
            <div className="mstatement">{memory.statement}</div>
          )}
          <div className="mmeta">
            <span>
              {memory.support_count === 1 ? 'said once' : `said ${memory.support_count} times`}
            </span>
            <span>since {memory.first_seen_at.slice(0, 10)}</span>
            {memory.source !== 'inferred' && <span>{memory.source.replace('_', ' ')}</span>}
            {memory.status !== 'active' && <span>{memory.status}</span>}
            {memory.confidence < 0.85 && <span>held loosely</span>}
          </div>
        </div>
        <span className={`kindtag ${memory.kind}`}>{memory.kind}</span>
      </div>

      {open && (
        <div className="evidence">
          <div className="esrc" style={{ marginBottom: 6 }}>
            {evidence.length ? 'Kivi learned this from:' : 'You told Kivi this directly.'}
          </div>
          {evidence.map((e: any) => (
            <div key={e.dictation_id}>
              <div className="equote">
                <em>“{e.quote}”</em>
              </div>
              <div className="esrc">
                {new Date(e.spoken_at).toLocaleString()} · {e.app} · {e.dictation_id}
              </div>
            </div>
          ))}
          {detail?.supersedes && (
            <div className="esrc" style={{ marginTop: 10 }}>
              Replaced an earlier version: “{detail.supersedes.statement}”
            </div>
          )}
          {detail?.supersededBy && (
            <div className="esrc" style={{ marginTop: 10 }}>
              No longer current — replaced by: “{detail.supersededBy.statement}”
            </div>
          )}
          {detail?.revisions?.length > 1 && (
            <div className="esrc" style={{ marginTop: 10 }}>
              {detail.revisions.length} changes recorded · last: {detail.revisions.at(-1).action} ·{' '}
              {detail.revisions.at(-1).reason}
            </div>
          )}
        </div>
      )}

      <div className="mactions">
        <button className="linkish" onClick={onToggle}>
          {open ? 'hide' : 'where did this come from?'}
        </button>
        {memory.status === 'active' && !editing && (
          <>
            <button className="linkish" onClick={() => setEditing(true)}>
              fix it
            </button>
            <button className="linkish" onClick={() => act('forget')}>
              forget it
            </button>
          </>
        )}
        {editing && (
          <>
            <button className="linkish" onClick={() => act('amend', { statement: text })}>
              save
            </button>
            <button className="linkish" onClick={() => setEditing(false)}>
              cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
