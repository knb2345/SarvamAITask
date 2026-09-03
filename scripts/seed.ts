// Seeds the demo database from the committed corpus. Idempotent: run db:reset first for a clean state.
import { execSync } from 'node:child_process';
execSync('npx tsx scripts/ingest.ts corpus/dictations.jsonl', { stdio: 'inherit' });
