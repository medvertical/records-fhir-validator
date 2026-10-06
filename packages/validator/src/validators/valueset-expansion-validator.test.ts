import { describe, expect, it } from 'vitest';
import { validateValueSetExpansion } from './valueset-expansion-validator';

describe('ValueSet expansion validation', () => {
  it('checks unversioned systems inside nested contains trees', () => {
    const issues = validateValueSetExpansion({
      identifier: 'urn:uuid:expansion',
      parameter: [{ name: 'offset', valueInteger: 0 }],
      contains: [{
        system: 'http://example.com/parent',
        code: 'parent',
        contains: [{
          system: 'http://example.com/nested',
          code: 'child',
        }],
      }],
    });

    expect(issues.filter(issue => issue.code === 'tx-valueset-expansion-system-no-version'))
      .toHaveLength(2);
  });

  it('uses used-codesystem parameters for nested expansion entries', () => {
    const issues = validateValueSetExpansion({
      identifier: 'urn:uuid:expansion',
      parameter: [{
        name: 'used-codesystem',
        valueUri: 'http://example.com/nested|1.0.0',
      }],
      contains: [{
        system: 'http://example.com/nested',
        code: 'child',
      }],
    });

    expect(issues.some(issue => issue.code === 'tx-valueset-expansion-system-no-version'))
      .toBe(false);
  });

  it('detects parent-filter anchors even when the extra code is nested', () => {
    const issues = validateValueSetExpansion({
      identifier: 'urn:uuid:expansion',
      parameter: [{ name: 'offset', valueInteger: 0 }],
      contains: [{
        contains: [{
          system: 'http://example.com/system',
          code: 'anchor',
          version: '1',
        }],
      }],
    }, {
      include: [{
        system: 'http://example.com/system',
        filter: [{ property: 'parent', op: '=', value: 'anchor' }],
      }],
    });

    expect(issues.some(issue => issue.code === 'tx-valueset-expansion-extra-code')).toBe(true);
  });

  it('terminates on cyclic in-memory contains trees', () => {
    const concept: Record<string, unknown> = {
      system: 'http://example.com/system',
      code: 'one',
      version: '1',
    };
    concept.contains = [concept];

    expect(() => validateValueSetExpansion({
      identifier: 'urn:uuid:expansion',
      parameter: [{ name: 'offset', valueInteger: 0 }],
      contains: [concept],
    })).not.toThrow();
  });

  it('returns recommendations rather than throwing for malformed expansion input', () => {
    const issues = validateValueSetExpansion(null);

    expect(issues.map(issue => issue.code)).toEqual([
      'tx-valueset-expansion-no-parameters',
      'tx-valueset-expansion-no-identifier',
    ]);
  });

  it('warns when the page holds more concepts, nested ones included, than the stated total leaves', () => {
    const concept = (code: string, contains?: unknown[]) => ({ system: 'http://example.com/cs', code, contains });
    const expansion = {
      identifier: 'urn:uuid:expansion',
      parameter: [{ name: 'offset', valueInteger: 0 }],
      total: 3,
      contains: [concept('a', [concept('a1'), concept('a2')]), concept('b')],
    };

    expect(validateValueSetExpansion(expansion).filter(issue => issue.code === 'tx-valueset-expansion-total-exceeded'))
      .toEqual([expect.objectContaining({
        severity: 'warning',
        message: 'The expansion offset (0) + the count of items (4) is greater than the stated total (3)',
      })]);
    expect(validateValueSetExpansion({ ...expansion, total: 4 })
      .some(issue => issue.code === 'tx-valueset-expansion-total-exceeded')).toBe(false);
  });
});
