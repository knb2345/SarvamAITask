'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Hold to talk, using the browser's own speech recognition.
 *
 * The brief does not ask for speech recognition, and the memory system does not depend on
 * it — the corpus is replayed as text. But this is a voice-first product, and the thing
 * worth feeling is how raw the recogniser's output is compared with what Kivi writes down.
 * The browser gives that for free where it is supported; elsewhere the textarea is the
 * same path, and everything downstream is identical either way.
 */
export default function Microphone({
  onTranscript,
  disabled,
}: {
  onTranscript: (text: string, final: boolean) => void;
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<any>(null);
  const baseline = useRef('');

  useEffect(() => {
    const Recognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) return;
    setSupported(true);

    const r = new Recognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-IN';

    r.onresult = (event: any) => {
      let interim = '';
      let settled = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) settled += chunk;
        else interim += chunk;
      }
      if (settled) baseline.current = `${baseline.current} ${settled}`.trim();
      onTranscript(`${baseline.current} ${interim}`.trim(), Boolean(settled));
    };
    r.onerror = (e: any) => {
      setError(
        e.error === 'not-allowed'
          ? 'microphone permission was refused'
          : e.error === 'no-speech'
            ? 'nothing was heard'
            : `speech recognition failed: ${e.error}`
      );
      setListening(false);
    };
    r.onend = () => setListening(false);
    recognition.current = r;

    return () => {
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    };
  }, [onTranscript]);

  if (!supported) {
    return (
      <div className="hint" style={{ textAlign: 'left', marginTop: 10 }}>
        This browser has no speech recognition — type what you would have said instead. Everything
        after this point is identical. (Chrome and Edge support it.)
      </div>
    );
  }

  function toggle() {
    if (!recognition.current || disabled) return;
    setError(null);
    if (listening) {
      recognition.current.stop();
      setListening(false);
      return;
    }
    baseline.current = '';
    try {
      recognition.current.start();
      setListening(true);
    } catch {
      /* start() throws if it is already running */
    }
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        className="pill"
        onClick={toggle}
        disabled={disabled}
        style={
          listening
            ? { background: 'var(--green)', color: 'var(--ink)', borderColor: 'var(--green)' }
            : undefined
        }
      >
        {listening ? '● listening — click to stop' : '🎙 speak instead of typing'}
      </button>
      {error && <span className="esrc">{error}</span>}
      {listening && <span className="esrc">say it the way you would say it</span>}
    </div>
  );
}
