import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAbsentPathError,
  reportUnreadablePackageResource,
  reportUnreadablePackageStore,
  resetPackageStoreDiagnostics,
} from './package-store-diagnostics';
import { logger } from '../logger';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata';

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error('boom'), { code });
}

describe('package store read diagnostics', () => {
  beforeEach(() => {
    resetPackageStoreDiagnostics();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats a missing store as absent rather than unreadable', () => {
    expect(isAbsentPathError(fsError('ENOENT'))).toBe(true);
    expect(isAbsentPathError(fsError('EACCES'))).toBe(false);
    expect(isAbsentPathError(new Error('no code'))).toBe(false);
  });

  it('stays silent for a store that simply is not there', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    reportUnreadablePackageStore('Store', '/packages', fsError('ENOENT'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('names the directory and the errno when the store cannot be read', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    reportUnreadablePackageStore('Store', '/packages', fsError('EACCES'));

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('treated as empty'),
      { ...sensitiveValueMetadata('/packages'), failureCode: 'EACCES' },
    );
  });

  it('does not leak an unrecognised errno into the log', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    reportUnreadablePackageStore('Store', '/packages', fsError('ESOMETHINGELSE'));

    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      ...sensitiveValueMetadata('/packages'),
      failureCode: 'unknown',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/packages');
  });

  it('reports each directory once, not once per lookup', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    reportUnreadablePackageStore('Store', '/packages', fsError('EIO'));
    reportUnreadablePackageStore('Store', '/packages', fsError('EIO'));
    reportUnreadablePackageStore('Store', '/other', fsError('EIO'));

    expect(warn).toHaveBeenCalledTimes(2);
  });

  // A file reaches the reporter only after a listing said it was there, so
  // ENOENT is a race or a broken link — not the "nothing installed" answer a
  // missing store gives.
  it('reports an unreadable package file even when it has just gone missing', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    reportUnreadablePackageResource('SDLoader', '/packages/p/package/sd.json', fsError('ENOENT'));

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('being skipped'),
      { ...sensitiveValueMetadata('/packages/p/package/sd.json'), failureCode: 'unknown' },
    );
  });

  it('caps how many paths one broken store can report', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    for (let index = 0; index < 100; index++) {
      reportUnreadablePackageResource('SDLoader', `/packages/p/package/${index}.json`, fsError('EIO'));
    }

    expect(warn).toHaveBeenCalledTimes(64);
  });
});
