import { logger } from '../logger.js';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';

/**
 * A package store that is not there is a legitimate empty answer — a configured
 * store simply has nothing installed yet. A store that exists but cannot be
 * read is not: collapsing both into an empty list makes a permissions or I/O
 * failure indistinguishable from "nothing is installed", and profile and
 * ValueSet resolution then quietly fall back to whatever else it can find.
 *
 * The distinction is the errno, so these helpers keep the empty result (the
 * callers must stay non-throwing) and make the second case visible instead.
 */

/** Filesystem failures worth naming. Anything outside the list stays a bare category. */
const REPORTABLE_ERRNO = new Set([
  'EACCES', 'EPERM', 'EIO', 'ELOOP', 'EMFILE', 'ENFILE',
  'ENOMEM', 'ENOTDIR', 'ENAMETOOLONG', 'EBUSY', 'EROFS',
]);

/** Report each path once: package lookups repeat per canonical and per run. */
const reportedPaths = new Set<string>();

/** A store with many broken files must not turn the log into the failure. */
const MAX_REPORTED_PATHS = 64;

export function isAbsentPathError(error: unknown): boolean {
  return errnoOf(error) === 'ENOENT';
}

/**
 * Logs an unreadable package store once per directory. An absent one is
 * silent, because absence is the answer rather than a failure to find one.
 */
export function reportUnreadablePackageStore(
  operation: string,
  directory: string,
  error: unknown,
): void {
  if (isAbsentPathError(error)) return;
  if (!claimReport(directory)) return;

  // A store path can carry a home directory or a tenant name, so it is
  // correlated by handle rather than printed; the errno is what to act on.
  // Both are narrowed here rather than in a helper, so the sensitive-logging
  // guard can see what reaches the call.
  const errno = errnoOf(error);
  logger.warn(
    `[${operation}] Package store could not be read and is being treated as empty`,
    {
      ...sensitiveValueMetadata(directory),
      failureCode: reportableErrno(errno),
    },
  );
}

/**
 * Logs a package file that exists but could not be read or parsed. Unlike a
 * store, absence is not an answer here: the caller found the entry in a
 * listing before opening it, so the file simply disappears from whatever it
 * was being indexed into — a profile or ValueSet that is installed then
 * resolves as "not found".
 */
export function reportUnreadablePackageResource(
  operation: string,
  filePath: string,
  error: unknown,
): void {
  if (!claimReport(filePath)) return;

  const errno = errnoOf(error);
  logger.warn(
    `[${operation}] Package file could not be read and is being skipped`,
    {
      ...sensitiveValueMetadata(filePath),
      failureCode: reportableErrno(errno),
    },
  );
}

function claimReport(path: string): boolean {
  if (reportedPaths.has(path)) return false;
  if (reportedPaths.size >= MAX_REPORTED_PATHS) return false;
  reportedPaths.add(path);
  return true;
}

function reportableErrno(errno: string | undefined): string {
  return errno && REPORTABLE_ERRNO.has(errno) ? errno : 'unknown';
}

/** Test seam: the report-once memory must not leak between cases. */
export function resetPackageStoreDiagnostics(): void {
  reportedPaths.clear();
}

function errnoOf(error: unknown): string | undefined {
  const value = (error as { code?: unknown } | null | undefined)?.code;
  return typeof value === 'string' ? value : undefined;
}
