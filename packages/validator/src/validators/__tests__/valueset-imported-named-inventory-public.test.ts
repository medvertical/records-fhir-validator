import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource, type ProfileSourceContext } from '../../persistence/index.js';
import { ValueSetValidator, type CodeSystem } from '../valueset-validator.js';
import { isVerifiedCodeSystemResult } from '../code-system-validation-evidence.js';

type Result = Awaited<ReturnType<ValueSetValidator['validateCodeInCodeSystem']>>;
type Concept = NonNullable<CodeSystem['concept']>[number];
type Extension = { url: string; extension?: Extension[] } & Record<string, unknown>;
type FixtureConcept = Concept & {
  extension?: Extension[];
  designation?: Array<NonNullable<Concept['designation']>[number] & { extension: Extension[] }>;
};
type Fixture = CodeSystem & Record<string, unknown> & { count: number; extension: Extension[]; concept: FixtureConcept[] };
type ContractVariant = 'supported' | 'unsupported' | 'missing-contract' | 'detail-hash-mismatch';
type HostObservation = { system: string; version?: string; context?: ProfileSourceContext; scopeKey: string };

const SNOMED = 'http://snomed.info/sct';
const LOINC = 'http://loinc.org';
const OWN_EDITION = `${SNOMED}/100005/version/20260101`;
const OTHER_TEST_EDITION = `${SNOMED}/322236009/version/20260101`;
const NATIONAL_EDITION = `${SNOMED}/999000041000000102/version/20250701`;
const OWN_LOINC_VERSION = 'synthetic-loinc-2026.1';
const DETAIL_ID = '100005';
const NAMED_ONLY_ID = '322236009';
const OTHER_SCOPE_ID = '161765003';
const ABSENT_ID = '429740004';
const OWN_LABEL = 'Synthetic own label';
const PREFIX = 'https://records-fhir.dev/StructureDefinition/imported-terminology-';
const CONTRACT = 'records.fhirsmith.terminology-projection.v2';
const R4_SCOPE: ProfileSourceContext = { organizationId: 73, serverId: 8, fhirVersion: 'R4' };
const R5_SCOPE: ProfileSourceContext = { organizationId: 73, serverId: 8, fhirVersion: 'R5' };
const OTHER_TENANT_SCOPE: ProfileSourceContext = { organizationId: 74, serverId: 8, fhirVersion: 'R4' };

afterEach(() => setProfileSource({}));

