import { describe, expect, it } from 'vitest';
import { validateUcumCode } from '../ucum-validator';
import {
  buildInvalidUcumIssueDetails,
  buildInvalidUcumMessage,
} from '../../core/executors/terminology-ucum-rules';

describe('ucum-lhc suggestion engine (gap P-5)', () => {
  it('valid codes carry no suggestion', () => {
    expect(validateUcumCode('mg/dL')).toEqual({ valid: true });
  });

  it('suggests a correction for a code absent from the static table', () => {
    // `mmHg` is NOT in COMMON_UCUM_CORRECTIONS — only the ucum-lhc engine
    // can propose `mm[Hg]` here.
    const result = validateUcumCode('mmHg');
    expect(result.valid).toBe(false);
    expect(result.suggestion?.code).toBe('mm[Hg]');
  });

  it('threads the parser suggestion into issue details and message', () => {
    const result = validateUcumCode('mmHg');
    const path = 'Observation.valueQuantity.code';

    expect(buildInvalidUcumIssueDetails('mmHg', path, result.message, result.suggestion))
      .toEqual(expect.objectContaining({
        suggestedCode: 'mm[Hg]',
        fixHint: expect.stringContaining("'mm[Hg]'"),
      }));

    expect(buildInvalidUcumMessage('mmHg', path, result.message, result.suggestion))
      .toContain("Use 'mm[Hg]' in Quantity.code.");
  });

  it('still flags an unfixable invalid code without a suggestion', () => {
    const result = validateUcumCode('foobar');
    expect(result.valid).toBe(false);
    expect(result.suggestion).toBeUndefined();
  });
});
