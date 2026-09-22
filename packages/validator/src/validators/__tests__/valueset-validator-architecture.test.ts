import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), 'packages/validator/src/validators', file), 'utf8');
}

/**
 * Which components the facade composes is a rule in
 * config/module-boundaries.json. These two are not expressible there: one is
 * about a private method existing on a class, the other about a literal the
 * delegation sends to the terminology server.
 */
describe('ValueSetValidator architecture', () => {
  it('resolves code bindings inside the facade rather than exposing the step', () => {
    expect(source('valueset-validator.ts')).toContain('private async resolveCodeBinding(');
  });

  it('keeps direct membership checks on the server-validate-code path', () => {
    expect(source('valueset-membership-server-delegation.ts')).toContain("'server-validate-code'");
  });
});
