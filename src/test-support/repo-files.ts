/**
 * Test-only: read files from the repository (shared API fixtures, mirrored sources) under Jest.
 * The app's tsconfig has no Node types, so the two built-ins used are typed here.
 */
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as { join: (...parts: string[]) => string };

const ROOT = path.join(__dirname, '../..');

export function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

export function readRepoJson<T>(relative: string): T {
  return JSON.parse(readRepoFile(relative)) as T;
}
