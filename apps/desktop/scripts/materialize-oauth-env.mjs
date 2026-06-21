#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(desktopRoot, '.env');
const ensureForPackaging = process.argv.includes('--ensure-for-packaging');

const clientId = process.env.SPIRIT_GITHUB_OAUTH_CLIENT_ID?.trim() ?? '';

function writeEnvFile(value) {
  writeFileSync(envPath, `SPIRIT_GITHUB_OAUTH_CLIENT_ID=${value}\n`, 'utf8');
}

if (clientId) {
  writeEnvFile(clientId);
  process.exit(0);
}

if (ensureForPackaging) {
  writeEnvFile('');
  process.exit(0);
}

if (existsSync(envPath)) {
  process.exit(0);
}

if (process.env.GITHUB_ACTIONS === 'true') {
  console.error(
    'SPIRIT_GITHUB_OAUTH_CLIENT_ID is not set. Configure the repository secret before releasing Desktop.',
  );
  process.exit(1);
}

process.exit(0);
