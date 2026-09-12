/** Move dates by whole UTC days so a 5pm dictation remains a 5pm dictation. */
export function demoDateShift(newest: string, now = new Date()): number {
  const sourceDay = Date.parse(newest.slice(0, 10) + 'T00:00:00.000Z');
  const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  return today - 86_400_000 - sourceDay;
}

/** The corpus's last day is yesterday for reproducible relative-time questions. */
export function evaluationTime(newest: string): Date {
  return new Date(Date.parse(newest.slice(0, 10) + 'T12:00:00.000Z') + 86_400_000);
}

export function citationIds(text: string): string[] {
  return [...new Set(text.match(/\b[md]_[a-z0-9]+\b/g) ?? [])];
}
