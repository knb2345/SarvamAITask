import fs from 'node:fs';
import { config } from '../src/lib/config';
import { migrate } from '../src/lib/db';

for (const suffix of ['', '-wal', '-shm']) {
  const p = config.dbPath + suffix;
  if (fs.existsSync(p)) { fs.rmSync(p); console.log(`removed ${p}`); }
}
migrate();
console.log(`fresh database created at ${config.dbPath}`);
