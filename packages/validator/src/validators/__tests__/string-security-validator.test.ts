import { describe, expect, it } from 'vitest';
import { StringSecurityValidator } from '../string-security-validator';

describe('StringSecurityValidator', () => {
  it('flags real HTML tags in non-narrative strings', () => {
    const validator = new StringSecurityValidator();

    const issues = validator.validate({
      resourceType: 'Procedure',
      code: {
        text: 'unsafe <script>alert(1)</script>',
      },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'string-security-html',
      path: 'Procedure.code.text',
    }));
  });

  it('does not flag angle-bracket template placeholders as HTML', () => {
    const validator = new StringSecurityValidator();

    const issues = validator.validate({
      resourceType: 'Procedure',
      category: {
        coding: [{
          system: 'MediConnect',
          code: 'PR16<AdmissionYear>',
          display: 'PR16<AdmissionYear>',
        }],
      },
    });

    expect(issues).toHaveLength(0);
  });
});
