import { promises as fs } from 'node:fs';
import path from 'node:path';
import { packageFileSignature } from '../package/package-file-read-authority.js';
import { isBatchProfileMetadataCacheActive } from '../validation-dependency-snapshot.js';
import { readProfileFileIdentityResult, readProfileFileIdentityWithSignature } from './sd-loader-package-profile-reader.js';

interface ProfileIdentity { resourceType: 'StructureDefinition'; url: string; version?: string; fhirVersion?: unknown }
export interface ProfileDescriptor { sd: ProfileIdentity; filename: string; sha256: string }
export type FallbackInventory = { status: 'read'; boundary: string; profiles: ProfileDescriptor[] }
  | { status: 'unavailable'; cause: string };
interface FileStamp { filename: string; signature: string }
interface CatalogEntry { inventory: Extract<FallbackInventory, { status: 'read' }>; directorySignature: string;
  files: FileStamp[]; bytes: number }

const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
const MAX_CATALOG_ENTRIES = 128;
const catalog = new Map<string, CatalogEntry>();
let catalogBytes = 0;
let catalogGeneration = 0;

export function clearProfileReferenceFallbackCatalog(): void {
  catalogGeneration++;
  catalog.clear(); catalogBytes = 0;
}

/** Reuse a complete scan only while every scanned file still names the same physical bytes. */
export async function readFallbackInventory(directory: string): Promise<FallbackInventory> {
  // Callback-bearing runs already bound inventories to their per-batch metadata scope.
  // Rechecking every file across that path costs more than the direct scan on cold Bulk runs.
  if (isBatchProfileMetadataCacheActive()) return scanUncached(directory);
  const generation = catalogGeneration;
  const key = path.resolve(directory);
  const existing = catalog.get(key);
  if (existing && await matchesCatalog(directory, existing) && generation === catalogGeneration) {
    catalog.delete(key); catalog.set(key, existing);
    return existing.inventory;
  }
  if (existing && catalog.get(key) === existing) discard(key);
  const scanned = await scan(directory);
  if (scanned.status === 'read' && generation === catalogGeneration) retain(key, scanned);
  return scanned.inventory;
}

async function scanUncached(directory: string): Promise<FallbackInventory> {
  try {
    const boundary = await fs.realpath(directory);
    const filenames = await listCandidateFiles(directory);
    const profiles: ProfileDescriptor[] = [];
    for (let offset = 0; offset < filenames.length; offset += 8) {
      const chunk = filenames.slice(offset, offset + 8);
      const results = await Promise.all(chunk.map(filename => readProfileFileIdentityResult(directory, filename, boundary)));
      for (const [position, filename] of chunk.entries()) {
        const result = results[position];
        if (result.status === 'unavailable') return result;
        if (result.status === 'not-profile') continue;
        const { resourceType, url, version, fhirVersion } = result.profile;
        profiles.push({ filename, sha256: result.sha256, sd: { resourceType, url,
          ...(version !== undefined ? { version } : {}), ...(fhirVersion !== undefined ? { fhirVersion } : {}) } });
      }
    }
    return { status: 'read', boundary, profiles };
  } catch { return { status: 'unavailable', cause: 'package-unreadable' }; }
}

async function scan(directory: string): Promise<{ status: 'read'; inventory: Extract<FallbackInventory, { status: 'read' }>;
  directorySignature: string; files: FileStamp[] } | { status: 'unavailable'; inventory: FallbackInventory }> {
  try {
    const boundary = await fs.realpath(directory);
    const owner = await readDirectorySignature(boundary);
    const filenames = await listCandidateFiles(directory);
    const profiles: ProfileDescriptor[] = [];
    const files: FileStamp[] = [];
    for (let offset = 0; offset < filenames.length; offset += 8) {
      const chunk = filenames.slice(offset, offset + 8);
      const results = await Promise.all(chunk.map(filename => readProfileFileIdentityWithSignature(directory, filename, boundary)));
      for (const [position, filename] of chunk.entries()) {
        const result = results[position];
        if (result.status === 'unavailable') return { status: 'unavailable', inventory: result };
        files.push({ filename, signature: result.signature });
        if (result.status === 'not-profile') continue;
        const { resourceType, url, version, fhirVersion } = result.profile;
        profiles.push({ filename, sha256: result.sha256, sd: { resourceType, url,
          ...(version !== undefined ? { version } : {}), ...(fhirVersion !== undefined ? { fhirVersion } : {}) } });
      }
    }
    if (owner !== await readDirectorySignature(boundary) || await fs.realpath(directory) !== boundary) {
      return { status: 'unavailable', inventory: { status: 'unavailable', cause: 'source-changed' } };
    }
    return { status: 'read', inventory: { status: 'read', boundary, profiles }, directorySignature: owner, files };
  } catch { return { status: 'unavailable', inventory: { status: 'unavailable', cause: 'package-unreadable' } }; }
}

async function matchesCatalog(directory: string, entry: CatalogEntry): Promise<boolean> {
  try {
    const boundary = await fs.realpath(directory);
    if (boundary !== entry.inventory.boundary || await readDirectorySignature(boundary) !== entry.directorySignature) return false;
    const filenames = await listCandidateFiles(directory);
    if (filenames.length !== entry.files.length) return false;
    for (let offset = 0; offset < filenames.length; offset += 16) {
      const chunk = filenames.slice(offset, offset + 16);
      const signatures = await Promise.all(chunk.map(async filename => {
        const file = await fs.realpath(path.join(directory, filename));
        const stats = await fs.stat(file, { bigint: true });
        return stats.isFile() ? packageFileSignature(file, stats) : null;
      }));
      for (const [position, filename] of chunk.entries()) {
        const stored = entry.files[offset + position];
        if (stored.filename !== filename || stored.signature !== signatures[position]) return false;
      }
    }
    return await readDirectorySignature(boundary) === entry.directorySignature
      && await fs.realpath(directory) === boundary;
  } catch { return false; }
}

async function readDirectorySignature(directory: string): Promise<string> {
  const stats = await fs.stat(directory, { bigint: true });
  if (!stats.isDirectory()) throw new Error('Package source is not a directory');
  return `${directory}:${stats.dev}:${stats.ino}:${stats.mtimeNs}:${stats.ctimeNs}`;
}

async function listCandidateFiles(directory: string): Promise<string[]> {
  return (await fs.readdir(directory)).filter(file => file.endsWith('.json')
    && file !== 'package.json' && file !== '.index.json').sort();
}

function retain(key: string, scanned: Extract<Awaited<ReturnType<typeof scan>>, { status: 'read' }>): void {
  const bytes = Buffer.byteLength(JSON.stringify([scanned.inventory.profiles, scanned.files]));
  if (bytes > MAX_CATALOG_BYTES) return;
  discard(key);
  while (catalogBytes + bytes > MAX_CATALOG_BYTES || catalog.size >= MAX_CATALOG_ENTRIES) {
    const oldest = catalog.keys().next().value;
    if (oldest === undefined) break;
    discard(oldest);
  }
  catalog.set(key, { inventory: scanned.inventory, directorySignature: scanned.directorySignature,
    files: scanned.files, bytes });
  catalogBytes += bytes;
}

function discard(key: string): void {
  const previous = catalog.get(key);
  if (!previous) return;
  catalog.delete(key);
  catalogBytes -= previous.bytes;
}
