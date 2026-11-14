import { afterEach, describe, expect, it } from 'vitest';
import { getProfileSource, setProfileSource } from '../../persistence/profile-source.js';
import { ValueSetValidator } from '../valueset-validator.js';
import { expandFiniteValueSet } from '../finite-valueset-expansion.js';
import { codeSystemIdentitiesEquivalent, normalizeKnownCodeSystemCanonical } from '../code-system-canonical-aliases.js';
import { createValidationCanonicalAliasContext, withValidationCanonicalAliases } from '../../core/validation-canonical-alias-context.js';
import { isVerifiedCodeSystemResult } from '../code-system-validation-evidence.js';
import { resolveCodeSystemVersion, snapshotTerminologyConfig } from '../terminology-config-snapshot.js';
import type { CodeSystem, ValueSet } from '../valueset-types.js';

const preferred = 'http://human-phenotype-ontology.org';
const alias = 'http://purl.obolibrary.org/obo/hp.owl';
const version = '2026-09-01';
const url = 'https://example.test/ValueSet/hpo';
const source = getProfileSource();
const catalog: CodeSystem = { resourceType: 'CodeSystem', url: preferred, version, content: 'complete',
  count: 2, caseSensitive: true, concept: [{ code: 'HP:0001250' }, { code: 'HP:0001251' }] };
const valueSet: ValueSet = { resourceType: 'ValueSet', url, status: 'active', compose: {
  include: [{ system: alias, version }], exclude: [{ system: preferred, version, concept: [{ code: 'HP:0001251' }] }],
} };
afterEach(() => setProfileSource(source));

describe('registered HPO system identities', () => {
  it('shares configured editions without overriding an explicit version or accepting contradictory alias pins', () => {
    for (const configuredSystem of [alias, preferred]) {
      const config = snapshotTerminologyConfig({ defaultCodeSystemVersions: { [configuredSystem]: version } });
      expect(resolveCodeSystemVersion(config, alias)).toBe(version);
      expect(resolveCodeSystemVersion(config, preferred)).toBe(version);
      expect(resolveCodeSystemVersion(config, alias, '1900')).toBe('1900');
      expect(resolveCodeSystemVersion(config, `${alias}|1900`)).toBe('1900');
    }
    expect(snapshotTerminologyConfig({ defaultCodeSystemVersions: { [alias]: version, [preferred]: version } }).defaultCodeSystemVersions)
      .toEqual({ [preferred]: version });
    expect(() => snapshotTerminologyConfig({ defaultCodeSystemVersions: { [alias]: version, [preferred]: '1900' } }))
      .toThrow('conflicting default versions');
  });
  it('does not treat similar URLs or a canonical replacement as the same registered identity', () => {
    expect(codeSystemIdentitiesEquivalent(alias, preferred)).toBe(true);
    for (const other of [alias + '/extra', alias.replace('http:', 'https:'), alias.replace('hp.owl', 'HP.owl'),
      'http://purl.obolibrary.org/obo/mondo.owl']) expect(codeSystemIdentitiesEquivalent(other, preferred)).toBe(false);
    const predecessor = 'https://example.test/CodeSystem/predecessor';
    const replacement = 'https://example.test/CodeSystem/replacement';
    const configured = createValidationCanonicalAliasContext({ codeSystems: { [predecessor]: replacement } });
    withValidationCanonicalAliases(configured, () => {
      expect(normalizeKnownCodeSystemCanonical(predecessor)).toBe(replacement);
      expect(codeSystemIdentitiesEquivalent(predecessor, replacement)).toBe(false);
    });
  });

  it('shares exact local authority across both names without borrowing another edition or namespace', async () => {
    setProfileSource({ packageDirectories: [], findCanonicalResource: async (canonical, type, requestedVersion) =>
      type === 'CodeSystem' && canonical === preferred && (!requestedVersion || requestedVersion === version) ? catalog
        : type === 'ValueSet' && canonical === url ? valueSet : null });
    const validator = new ValueSetValidator(undefined, undefined, []);
    validator.setResolutionConfig({ strategy: 'local-only', servers: [], serverDelegation: { validateCodes: false, expandValueSets: false } });
    await validator.withSourceContext({ organizationId: 1, serverId: 1, fhirVersion: 'R4' }, async () => {
      for (const system of [alias, preferred]) {
        const positive = await validator.validateCodeInCodeSystem('HP:0001250', system, undefined, 'R4', version);
        expect(positive).toMatchObject({ valid: true });
        expect(await validator.validateCodeInLocalCodeSystemOnly('HP:0001250', system, undefined, 'R4', version))
          .toMatchObject({ valid: true });
        expect(await validator.validateCodeInCodeSystem('HP:9999999', system, undefined, 'R4', version)).toMatchObject({ valid: false });
        expect(await validator.resolveCodeBindingForBinding('HP:0001250', system, url, 'required', 'R4', undefined, version)).toBe('valid');
        expect(await validator.resolveCodeBindingForBinding('HP:0001251', system, url, 'required', 'R4', undefined, version)).toBe('invalid');
        expect(await validator.resolveCodeBindingForBinding('HP:9999999', system, url, 'required', 'R4', undefined, '1900')).toBe('unverified');
      }
      expect(await validator.validateCodeInLocalCodeSystemOnly('HP:0001250', alias, undefined, 'R4', '1900')).toBeNull();
      expect(isVerifiedCodeSystemResult(await validator.validateCodeInCodeSystem('HP:0001250', alias, undefined, 'R4', '1900'))).toBe(false);
      for (const configuredSystem of [alias, preferred]) {
        validator.setResolutionConfig({ strategy: 'local-only', servers: [], defaultCodeSystemVersions: { [configuredSystem]: '1900' } });
        expect(await validator.validateCodeInLocalCodeSystemOnly('HP:0001250', alias, undefined, 'R4')).toBeNull();
        expect(await validator.validateCodeInLocalCodeSystemOnly('HP:0001250', preferred, undefined, 'R4')).toBeNull();
        expect(await validator.validateCodeInLocalCodeSystemOnly('HP:0001250', alias, undefined, 'R4', version))
          .toMatchObject({ valid: true });
      }
    });
  });

  it('subtracts exclusions written under the other registered identifier in finite expansions', async () => {
    const result = await expandFiniteValueSet(valueSet, { valueSet: async () => null, codeSystem: async () => catalog });
    expect(result).toMatchObject({ coverage: 'complete', concepts: [{ system: preferred, version, code: 'HP:0001250' }] });
    const wrongEdition = await expandFiniteValueSet(valueSet, {
      valueSet: async () => null, codeSystem: async () => ({ ...catalog, version: '1900' }),
    });
    expect(wrongEdition.coverage).toBe('partial');
    const wrongSystem = await expandFiniteValueSet(valueSet, {
      valueSet: async () => null, codeSystem: async () => ({ ...catalog, url: alias.replace('hp.owl', 'mondo.owl') }),
    });
    expect(wrongSystem.coverage).toBe('partial');
  });

  it('deduplicates a compose union of the same codes under both registered identifiers', async () => {
    const result = await expandFiniteValueSet({ ...valueSet, compose: { include: [
      { system: preferred, concept: [{ code: 'HP:0001250' }] }, { system: alias, concept: [{ code: 'HP:0001250' }] },
    ] } }, { valueSet: async () => null, codeSystem: async () => catalog });
    expect(result.coverage).toBe('complete');
    expect(result.concepts).toHaveLength(1);
  });
});
