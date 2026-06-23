import { describe, expect, it } from 'vitest';
import { issueMessage, issuePath, renderCliOutput, severityOf } from '../cli-renderer';
import type { CliOptions, CliSummary, FileResult } from '../cli-types';

const baseOptions: Pick<CliOptions, 'format' | 'summaryOnly'> = {
  format: 'text',
  summaryOnly: false,
};

const summary: CliSummary = {
  files: 2,
  errors: 1,
  warnings: 1,
  issues: 2,
};

const results: FileResult[] = [
  {
    file: 'fixtures/patient.json',
    resourceType: 'Patient',
    profileUrl: 'http://hl7.org/fhir/StructureDefinition/Patient',
    issues: [
      {
        severity: 'warning',
        path: 'Patient.name[0]',
        code: 'business-rule',
        message: 'Name is incomplete',
      },
      {
        severity: 'error',
        code: 'required',
      },
    ],
  },
  {
    file: 'fixtures/bad.json',
    error: 'Could not parse JSON: Unexpected end of JSON input',
    issues: [],
  },
];

describe('CLI renderer', () => {
  it('renders full text output with issue fallbacks and parse errors', () => {
    expect(renderCliOutput(summary, results, baseOptions)).toBe([
      'WARNING fixtures/patient.json Patient.name[0] business-rule: Name is incomplete',
      'ERROR fixtures/patient.json <resource> required: required',
      'ERROR fixtures/bad.json: Could not parse JSON: Unexpected end of JSON input',
      'Validated 2 file(s): 1 error(s), 1 warning(s), 2 issue(s).',
    ].join('\n'));
  });

  it('renders summary-only text output', () => {
    expect(renderCliOutput(summary, results, { ...baseOptions, summaryOnly: true })).toBe(
      'Validated 2 file(s): 1 error(s), 1 warning(s), 2 issue(s).',
    );
  });

  it('renders summary-only JSON without per-file results', () => {
    const rendered = renderCliOutput(summary, results, { format: 'json', summaryOnly: true });

    expect(JSON.parse(rendered)).toEqual({ summary });
    expect(rendered).not.toContain('fixtures/patient.json');
  });

  it('renders full JSON output with per-file results', () => {
    expect(JSON.parse(renderCliOutput(summary, results, { format: 'json', summaryOnly: false }))).toEqual({
      summary,
      results,
    });
  });

  it('normalizes issue fields from validator-like objects', () => {
    expect(severityOf({})).toBe('information');
    expect(issuePath({ path: '' })).toBe('<resource>');
    expect(issueMessage({ code: 'unknown' })).toBe('unknown');
  });
});
