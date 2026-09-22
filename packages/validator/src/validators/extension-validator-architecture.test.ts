import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Import, symbol and construction boundaries for the extension validator are
 * enforced by config/module-boundaries.json against the AST.
 *
 * What is left here is the one constraint with no equivalent there: the
 * instance-validation module holds state in closures rather than a class, so
 * the rule is about the absence of a declaration kind, not of a named symbol.
 */
describe('extension validator architecture', () => {
  it('keeps the instance runtime free of class declarations', () => {
    const instanceValidation = readFileSync(
      resolve(process.cwd(), 'packages/validator/src/validators/extension-instance-validation.ts'),
      'utf8',
    );

    expect(instanceValidation).not.toMatch(/\bclass\s+/);
  });
});
