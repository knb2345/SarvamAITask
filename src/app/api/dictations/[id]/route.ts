import { NextRequest, NextResponse } from 'next/server';
import { db, migrate } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  migrate();
  const { id } = await ctx.params;
  const dictation = db().prepare('SELECT * FROM dictations WHERE id = ?').get(id);
  if (!dictation) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const memories = db()
    .prepare(
      `SELECT m.*, e.quote FROM memory_evidence e JOIN memories m ON m.id = e.memory_id
       WHERE e.dictation_id = ? ORDER BY m.kind`
    )
    .all(id);
  const decisions = db()
    .prepare('SELECT * FROM extraction_decisions WHERE dictation_id = ? ORDER BY id')
    .all(id);
  return NextResponse.json({ dictation, memories, decisions });
}
