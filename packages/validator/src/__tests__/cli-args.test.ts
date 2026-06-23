import { describe, expect, it, vi } from 'vitest';
import { parseArgs, usage } from '../cli-args';

describe('CLI argument parsing', () => {
  it('parses defaults and repeatable filters', () => {
    expect(parseArgs([
      'fixtures',
      '--profile-url=http://example.test/Profile',
      '--fhir-version',
      'R4B',
      '--fail-on=warning',
      '--format=json',
      '--output',
      'report.json',
      '--summary-only',
      '--include',
      '**/*.fhir.json,extra/*.json',
      '--exclude',
      '**/drafts/**',
    ])).toEqual({
      paths: ['fixtures'],
      profileUrl: 'http://example.test/Profile',
      fhirVersion: 'R4B',
      failOn: 'warning',
      format: 'json',
      output: 'report.json',
      summaryOnly: true,
      include: ['**/*.fhir.json', 'extra/*.json'],
      exclude: ['**/drafts/**'],
    });
  });

  it('requires at least one input path', () => {
    expect(() => parseArgs(['--format=json'])).toThrow('At least one file or folder path is required');
  });

  it('rejects invalid enum options', () => {
    expect(() => parseArgs(['fixtures', '--fhir-version=R3'])).toThrow('--fhir-version must be one of: R4, R4B, R5, R6');
    expect(() => parseArgs(['fixtures', '--fail-on=critical'])).toThrow('--fail-on must be one of: error, warning, none');
    expect(() => parseArgs(['fixtures', '--format=yaml'])).toThrow('--format must be one of: text, json');
  });

  it('prints help and exits for help flags', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    try {
      expect(() => parseArgs(['--help'])).toThrow('exit');
      expect(logSpy).toHaveBeenCalledWith(usage());
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
