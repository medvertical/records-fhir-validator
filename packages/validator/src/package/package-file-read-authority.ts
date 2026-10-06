import { constants, promises as fs, type BigIntStats } from 'node:fs';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';

export type PackageFileRead = { status: 'read'; bytes: Buffer; boundary: string }
  | { status: 'absent'; boundary: string }
  | { status: 'unavailable'; cause: 'unsafe-file' | 'resource-too-large' | 'source-changed' };

/** Bind the size, identity and bytes of a package file to one physical read. */
export async function readStablePackageFile(
  directory: string, filename: string, maxBytes: number, expectedBoundary?: string,
): Promise<PackageFileRead> {
  const boundary = await fs.realpath(directory);
  if (expectedBoundary !== undefined && boundary !== expectedBoundary)
    return { status: 'unavailable', cause: 'source-changed' };
  const owner = await fs.stat(boundary, { bigint: true }).catch((error: unknown) => {
    if (hasErrorCode(error, ['ENOENT', 'ELOOP', 'ESTALE'])) return null;
    throw error;
  });
  if (!owner) return { status: 'unavailable', cause: 'source-changed' };
  const candidate = path.resolve(directory, filename);
  let file: string;
  try { file = await fs.realpath(candidate); } catch (error: unknown) {
    if (!hasErrorCode(error, ['ENOENT'])) throw error;
    if (!await isAbsentLeaf(candidate)) return { status: 'unavailable', cause: 'unsafe-file' };
    return await sameDirectoryOwner(directory, boundary, owner)
      ? { status: 'absent', boundary } : { status: 'unavailable', cause: 'source-changed' };
  }
  const relative = path.relative(boundary, file);
  if (!owner.isDirectory() || !relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return { status: 'unavailable', cause: 'unsafe-file' };
  try {
    const prior = await fs.stat(file, { bigint: true });
    if (!prior.isFile() || prior.size > BigInt(maxBytes))
      return { status: 'unavailable', cause: 'resource-too-large' };
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
      .catch((error: unknown) => {
        if (hasErrorCode(error, ['ENOENT', 'ELOOP', 'ESTALE'])) return null;
        throw error;
      });
    if (!handle) return { status: 'unavailable', cause: 'source-changed' };
    try {
      if (!sameFile(prior, await handle.stat({ bigint: true }))) return { status: 'unavailable', cause: 'source-changed' };
      const bytes = await readBoundBytes(handle, Number(prior.size));
      if (bytes.length > maxBytes) return { status: 'unavailable', cause: 'resource-too-large' };
      if (BigInt(bytes.length) !== prior.size || !sameFile(prior, await handle.stat({ bigint: true })))
        return { status: 'unavailable', cause: 'source-changed' };
      if (await fs.realpath(directory) !== boundary || await fs.realpath(candidate) !== file
        || !sameOwner(owner, await fs.stat(boundary, { bigint: true }))
        || !sameFile(prior, await fs.stat(file, { bigint: true })))
        return { status: 'unavailable', cause: 'source-changed' };
      return { status: 'read', bytes, boundary };
    } finally { await handle.close(); }
  } catch (error: unknown) {
    if (hasErrorCode(error, ['ENOENT', 'ELOOP', 'ESTALE'])) return { status: 'unavailable', cause: 'source-changed' };
    throw error;
  }
}

async function readBoundBytes(handle: FileHandle, priorSize: number): Promise<Buffer> {
  // One extra byte detects growth without an unbounded read to EOF.
  const buffer = Buffer.allocUnsafe(priorSize + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  return buffer.subarray(0, length);
}

async function isAbsentLeaf(candidate: string): Promise<boolean> {
  // Broken links are existing leaves, not evidence of an absent index.
  try { await fs.lstat(candidate); return false; }
  catch (error: unknown) { if (hasErrorCode(error, ['ENOENT'])) return true; throw error; }
}

async function sameDirectoryOwner(directory: string, boundary: string, owner: BigIntStats): Promise<boolean> {
  try { return await fs.realpath(directory) === boundary && sameOwner(owner, await fs.stat(boundary, { bigint: true })); }
  catch { return false; }
}

function sameOwner(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.isFile() && b.isFile() && sameOwner(a, b) && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function hasErrorCode(error: unknown, codes: string[]): boolean {
  return error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' && codes.includes(error.code);
}