describe('public ValueSetValidator imported named-inventory controls', () => {
  it('C01 P: verifies an own named concept with no projected details', async () => {
    const host = tenantPackages();
    const { result, scopeKey } = await query(host, R4_SCOPE, NAMED_ONLY_ID);
    expect(result).toMatchObject({ valid: true });
    expect(result.reason).toBeUndefined();
    expect(result.display).toBeUndefined();
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
    expect(host.observations).toContainEqual({ system: SNOMED, version: OWN_EDITION, context: R4_SCOPE, scopeKey });
  });

  it('C02 N: preserves an absent named SCTID under the explicitly requested own edition', async () => {
    const host = tenantPackages();
    expectNamedRejection((await query(host, R4_SCOPE, ABSENT_ID)).result, OWN_EDITION);
  });

  it('C03 U: an unversioned SCTID absence cannot reject a named code', async () => {
    const host = tenantPackages();
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID, null)).result);
  });

  it('C04 U: an unavailable requested national edition cannot borrow own-edition absence', async () => {
    const host = tenantPackages();
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID, NATIONAL_EDITION)).result);
  });

  it('C05 U: another test edition cannot borrow own-edition absence', async () => {
    const host = tenantPackages();
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID, OTHER_TEST_EDITION)).result);
  });

  it('C06 U: absence of a well-formed SCG expression is not named-concept rejection', async () => {
    const host = tenantPackages();
    expectUnverified((await query(host, R4_SCOPE, '100005:363698007=56459004')).result);
  });

  it('C07 N: an absent ordinary LOINC code uses complete named inventory', async () => {
    const host = tenantPackages();
    expectNamedRejection((await query(host, R4_SCOPE, '8867-4', OWN_LOINC_VERSION, LOINC)).result, OWN_LOINC_VERSION);
  });

  it('C08 U: the LOINC named inventory does not establish absent LA answer-list membership', async () => {
    const host = tenantPackages();
    expectUnverified((await query(host, R4_SCOPE, 'LA6751-7', OWN_LOINC_VERSION, LOINC)).result);
  });

  it('C09 U: missing own descriptions leave display unknown while membership remains verified', async () => {
    const host = tenantPackages();
    const { result } = await query(host, R4_SCOPE, NAMED_ONLY_ID, OWN_EDITION, SNOMED, 'Unowned display', 'en-GB');
    expect(result).toMatchObject({ valid: true, reason: 'display-unverified' });
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
    expect(result.issues?.some(issue => issue.code === 'display-unverified')).toBe(true);
    expect(result.issues?.some(issue => issue.code === 'invalid-display')).not.toBe(true);
  });

  it('C10 P: complete own labels accept their matching base-language display', async () => {
    const host = tenantPackages();
    const { result } = await query(host, R4_SCOPE, DETAIL_ID, OWN_EDITION, SNOMED, OWN_LABEL, 'en-GB');
    expect(result).toMatchObject({ valid: true });
    expect(result.reason).toBeUndefined();
    expect(result.display).toBeUndefined();
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
    expect(result.issues?.some(issue => issue.code === 'invalid-display' || issue.code === 'display-unverified')).not.toBe(true);
  });

  it('C11 N: complete own labels reject a different display without rejecting code membership', async () => {
    const host = tenantPackages();
    const { result } = await query(host, R4_SCOPE, DETAIL_ID, OWN_EDITION, SNOMED, 'Another label', 'en-GB');
    expect(result).toMatchObject({ valid: false, reason: 'display-mismatch', display: OWN_LABEL });
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
    expect(result.issues?.map(issue => issue.code)).toEqual(['invalid-display']);
    expect(result.reason).not.toBe('code-unknown');
  });

  it('C12 U: an unsupported imported contract cannot use nominal complete content for rejection', async () => {
    const host = tenantPackages('unsupported');
    expect(host.fixtures.r4.content).toBe('complete');
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID)).result);
  });

  it('C13 U: a missing imported contract field cannot use nominal complete content for rejection', async () => {
    const host = tenantPackages('missing-contract');
    expect(host.fixtures.r4.content).toBe('complete');
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID)).result);
  });

  it('C14 U: contradictory detail-list hashes cannot yield authoritative named rejection', async () => {
    const host = tenantPackages('detail-hash-mismatch');
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID)).result);
  });

  it('C15 P/N: R4 to R5 and back selects each actual source scope', async () => {
    const host = tenantPackages();
    const first = await query(host, R4_SCOPE, NAMED_ONLY_ID);
    const second = await query(host, R5_SCOPE, NAMED_ONLY_ID);
    const third = await query(host, R4_SCOPE, NAMED_ONLY_ID);
    expect(first.result.valid).toBe(true);
    expect(isVerifiedCodeSystemResult(first.result)).toBe(true);
    expectNamedRejection(second.result, OWN_EDITION);
    expect(third.result.valid).toBe(true);
    expect(isVerifiedCodeSystemResult(third.result)).toBe(true);
    expect(first.scopeKey).toBe(third.scopeKey);
    expect(second.scopeKey).not.toBe(first.scopeKey);
    expect(host.observations.some(row => row.context?.fhirVersion === 'R4' && row.scopeKey === first.scopeKey)).toBe(true);
    expect(host.observations.some(row => row.context?.fhirVersion === 'R5' && row.scopeKey === second.scopeKey)).toBe(true);
  });

  it('C16 P/N: concurrent tenant requests preserve their own lookup and leave bound defaults intact', async () => {
    const host = tenantPackages();
    const before = JSON.stringify(host.fixtures);
    const [own, other] = await Promise.all([
      query(host, R4_SCOPE, NAMED_ONLY_ID),
      query(host, OTHER_TENANT_SCOPE, NAMED_ONLY_ID),
    ]);
    expect(own.result.valid).toBe(true);
    expect(isVerifiedCodeSystemResult(own.result)).toBe(true);
    expectNamedRejection(other.result, OWN_EDITION);
    expect(own.scopeKey).not.toBe(other.scopeKey);
    expect(host.observations.some(row => row.context?.organizationId === 73 && row.scopeKey === own.scopeKey)).toBe(true);
    expect(host.observations.some(row => row.context?.organizationId === 74 && row.scopeKey === other.scopeKey)).toBe(true);
    const bound = await host.validator.validateCodeInCodeSystem(NAMED_ONLY_ID, SNOMED, undefined, 'R4', OWN_EDITION);
    expect(bound.valid).toBe(true);
    expect(isVerifiedCodeSystemResult(bound)).toBe(true);
    expect(JSON.stringify(host.fixtures)).toBe(before);
  });

  it('C17 N/U: an explicit default pins unversioned absence and clearing it restores the original unknown', async () => {
    const host = tenantPackages();
    const before = JSON.stringify(host.fixtures);
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID, null)).result);
    host.validator.setResolutionConfig({ defaultCodeSystemVersions: { [SNOMED]: OWN_EDITION } });
    expectNamedRejection((await query(host, R4_SCOPE, ABSENT_ID, null)).result, OWN_EDITION);
    expectNamedRejection((await host.validator.validateCodeInLocalCodeSystemOnly(ABSENT_ID, SNOMED, undefined, 'R4'))!, OWN_EDITION);
    host.validator.setResolutionConfig({ strategy: 'local-only' });
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID, null)).result);
    expect(JSON.stringify(host.fixtures)).toBe(before);
  });

  it('C18 U: an explicit request edition wins over the default and another FHIR source cannot borrow it', async () => {
    const host = tenantPackages();
    host.validator.setResolutionConfig({ defaultCodeSystemVersions: { [SNOMED]: OWN_EDITION } });
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID, NATIONAL_EDITION)).result);
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID, OTHER_TEST_EDITION)).result);
    const unavailable: ProfileSourceContext = { ...R4_SCOPE, serverId: 9 };
    expectUnverified((await query(host, unavailable, ABSENT_ID, null)).result);
    expectNamedRejection((await query(host, R4_SCOPE, ABSENT_ID, null)).result, OWN_EDITION);
  });

  it('C19 P/U: the default does not widen own display details or expression authority', async () => {
    const host = tenantPackages();
    host.validator.setResolutionConfig({ defaultCodeSystemVersions: { [SNOMED]: OWN_EDITION } });
    const named = (await query(host, R4_SCOPE, NAMED_ONLY_ID, null, SNOMED, 'Unowned label')).result;
    expect(named).toMatchObject({ valid: true, reason: 'display-unverified' });
    expect(isVerifiedCodeSystemResult(named)).toBe(true);
    expectUnverified((await query(host, R4_SCOPE, '100005:363698007=56459004', null)).result);
  });

  it('C20 U: a default cannot promote an unsupported imported contract or another own edition', async () => {
    const host = tenantPackages('unsupported');
    host.validator.setResolutionConfig({ defaultCodeSystemVersions: { [SNOMED]: OWN_EDITION } });
    expectUnverified((await query(host, R4_SCOPE, ABSENT_ID, null)).result);
    const ordinary = tenantPackages();
    ordinary.validator.setResolutionConfig({ defaultCodeSystemVersions: { [SNOMED]: NATIONAL_EDITION } });
    expectUnverified((await query(ordinary, R4_SCOPE, ABSENT_ID, null)).result);
  });


  it("C21 U: a default preserves the versioned binding diagnostic under the caller's original unversioned coding", async () => {
    const host = tenantPackages();
    host.validator.setResolutionConfig({ defaultCodeSystemVersions: { [SNOMED]: OWN_EDITION }, reportUnverifiedBindings: true });
    const coding = { coding: [{ system: SNOMED, code: ABSENT_ID }] };
    const before = JSON.stringify(coding);
    const issues = await host.validator.validateBinding(coding,
      { strength: 'required', valueSet: 'http://synthetic.test/ValueSet/not-installed' },
      'Observation.code', { fhirVersion: 'R4' });
    expect(issues.find(issue => issue.code === 'terminology-binding-unverified')?.details).toMatchObject({
      terminologyDiagnostic: { cause: 'versioned-binding-unverified', localExpansion: 'none',
        serverSkipped: 'delegation-disabled', serverAttempts: [] },
    });
    expect(JSON.stringify(coding)).toBe(before);
  });

});

