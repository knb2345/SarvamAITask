import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const d = new Database(config.dbPath);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  _db = d;
  return d;
}

export function migrate(): string[] {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const dir = path.join(process.cwd(), 'db', 'migrations');
  const applied = new Set(d.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name));
  const ran: string[] = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    d.exec('BEGIN');
    try {
      d.exec(sql);
      d.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      d.exec('COMMIT');
      ran.push(file);
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  }
  return ran;
}

export function ensureUser(id: string, displayName = 'Demo user') {
  db().prepare('INSERT OR IGNORE INTO users (id, display_name) VALUES (?, ?)').run(id, displayName);
}

export function dbSizeBytes(): number {
  try { return fs.statSync(config.dbPath).size; } catch { return 0; }
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
