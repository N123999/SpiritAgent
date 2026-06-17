#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const sections = ['dependencies', 'optionalDependencies', 'peerDependencies'];

for (const section of sections) {
  const deps = pkg[section];
  if (!deps || typeof deps !== 'object') {
    continue;
  }
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === 'string' && spec.startsWith('file:')) {
      console.error(`Cannot publish ${pkg.name}: ${section}.${name} uses ${spec}`);
      process.exit(1);
    }
  }
}
