import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { db, migrate } from '@/lib/db';
import { evidenceFor } from '@/lib/memory';
import { searchMemories } from '@/lib/retrieve';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  migrate();
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') || config.defaultUserId;
  const kind = url.searchParams.get('kind');
  const q = (url.searchParams.get('q') || '').trim();
  const showInactive = url.searchParams.get('inactive') === '1';

  if (q) {
    const found = await searchMemories({
      userId, query: q, kinds: kind ? [kind] : undefined, limit: 60, includeInactive: showInactive,
    });
    return NextResponse.json({ memories: found });
  }

  const params: any[] = [userId];
  let where = 'user_id = ?';
  if (!showInactive) where += ` AND status = 'active'`;
  if (kind) {
    where += ' AND kind = ?';
    params.push(kind);
  }
  const rows = db()
    .prepare(`SELECT * FROM memories WHERE ${where} ORDER BY last_seen_at DESC LIMIT 300`)
    .all(...params) as any[];
  for (const r of rows) r.evidence = evidenceFor(r.id).slice(0, 3);
  return NextResponse.json({ memories: rows });
}
