import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { db, migrate } from '@/lib/db';
import { searchDictations } from '@/lib/retrieve';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  migrate();
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') || config.defaultUserId;
  const q = (url.searchParams.get('q') || '').trim();
  const app = url.searchParams.get('app');
  const limit = Number(url.searchParams.get('limit') || 60);

  if (q || app) {
    const found = await searchDictations({ userId, query: q, app, limit });
    return NextResponse.json({ dictations: found });
  }
  const rows = db()
    .prepare('SELECT * FROM dictations WHERE user_id = ? ORDER BY spoken_at DESC LIMIT ?')
    .all(userId, limit);
  return NextResponse.json({ dictations: rows });
}
