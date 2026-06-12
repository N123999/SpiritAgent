import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(desktopRoot, '.env');

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
