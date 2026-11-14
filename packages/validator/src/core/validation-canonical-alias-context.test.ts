import { describe, expect, it } from 'vitest';
import { createValidationCanonicalAliasContext, withValidationCanonicalAliases } from './validation-canonical-alias-context.js';
import { codeSystemCanonicalsEquivalent, normalizeKnownCodeSystemCanonical } from '../validators/code-system-canonical-aliases.js';
import { normalizeKnownStructureDefinitionCanonicalUrl } from './sd-loader-version-utils.js';

const previous = 'https://example.test/CodeSystem/previous';
const current = 'https://example.test/CodeSystem/current';
const profile = 'https://example.test/StructureDefinition/old-name';
const renamed = 'https://example.test/StructureDefinition/new-name';

describe('host canonical aliases', () => {
  it('isolates aliases from concurrent and nested neutral invocations', async () => {
    const configured = createValidationCanonicalAliasContext({
      codeSystems: { [previous]: current },
      profiles: { [profile]: renamed },
    });
    const neutral = createValidationCanonicalAliasContext();
    let release: () => void = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    const [selected, unchanged] = await Promise.all([
      withValidationCanonicalAliases(configured, async () => {
        await pending;
        expect(codeSystemCanonicalsEquivalent(previous, current)).toBe(true);
        expect(withValidationCanonicalAliases(neutral, () => normalizeKnownCodeSystemCanonical(previous))).toBe(previous);
        return [normalizeKnownCodeSystemCanonical(previous), normalizeKnownStructureDefinitionCanonicalUrl(profile)];
      }),
      withValidationCanonicalAliases(neutral, async () => {
        expect(codeSystemCanonicalsEquivalent(previous, current)).toBe(false);
        release();
        await Promise.resolve();
        return normalizeKnownCodeSystemCanonical(previous);
      }),
    ]);
    expect(selected).toEqual([current, renamed]);
    expect(unchanged).toBe(previous);
    expect(normalizeKnownCodeSystemCanonical(previous)).toBe(previous);
  });

  it('rejects cycles and chains', () => {
    expect(() => createValidationCanonicalAliasContext({ codeSystems: { 'urn:a': 'urn:b', 'urn:b': 'urn:a' } })).toThrow('chained');
    expect(() => createValidationCanonicalAliasContext({ profiles: { 'urn:a': 'urn:a' } })).toThrow('Invalid');
  });
});
