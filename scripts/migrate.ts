import { migrate } from '../src/lib/db';
import { config } from '../src/lib/config';

const ran = migrate();
console.log(ran.length ? `applied: ${ran.join(', ')}` : 'database already up to date');
console.log(`database: ${config.dbPath}`);
