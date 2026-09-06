'use client';

import { useState } from 'react';

const APPS = ['slack', 'gmail', 'linear', 'notion', 'notes', 'whatsapp', 'docs'];
const STYLES = ['message', 'email', 'ticket', 'notes', 'doc'];

const EXAMPLES = [
  'um so quick update the h d f c sandbox is stable now and davika ships the new screens on thursday the ledger migration is the only real risk left',
  'note to self from now on i want every standup update as three short bullets no paragraphs',
  'hey can you drop me the latest figma link when you get a sec',
];

export default function DictatePage() {
  const [spoken, setSpoken] = useState('');
  const [app, setApp] = useState('slack');
  const [style, setStyle] = useState('message');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  async function dictate() {
    if (!spoken.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch('/api/dictate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spoken, app, style }),
      }).then((x) => x.json());
      setResult(r);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Dictation</h1>
      <p className="lede">
        The half of Kivi that memory never touches. Speech becomes text using the style you chose
        and nothing else — so the same sentence comes out the same way next month. What you dictate
        does feed memory afterwards; memory never feeds this.
      </p>

      <div className="filters">
        {APPS.map((a) => (
          <button key={a} className={`pill ${app === a ? 'on' : ''}`} onClick={() => setApp(a)}>
            {a}
          </button>
        ))}
      </div>
      <div className="filters">
        {STYLES.map((s) => (
          <button key={s} className={`pill ${style === s ? 'on' : ''}`} onClick={() => setStyle(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="composer-inner" style={{ alignItems: 'stretch' }}>
        <textarea
          rows={4}
          value={spoken}
          placeholder="Say something — type it the way speech arrives, no punctuation needed…"
          onChange={(e) => setSpoken(e.target.value)}
        />
        <button className="mic" disabled={busy || !spoken.trim()} onClick={dictate} title="Dictate">
          {busy ? '…' : '↑'}
        </button>
      </div>

      {!result && (
        <div className="starters">
          {EXAMPLES.map((e) => (
            <button key={e} className="starter" onClick={() => setSpoken(e)}>
              {e.slice(0, 62)}…
            </button>
          ))}
        </div>
      )}

      {busy && (
        <div className="thinking" style={{ marginTop: 20 }}>
          <span className="pulse" /> writing it down…
        </div>
      )}

      {result?.error && <div className="banner" style={{ marginTop: 20 }}>{result.error}</div>}

      {result && !result.error && (
        <>
          <div className="detail" style={{ marginTop: 24 }}>
            <div className="block">
              <h3>What the recogniser heard</h3>
              <div className="raw">{result.raw}</div>
            </div>
            <div className="block">
              <h3>What Kivi wrote · {result.dictation.style} · {result.dictation.app} · {result.formatMs}ms</h3>
              <div style={{ whiteSpace: 'pre-wrap' }}>{result.formatted}</div>
            </div>
            <div className="block" style={{ marginBottom: 0 }}>
              <h3>Memory was not consulted</h3>
              <div className="esrc">
                Nothing was retrieved and no memory reached this. The style decided everything.{' '}
                <button className="linkish" onClick={() => setShowPrompt(!showPrompt)}>
                  {showPrompt ? 'hide the instructions used' : 'see the instructions used'}
                </button>
              </div>
              {showPrompt && <div className="raw" style={{ marginTop: 10 }}>{result.promptUsed}</div>}
            </div>
          </div>

          <div className="detail">
            <div className="block" style={{ marginBottom: result.ignored?.length ? 18 : 0 }}>
              <h3>
                {result.sensitivity === 'work'
                  ? 'What Kivi learned from it'
                  : 'Kivi learned nothing from it'}
              </h3>
              {result.sensitivity !== 'work' && (
                <div className="esrc">
                  This was recognised as {result.sensitivity === 'secret' ? 'a credential' : 'personal'} rather
                  than working material, so no memory was written.
                </div>
              )}
              {result.sensitivity === 'work' && result.learned?.length === 0 && (
                <div className="esrc">Nothing worth keeping. Most dictations teach Kivi nothing.</div>
              )}
              {result.learned?.map((m: any, i: number) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <span className={`kindtag ${m.kind}`}>{m.kind}</span> {m.statement}
                  {m.quote && <div className="equote"><em>“{m.quote}”</em></div>}
                </div>
              ))}
            </div>
            {result.ignored?.length > 0 && (
              <div className="block" style={{ marginBottom: 0 }}>
                <h3>And what it decided not to keep</h3>
                {result.ignored.map((x: any, i: number) => (
                  <div className="esrc" key={i} style={{ marginBottom: 6 }}>
                    {x.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
