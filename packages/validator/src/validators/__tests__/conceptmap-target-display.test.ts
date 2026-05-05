import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TerminologyResourceValidator } from '../terminology-resource-validator';
import { valueSetCache } from '../valueset-cache';

describe('TerminologyResourceValidator — ConceptMap target-display checks', () => {
  const validator = new TerminologyResourceValidator();

  const targetCsUrl = 'http://example.org/target-cs';

  beforeEach(() => {
    valueSetCache.clear();
    valueSetCache.setCodeSystem(targetCsUrl, {
      resourceType: 'CodeSystem',
      url: targetCsUrl,
      content: 'complete',
      concept: [
        { code: 'c1', display: 'display 1' },
        { code: 'c2', display: 'Display 2' },
      ],
    } as any);
  });

  afterEach(() => {
    valueSetCache.clear();
  });

  function cm(group: any) {
    return {
      resourceType: 'ConceptMap',
      url: 'http://example.org/cm',
      status: 'active',
      group: [group],
    };
  }

  it('flags target display mismatching the CodeSystem display', () => {
    const issues = validator.validate(cm({
      source: 'http://example.org/source',
      target: targetCsUrl,
      element: [
        { code: 'src1', target: [{ code: 'c1', display: 'Code 1', relationship: 'equivalent' }] },
      ],
    }));
    const mismatch = issues.filter(i => i.code === 'tx-conceptmap-target-display-invalid');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].severity).toBe('warning');
    expect(mismatch[0].path).toBe('ConceptMap.group[0].element[0].target[0].code');
    expect(mismatch[0].message).toContain("'Code 1'");
    expect(mismatch[0].message).toContain("'display 1'");
    expect(mismatch[0].message).toContain(`'${targetCsUrl}#c1'`);
  });

  it('treats display match as case-insensitive', () => {
    const issues = validator.validate(cm({
      source: 'http://example.org/source',
      target: targetCsUrl,
      element: [
        { code: 'src1', target: [{ code: 'c2', display: 'display 2', relationship: 'equivalent' }] },
      ],
    }));
    expect(issues.some(i => i.code === 'tx-conceptmap-target-display-invalid')).toBe(false);
  });

  it('emits the tx-only info message for known-large source CodeSystems', () => {
    const issues = validator.validate(cm({
      source: 'http://loinc.org',
      target: targetCsUrl,
      element: [
        { code: '80764-4', target: [{ code: 'c1', display: 'display 1', relationship: 'equivalent' }] },
      ],
    }));
    const txOnly = issues.filter(i => i.code === 'tx-conceptmap-source-tx-only');
    expect(txOnly).toHaveLength(1);
    expect(txOnly[0].severity).toBe('information');
    expect(txOnly[0].path).toBe('ConceptMap.group[0].source');
    expect(txOnly[0].message).toContain('only supported on the terminology server');
  });

  it('does not emit the tx-only info for custom source systems', () => {
    const issues = validator.validate(cm({
      source: 'http://example.org/source',
      target: targetCsUrl,
      element: [
        { code: 'src1', target: [{ code: 'c1', display: 'display 1', relationship: 'equivalent' }] },
      ],
    }));
    expect(issues.some(i => i.code === 'tx-conceptmap-source-tx-only')).toBe(false);
  });

  it('skips display checks when the target CodeSystem is not in cache', () => {
    const issues = validator.validate(cm({
      source: 'http://example.org/source',
      target: 'http://example.org/unknown-cs',
      element: [
        { code: 'src1', target: [{ code: 'c1', display: 'Anything', relationship: 'equivalent' }] },
      ],
    }));
    expect(issues.some(i => i.code === 'tx-conceptmap-target-display-invalid')).toBe(false);
  });

  it('skips entries when the target code is not in the CodeSystem', () => {
    const issues = validator.validate(cm({
      source: 'http://example.org/source',
      target: targetCsUrl,
      element: [
        { code: 'src1', target: [{ code: 'unknown-code', display: 'Anything', relationship: 'equivalent' }] },
      ],
    }));
    expect(issues.some(i => i.code === 'tx-conceptmap-target-display-invalid')).toBe(false);
  });

  it('does not run on non-ConceptMap resources', () => {
    const issues = validator.validate({
      resourceType: 'Patient',
      group: [{ source: 'http://loinc.org' }],
    });
    expect(issues.some(i => i.code?.startsWith('tx-conceptmap-'))).toBe(false);
  });
});
