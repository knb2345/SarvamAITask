import { NextRequest, NextResponse } from 'next/server';
import { askHeyKivi } from '@/lib/agent';
import { config } from '@/lib/config';
import { db, ensureUser, migrate, newId } from '@/lib/db';
import { generate } from '@/lib/gemini';
import { extractBatch } from '@/lib/extract';
import { insertDictation } from '@/lib/ingest';
import type { Dictation } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Dictation.
 *
 * This is the half of the product memory is NOT allowed to touch, and the endpoint is
 * written so that is checkable rather than promised: the formatting prompt is built from
 * the style alone, no retrieval runs, and the request returns the exact prompt it used so
 * the interface can show it.
 *
 * Afterwards the dictation is stored and read by the memory writer — dictations feed
 * memory, memory never feeds dictation — so the person can watch what was learned from
 * what they just said, including when the answer is nothing.
 */

const STYLES: Record<string, string> = {
  message:
    'Write it as a short chat message. Keep their words. Fix punctuation and obvious recogniser errors. No greeting, no sign-off.',
  email:
    'Write it as an email body. Keep their words and their tone. Fix punctuation and obvious recogniser errors. No subject line.',
  ticket:
    'Write it as an issue description: what is wrong, where, and what should happen. Keep their words.',
  notes:
    'Write it as a note to self. Keep it terse and in their words. Fix punctuation and obvious recogniser errors.',
  doc: 'Write it as a paragraph of a document, in their voice. Fix punctuation and obvious recogniser errors.',
};

export async function POST(req: NextRequest) {
  migrate();
  const body = await req.json();
  const userId = body.userId || config.defaultUserId;
  ensureUser(userId);

  const spoken: string = (body.spoken ?? '').toString().trim();
  const app: string = body.app || 'slack';
  const style: string = STYLES[body.style] ? body.style : 'message';
  if (!spoken) return NextResponse.json({ error: 'nothing was said' }, { status: 400 });

  const system = [
    'You turn dictated speech into written text.',
    STYLES[style],
    'Return only the text. Never add information that was not spoken.',
  ].join('\n');

  const t0 = Date.now();
  let formatted = spoken;
  try {
    const res = await generate({
      system,
      contents: [{ role: 'user', parts: [{ text: spoken }] }],
      temperature: 0.2,
      purpose: 'dictate',
    });
    formatted = res.text || spoken;
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
  const formatMs = Date.now() - t0;

  const dictation: Dictation = {
    id: newId('d'),
    user_id: userId,
    spoken_at: new Date().toISOString(),
    app,
    context_label: body.context || null,
    style,
    duration_ms: Math.round((spoken.split(/\s+/).length / 2.6) * 1000),
    raw_asr: spoken,
    formatted,
    metadata_json: JSON.stringify({ device: 'demo-client', dictated_in_app: true }),
  };
  insertDictation(dictation);

  // Now the other direction: what, if anything, does this teach Kivi?
  let learned: any[] = [];
  let ignored: any[] = [];
  let sensitivity = 'work';
  try {
    const results = await extractBatch([dictation], 'dictate');
    const r = results.get(dictation.id);
    if (r) {
      sensitivity = r.sensitivity;
      ignored = r.ignored ?? [];
      learned = [
        ...(r.sensitivity === 'work' && r.episode?.summary
          ? [{ kind: 'episode', statement: r.episode.summary }]
          : []),
        ...r.memories.map((m) => ({ kind: m.kind, statement: m.statement, quote: m.quote })),
      ];
      db()
        .prepare(`UPDATE dictations SET sensitivity = ?, sensitivity_reason = ? WHERE id = ?`)
        .run(r.sensitivity, r.sensitivity_reason ?? null, dictation.id);
    }
  } catch {
    // Formatting already succeeded and the dictation is saved; learning from it can wait.
    learned = [];
  }

  return NextResponse.json({
    dictation: { id: dictation.id, app, style, spoken_at: dictation.spoken_at },
    raw: spoken,
    formatted,
    formatMs,
    // Returned so the interface can show that nothing from memory reached this prompt.
    promptUsed: system,
    memoryConsulted: false,
    learned,
    ignored,
    sensitivity,
  });
}
