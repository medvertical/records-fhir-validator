import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Reading what one package declares: from the `.index.json` it ships, or from
 * its own files when that index is missing or does not account for them.
 */

const INDEXED_RESOURCE_TYPES = new Set(['ValueSet', 'CodeSystem']);

/** An index-less package larger than this is left opaque rather than read whole. */
const MAX_UNINDEXED_FILES = 4_000;

const MAX_PACKAGE_INDEX_BYTES = 8 * 1024 * 1024;

type PackageIndexFile = {
  filename?: unknown;
  resourceType?: unknown;
  url?: unknown;
  version?: unknown;
};

/** Where one package says a canonical lives, and at which version. */
export type CanonicalDeclaration = {
  packageName: string;
  filename: string;
  version?: string;
};

/** What one package declares, or null when it cannot be enumerated. */
export async function readPackageDeclarations(
  packageRoot: string,
  packageName: string,
): Promise<Array<[string, CanonicalDeclaration]> | null> {
  const files = await readPackageJsonFiles(packageRoot);
  if (files === null) return null;
  return await readPackageIndexEntries(packageRoot, packageName, files)
    ?? await readPackageFileCanonicals(packageRoot, packageName, files);
}

/** The package's own JSON files, or null when the directory cannot be read. */
async function readPackageJsonFiles(packageRoot: string): Promise<string[] | null> {
  try {
    return (await fs.readdir(packageRoot, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name);
  } catch {
    return null;
  }
}

async function readPackageIndexEntries(
  packageRoot: string,
  packageName: string,
  files: readonly string[],
): Promise<Array<[string, CanonicalDeclaration]> | null> {
  const indexPath = path.join(packageRoot, '.index.json');
  try {
    const stats = await fs.stat(indexPath);
    if (!stats.isFile() || stats.size > MAX_PACKAGE_INDEX_BYTES) return null;
    const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8')) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return null;
    if (!accountsForEveryFile(parsed.files, files)) return null;
    return parsed.files.flatMap(file => entryDeclarations(file, packageName));
  } catch {
    return null;
  }
}

/**
 * An index that leaves a file of the package unnamed says nothing about what
 * that file holds, so it cannot stand in for the package. Two installed
 * packages ship `"files": []` beside 25 resources; reading that as "declares
 * nothing" hid them, and the profile walker already rejects such an index for
 * the same reason.
 */
function accountsForEveryFile(entries: readonly unknown[], files: readonly string[]): boolean {
  const named = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const filename = (entry as { filename?: unknown }).filename;
    if (typeof filename === 'string') named.add(filename);
  }
  return files.every(file =>
    file === 'package.json' || file === '.index.json' || named.has(file));
}

function entryDeclarations(
  value: unknown,
  packageName: string,
  fallbackFilename?: string,
): Array<[string, CanonicalDeclaration]> {
  if (!value || typeof value !== 'object') return [];
  const file = value as PackageIndexFile;
  if (typeof file.resourceType !== 'string' || !INDEXED_RESOURCE_TYPES.has(file.resourceType)) return [];
  if (typeof file.url !== 'string' || file.url.length === 0) return [];
  const filename = typeof file.filename === 'string' && file.filename.length > 0
    ? file.filename
    : fallbackFilename;
  if (!filename) return [];
  return [[
    `${file.resourceType}|${file.url.split('|')[0]}`,
    {
      packageName,
      filename,
      ...(typeof file.version === 'string' && file.version.length > 0 ? { version: file.version } : {}),
    },
  ]];
}

/**
 * A package without `.index.json` is read once here rather than on every miss:
 * five such packages held 844 files and 323 ms of the 648 ms a miss used to
 * cost, so leaving them opaque would keep most of the problem.
 */
async function readPackageFileCanonicals(
  packageRoot: string,
  packageName: string,
  files: readonly string[],
): Promise<Array<[string, CanonicalDeclaration]> | null> {
  if (files.length > MAX_UNINDEXED_FILES) return null;

  const declarations: Array<[string, CanonicalDeclaration]> = [];
  for (const name of files) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(packageRoot, name), 'utf8')) as PackageIndexFile;
      declarations.push(...entryDeclarations(parsed, packageName, name));
    } catch { /* a file that does not parse simply declares nothing */ }
  }
  return declarations;
}
