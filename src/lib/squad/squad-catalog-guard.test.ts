import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_IN_SRC = ['PACTO_SQUADS_PREFIX', 'hydrateSquadsFromDisk', 'pacto_squads'] as const;

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      collectSourceFiles(path, files);
    } else if (/\.(ts|svelte)$/.test(ent.name) && ent.name !== 'squad-catalog-guard.test.ts') {
      files.push(path);
    }
  }
  return files;
}

function relativeFromRoot(absPath: string): string {
  return absPath.replace(`${process.cwd()}/`, '');
}

describe('squad catalog legacy guard', () => {
  it('src has no legacy squad localStorage hydrate paths', () => {
    const root = join(process.cwd(), 'src');
    const hits: string[] = [];
    for (const file of collectSourceFiles(root)) {
      const rel = relativeFromRoot(file);
      const text = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN_IN_SRC) {
        if (text.includes(token)) hits.push(`${rel}: ${token}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
