import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The import boundary between the facade and the three component groups is
 * enforced by config/module-boundaries.json against the AST.
 *
 * This one constraint has no equivalent there: the facade composes the groups
 * and must not construct anything itself. Expressing it needs the shape of the
 * expressions, not the imports, so it stays a source check — deliberately the
 * only one left in this file. Earlier assertions here pinned the exact call
 * text, which broke on renaming an argument and said nothing about structure.
 */
describe('validator engine component architecture', () => {
  it('composes the component groups without constructing anything itself', () => {
    const facade = readFileSync(
      resolve(process.cwd(), 'packages/validator/src/core/validator-engine-components.ts'),
      'utf8',
    );

    expect(facade).not.toMatch(/\bnew\s+[A-Z]/);
  });
});
