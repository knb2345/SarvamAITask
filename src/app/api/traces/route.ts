import { NextRequest, NextResponse } from 'next/server';
import { db, migrate } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  migrate();
  const limit = Number(new URL(req.url).searchParams.get('limit') || 20);
  const turns = db()
    .prepare(
      `SELECT t.id, t.conversation_id, t.text, t.outcome, t.trace_json, t.citations_json,
              t.latency_ms, t.input_tokens, t.output_tokens, t.cost_usd, t.created_at,
              (SELECT text FROM turns u WHERE u.conversation_id = t.conversation_id
                 AND u.role='user' AND u.created_at <= t.created_at
               ORDER BY u.created_at DESC LIMIT 1) AS question
       FROM turns t WHERE t.role = 'kivi' ORDER BY t.created_at DESC LIMIT ?`
    )
    .all(limit) as any[];

  const recentDecisions = db()
    .prepare(
      `SELECT ed.*, d.spoken_at, d.app, d.formatted
       FROM extraction_decisions ed JOIN dictations d ON d.id = ed.dictation_id
       ORDER BY ed.id DESC LIMIT 60`
    )
    .all();

  return NextResponse.json({
    turns: turns.map((t) => ({
      ...t,
      trace: t.trace_json ? JSON.parse(t.trace_json) : null,
      citations: JSON.parse(t.citations_json || '[]'),
    })),
    recentDecisions,
  });
}
