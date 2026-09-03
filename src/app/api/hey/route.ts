import { NextRequest, NextResponse } from 'next/server';
import { askHeyKivi, ensureConversation, saveTurn } from '@/lib/agent';
import { config } from '@/lib/config';
import { ensureUser, migrate } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  migrate();
  const body = await req.json();
  const userId = body.userId || config.defaultUserId;
  ensureUser(userId);
  const question: string = (body.question ?? '').toString().trim();
  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 });

  const conversationId = ensureConversation(userId, body.conversationId);
  saveTurn(conversationId, 'user', question);

  try {
    const result = await askHeyKivi(userId, question, body.history ?? []);
    const turnId = saveTurn(conversationId, 'kivi', result.answer, result);
    return NextResponse.json({ ...result, conversationId, turnId });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
