import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export interface CliFileFilterOptions {
  include: string[];
  exclude: string[];
}

export function splitPatterns(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function* walkJson(path: string): Generator<string> {
  const resolved = resolve(path);
  const stats = statSync(resolved);
  if (stats.isFile()) {
    if (resolved.endsWith('.json')) yield resolved;
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(resolved)) {
    yield* walkJson(join(resolved, entry));
  }
}

function normalizePathForGlob(path: string): string {
  const normalized = path.split(sep).join('/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function globToRegExp(glob: string): RegExp {
  const normalized = normalizePathForGlob(glob);
  let source = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      i++;
      if (normalized[i + 1] === '/') {
        source += '(?:.*/)?';
        i++;
      } else {
        source += '.*';
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(path: string, patterns: string[]): boolean {
  const normalized = normalizePathForGlob(path);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function shouldIncludeFile(file: string, options: CliFileFilterOptions): boolean {
  const relativePath = normalizePathForGlob(relative(process.cwd(), file));
  const absolutePath = normalizePathForGlob(file);
  const includePatterns = options.include.length > 0 ? options.include : ['**/*.json'];
  const include = matchesAny(relativePath, includePatterns) || matchesAny(absolutePath, includePatterns);
  if (!include) return false;
  return !(matchesAny(relativePath, options.exclude) || matchesAny(absolutePath, options.exclude));
}
