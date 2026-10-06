import { describe, expect, it } from 'vitest';
import { validateCodingHygiene } from '../../core/executors/terminology-coding-hygiene-rules';
import { getCodeMetadata } from '../../issues/message-catalog';
import { SNOMED_EXPRESSION_SYNTAX_LIMITS } from '../snomed-expression-syntax';

const SNOMED_SYSTEM = 'http://snomed.info/sct';
const CODING_CODE_PATH = 'Observation.code.coding[0].code';

describe('SNOMED expression syntax hygiene evidence', () => {
  it.each([
    '100005',
    '===128045006',
    '128045006|Clinical term 😀|',
    '128045006+404684003:{363698007=(56459004:116676008=55641003)}',
    String.raw`128045006:363698007="a\"b\\c",116676008=#-0.5,609096000=TRUE`,
  ])('P: creates no local membership or syntax issue for %s', code => {
    expect(validateCodingHygiene(observation(code), [])).toEqual([]);
  });

  it.each(['276885007x', '128045006:363698007=#01', '128045006:{363698007=56459004}x'])(
    'N: reports %s as a controlled syntax error without membership or display authority', code => {
      const issues = validateCodingHygiene(observation(code), []);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        code: 'terminology-code-invalid', severity: 'error', aspect: 'terminology', path: CODING_CODE_PATH,
        details: { reason: 'snomed-expression-syntax', syntaxOffset: expect.any(Number), syntaxExpected: expect.any(String) },
      });
      expect(issues[0].details).not.toHaveProperty('suggestedCode');
      expectNoTerminologyAuthority(issues[0].details);
    },
  );

  it('keeps the established check-digit diagnostic as the sole invalid issue for a bare identifier', () => {
    const issues = validateCodingHygiene(observation('161511005'), []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'terminology-code-invalid', path: CODING_CODE_PATH, details: { reason: 'snomed-check-digit' },
    });
  });

  it('keeps the established FHIR whitespace diagnostic as the sole invalid issue at its path', () => {
    const issues = validateCodingHygiene(observation(' 276885007x'), []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'terminology-code-invalid', path: CODING_CODE_PATH, details: { reason: 'code-whitespace' },
    });
  });

  it('deduplicates an existing invalid issue at the same code path', () => {
    const resource = observation('276885007x');
    const existing = validateCodingHygiene(resource, []);
    expect(existing).toHaveLength(1);
    expect(validateCodingHygiene(resource, existing)).toEqual([]);
  });

  it.each([
    ['input-length-limit', `128045006|${'x'.repeat(SNOMED_EXPRESSION_SYNTAX_LIMITS.maxInputLength)}|`],
    ['nesting-depth-limit', '128045006:363698007=('.repeat(65) + '56459004' + ')'.repeat(65)],
  ])('U: reports %s as incomplete syntax, without an invalid-code or membership finding', (reason, code) => {
    const issues = validateCodingHygiene(observation(code), []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'terminology-snomed-syntax-unverified', severity: 'information', aspect: 'terminology', path: CODING_CODE_PATH,
      details: {
        reason: 'snomed-expression-syntax-limit', syntaxLimitReason: reason,
        syntaxLimit: expect.any(Number), validationComplete: false, validationStatus: 'incomplete',
      },
    });
    expectNoTerminologyAuthority(issues[0].details);
    expect(issues[0].humanReadable).toBe(issues[0].message);
    expect(issues[0].humanReadable).toContain(reason);
    expect(issues[0].humanReadable).toContain('syntax validation is incomplete');
    expect(validateCodingHygiene(observation(code), issues)).toEqual([]);
  });

  it('registers the syntax-unverified code with its own terminology and information metadata', () => {
    expect(getCodeMetadata('terminology-snomed-syntax-unverified')).toMatchObject({
      aspect: 'terminology', severity: 'information',
    });
  });

  it('does not impose SCG syntax on another code system', () => {
    expect(validateCodingHygiene(observation('276885007x', 'https://example.test/codes'), [])).toEqual([]);
  });
});

function observation(code: string, system = SNOMED_SYSTEM): unknown {
  return { resourceType: 'Observation', code: { coding: [{ system, code, display: 'Unverified display' }] } };
}

function expectNoTerminologyAuthority(details: Record<string, unknown> | undefined): void {
  for (const marker of [
    'membership', 'valid', 'codeSystemMembership', 'codeSystemVersion', 'terminologySource',
    'localCodeSystemAuthority', 'localDisplayAuthority', 'display', 'expectedDisplay', 'displayLanguage',
  ]) expect(details).not.toHaveProperty(marker);
}
