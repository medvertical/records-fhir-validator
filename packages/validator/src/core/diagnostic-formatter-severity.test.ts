import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { DiagnosticFormatter } from './diagnostic-formatter';

function issue(severity: ValidationIssue['severity']): ValidationIssue {
  return {
    aspect: 'structural',
    severity,
    message: `${severity} issue`,
  };
}

describe('DiagnosticFormatter severity aliases', () => {
  it('counts fatal as error and both information aliases as information', () => {
    const summary = new DiagnosticFormatter().toCLISummary(
      { resourceType: 'Patient', id: 'one' },
      [issue('fatal'), issue('error'), issue('information'), issue('info')],
    );

    expect(summary).toMatchObject({
      totalIssues: 4,
      errors: 2,
      warnings: 0,
      information: 2,
      isValid: false,
    });
  });

  it('normalizes malformed resource identity fields at the CLI boundary', () => {
    const formatter = new DiagnosticFormatter();

    expect(formatter.toCLISummary(42, [])).toMatchObject({
      resourceType: 'Unknown',
      resourceId: undefined,
      isValid: true,
    });
    expect(formatter.toCLISummary({ resourceType: 7, id: false }, [])).toMatchObject({
      resourceType: 'Unknown',
      resourceId: undefined,
    });
  });

  it('only emits links from normalized HTTP(S) specification bases', () => {
    const formatter = new DiagnosticFormatter();
    formatter.setSpecBaseUrl('https://example.com/fhir///?ignored=true#fragment');

    const [diagnostic] = formatter.toLSPDiagnostics([{
      severity: 'warning',
      code: 'custom-check',
      message: 'Custom check',
      resourceType: 'Patient',
    }]);

    expect(diagnostic.codeDescription?.href).toBe('https://example.com/fhir/patient.html');
    expect(() => formatter.setSpecBaseUrl('javascript:alert(1)')).toThrow(TypeError);
  });

  it('does not create a specification link from an unsafe resource type', () => {
    const [diagnostic] = new DiagnosticFormatter().toLSPDiagnostics([{
      severity: 'warning',
      code: 'custom-check',
      message: 'Custom check',
      resourceType: '../Patient',
    }]);

    expect(diagnostic.codeDescription).toBeUndefined();
  });
});
