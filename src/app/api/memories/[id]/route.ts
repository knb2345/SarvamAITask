import { NextRequest, NextResponse } from 'next/server';
import { db, migrate } from '@/lib/db';
import { amendMemory, confirmMemory, evidenceFor, forgetMemory, getMemory, revisionsFor } from '@/lib/memory';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  migrate();
  const { id } = await ctx.params;
  const memory = getMemory(id);
  if (!memory) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const decisions = db()
    .prepare('SELECT * FROM extraction_decisions WHERE memory_id = ? ORDER BY id')
    .all(id);
  const supersedes = memory.supersedes_id ? getMemory(memory.supersedes_id) : null;
  const supersededBy = db().prepare('SELECT * FROM memories WHERE supersedes_id = ?').get(id) ?? null;
  return NextResponse.json({
    memory,
    evidence: evidenceFor(id),
    revisions: revisionsFor(id),
    decisions,
    supersedes,
    supersededBy,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  migrate();
  const { id } = await ctx.params;
  const body = await req.json();
  if (!getMemory(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  switch (body.action) {
    case 'forget':
      forgetMemory(id, 'user', body.reason || 'the person removed this from the memory page');
      break;
    case 'confirm':
      confirmMemory(id, 'the person confirmed this on the memory page');
      break;
    case 'amend':
      if (!body.statement) return NextResponse.json({ error: 'statement required' }, { status: 400 });
      await amendMemory(id, body.statement, 'user', 'the person rewrote this on the memory page');
      break;
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
  return NextResponse.json({ memory: getMemory(id) });
}
