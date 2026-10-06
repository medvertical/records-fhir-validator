import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Conformance resources an installed package ships among its examples: CPG
 * keeps the code systems and profiles its examples use (`chf-codes`,
 * `chf-egfr`) in `package/example` only. The reference validator loads every
 * folder of a package it installs, so these definitions exist for it. Callers
 * consult them only for a canonical that no package root declares.
 */
export type ExampleFolderDeclaration = { file: string; resourceType: string; url: string; version?: string };

const INDEXED_TYPES = new Set(['CodeSystem', 'ValueSet', 'StructureDefinition']);

let cached: { key: string; index: Promise<Map<string, ExampleFolderDeclaration[]>> } | null = null;

export async function exampleFolderDeclarations(
  directories: readonly string[],
  resourceType: string,
  canonical: string,
): Promise<ExampleFolderDeclaration[]> {
  return (await exampleFolderIndex(directories)).get(`${resourceType}|${canonical.split('|')[0]}`) ?? [];
}

export async function readExampleFolderResource<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Rebuilt when a store gains or loses a package, which changes its mtime. */
async function exampleFolderIndex(directories: readonly string[]): Promise<Map<string, ExampleFolderDeclaration[]>> {
  const stamps = await Promise.all(directories.map(directory =>
    fs.stat(directory).then(stat => `${directory}@${stat.mtimeMs}`, () => `${directory}@-`)));
  const key = stamps.join('\n');
  if (cached?.key !== key) cached = { key, index: buildIndex(directories) };
  return cached.index;
}

async function buildIndex(directories: readonly string[]): Promise<Map<string, ExampleFolderDeclaration[]>> {
  const index = new Map<string, ExampleFolderDeclaration[]>();
  for (const directory of directories) {
    const packages = await fs.readdir(directory).catch(() => [] as string[]);
    for (const packageName of packages.sort()) {
      const folder = path.join(directory, packageName, 'package', 'example');
      for (const declaration of await readFolderIndex(folder)) {
        const key = `${declaration.resourceType}|${declaration.url}`;
        index.set(key, [...(index.get(key) ?? []), declaration]);
      }
    }
  }
  return index;
}

async function readFolderIndex(folder: string): Promise<ExampleFolderDeclaration[]> {
  const parsed = await readExampleFolderResource<{ files?: Array<Record<string, unknown>> }>(
    path.join(folder, '.index.json'),
  );
  return (parsed?.files ?? []).flatMap(entry => {
    const { filename, resourceType, url, version } = entry;
    return typeof filename === 'string' && typeof url === 'string'
      && typeof resourceType === 'string' && INDEXED_TYPES.has(resourceType)
      ? [{ file: path.join(folder, filename), resourceType, url, ...(typeof version === 'string' ? { version } : {}) }]
      : [];
  });
}