function digest(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function field(url: string, valueType: 'valueCode' | 'valueString' | 'valueBoolean' | 'valueInteger', value: string | boolean | number): Extension {
  return { url, [valueType]: value };
}

function inventory(system: typeof SNOMED | typeof LOINC, codes: string[], variant: ContractVariant = 'supported'): Fixture {
  const format = system === SNOMED ? 'snomed' : 'loinc';
  const version = format === 'snomed' ? OWN_EDITION : OWN_LOINC_VERSION;
  const detailCode = codes[0];
  const detailHash = digest(JSON.stringify([detailCode]));
  const sourceMetadata = JSON.stringify({ fixture: 'synthetic-metadata-only', system, version, codes });
  const sourceFields = [
    field('contract', 'valueCode', variant === 'unsupported' ? 'records.fhirsmith.terminology-projection.v99' : CONTRACT),
    field('displayLanguageMatch', 'valueCode', 'base-language'), field('format', 'valueCode', format),
    field('sha256', 'valueString', digest(sourceMetadata)), field('businessVersion', 'valueString', version),
    field('selection', 'valueCode', 'all-named-codes'), field('completeNamedCodeInventory', 'valueBoolean', true),
    field('datasetNamedCodeCount', 'valueInteger', codes.length), field('projectedNamedCodeCount', 'valueInteger', codes.length),
    field('descriptionsCompleteForIncludedCodes', 'valueBoolean', false),
    field('propertiesCompleteForIncludedCodes', 'valueBoolean', false), field('relationshipsCompleteForIncludedCodes', 'valueBoolean', false),
    field('detailSelection', 'valueCode', 'code-list'), field('detailCodeCount', 'valueInteger', 1),
    field('detailCodesSha256', 'valueString', variant === 'detail-hash-mismatch' ? '0'.repeat(64) : detailHash),
    field('detailDescriptionsComplete', 'valueBoolean', true),
    field('detailPropertiesComplete', 'valueBoolean', format === 'loinc'), field('detailRelationshipsComplete', 'valueBoolean', format === 'loinc'),
  ].filter(entry => variant !== 'missing-contract' || entry.url !== 'contract');
  const description = [
    field('id', 'valueString', `synthetic-${detailCode}-en`), field('value', 'valueString', OWN_LABEL),
    field('language', 'valueCode', format === 'loinc' ? 'en-US' : 'en'),
    field('kind', 'valueCode', format === 'loinc' ? 'LONG_COMMON_NAME' : '900000000000013009'),
    field(format === 'snomed' ? 'active' : 'acceptedLabel', 'valueBoolean', true),
  ];
  const detailed: FixtureConcept = {
    ...baseConcept(detailCode, format, OWN_LABEL),
    extension: [{ url: `${PREFIX}label-coverage`, extension: [
      field('completeSourceDescriptions', 'valueBoolean', true), field('sourceDescriptionCount', 'valueInteger', 1),
    ] }],
    designation: [{ language: format === 'loinc' ? 'en-US' : 'en', value: OWN_LABEL,
      extension: [{ url: `${PREFIX}description`, extension: description }] }],
  };
  return {
    resourceType: 'CodeSystem', url: system, version, status: 'active',
    description: 'Synthetic test-owned metadata inventory only; this is not a LOINC or SNOMED release dataset.',
    language: format === 'loinc' ? 'en-US' : 'en', caseSensitive: true, count: codes.length,
    ...(format === 'snomed' ? { compositional: true } : {}),
    content: variant === 'unsupported' || variant === 'missing-contract' ? 'complete' : 'fragment',
    extension: [{ url: `${PREFIX}source`, extension: sourceFields }],
    concept: [detailed, ...codes.slice(1).map(code => baseConcept(code, format, 'Synthetic other label'))],
  };
}

function baseConcept(code: string, format: 'snomed' | 'loinc', ownLabel: string): FixtureConcept {
  return format === 'snomed' ? { code, property: [{ code: 'inactive', valueBoolean: false }] }
    : { code, display: ownLabel, property: [
      { code: 'STATUS', valueCode: 'ACTIVE' }, { code: 'imported-source-kind', valueCode: 'LOINC' },
    ] };
}

function tenantPackages(variant: ContractVariant = 'supported') {
  const fixtures = {
    r4: inventory(SNOMED, [DETAIL_ID, NAMED_ONLY_ID], variant),
    r5: inventory(SNOMED, [DETAIL_ID, OTHER_SCOPE_ID], variant),
    loinc: inventory(LOINC, ['8480-6', '8462-4']),
  };
  const observations: HostObservation[] = [];
  const validator = new ValueSetValidator(undefined, undefined, []);
  const findCanonicalResource = vi.fn(async (
    system: string, resourceType: string, version: string | undefined, context?: ProfileSourceContext,
  ): Promise<Record<string, unknown> | null> => {
    observations.push({ system, version, context: context ? { ...context } : undefined,
      scopeKey: validator.getDefinitionLookup().cache.sourceContexts.key('') });
    if (resourceType !== 'CodeSystem' || context?.serverId !== 8
      || (context.organizationId !== 73 && context.organizationId !== 74)
      || (context.fhirVersion !== 'R4' && context.fhirVersion !== 'R5')) return null;
    const selected = system === LOINC ? fixtures.loinc : system === SNOMED
      ? context.organizationId === 74 || context.fhirVersion === 'R5' ? fixtures.r5 : fixtures.r4 : null;
    return selected && (!version || version === selected.version) ? selected : null;
  });
  setProfileSource({ findCanonicalResource, packageDirectories: [] });
  validator.setResolutionConfig({ strategy: 'local-only', servers: [], serverDelegation: {
    expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0,
  } });
  validator.setSourceContext(R4_SCOPE);
  return { validator, fixtures, observations, findCanonicalResource };
}

function query(host: ReturnType<typeof tenantPackages>, context: ProfileSourceContext, code: string,
  version: string | null = OWN_EDITION, system = SNOMED, display?: string, displayLanguage?: string) {
  return host.validator.withSourceContext(context, async () => {
    const scopeKey = host.validator.getDefinitionLookup().cache.sourceContexts.key('');
    expect(scopeKey).not.toBe('');
    const result = await host.validator.validateCodeInCodeSystem(code, system, display, context.fhirVersion, version ?? undefined, displayLanguage);
    return { result, scopeKey };
  });
}

function expectNamedRejection(result: Result, version: string): void {
  expect(result).toMatchObject({ valid: false, reason: 'code-unknown', incompleteCodeSystem: false });
  expect(result.message).toContain(version);
  expect(isVerifiedCodeSystemResult(result)).toBe(true);
  expect(result.issues?.some(issue => issue.code === 'invalid-display')).not.toBe(true);
}

function expectUnverified(result: Result): void {
  expect(result).toMatchObject({ valid: true, reason: 'delegation-disabled' });
  expect(isVerifiedCodeSystemResult(result)).toBe(false);
  expect(result.reason).not.toBe('code-unknown');
  expect(result.issues?.some(issue => issue.severity === 'error')).not.toBe(true);
}
