import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

/** Relative imports that exist at runtime (`import type` is erased by the compiler). */
function runtimeImports(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of code.matchAll(/^import\s+(?!type\s)([\s\S]*?)\s+from\s+'(\.[^']+)';/gm)) {
    const names = m[1]!;
    // `import { type A, type B } from` is erased too
    const inner = /^\{([\s\S]*)\}$/.exec(names.trim())?.[1];
    if (inner && inner.split(',').every((n) => !n.trim() || /^type\s/.test(n.trim()))) continue;
    out.push(resolve(dirname(file), m[2]!) + '.ts');
  }
  return out;
}

/**
 * A circular import between files leaves a class `undefined` while the other file is still
 * loading; in the compiled CommonJS build Nest then cannot resolve a constructor dependency and
 * the API does not start (the PodSpace release broke the deploy this way). Vitest loads modules
 * differently and does not reproduce it, so look for cycles in the import graph instead.
 */
describe('api import graph', () => {
  it('has no circular runtime imports', () => {
    const graph = new Map(sources(SRC).map((f) => [f, runtimeImports(f)]));
    const cycles: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (file: string, path: string[]) => {
      if (state.get(file) === 'done' || !graph.has(file)) return;
      if (state.get(file) === 'visiting') {
        const cycle = path.slice(path.indexOf(file)).concat(file);
        cycles.push(cycle.map((f) => f.slice(SRC.length + 1)).join(' → '));
        return;
      }
      state.set(file, 'visiting');
      for (const dep of graph.get(file)!) visit(dep, [...path, file]);
      state.set(file, 'done');
    };
    for (const file of graph.keys()) visit(file, []);
    expect(cycles).toEqual([]);
  });
});
