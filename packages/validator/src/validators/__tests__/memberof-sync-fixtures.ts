import mcode from '../__fixtures__/memberof-mcode-metadata.json';
import sdk from '../__fixtures__/memberof-sdk-valid-atoms.json';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import type { CodeSystem, ValueSet } from '../valueset-types.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageLoader } from '../valueset-package-loader.js';

export { sdk };
export const valueSetUrl = mcode.valueSet.url;
export const versionCanonical = 'https://example.test/ValueSet/memberof-business-version';
export const requestedVersion = `${versionCanonical}|2.0.0`;
export const atoms = {
  member: { system: sdk.codeSystems.usCore.metadata.url, code: 'health-concern' },
  male: { system: sdk.codeSystems.administrativeGender.metadata.url, code: 'male' },
  female: { system: sdk.codeSystems.administrativeGender.metadata.url, code: 'female' },
};
export type AtomName = keyof typeof atoms;
export type Verdict = 'valid' | 'invalid' | 'unverified';

export async function metadataCache(warm = true): Promise<ValueSetCache> {
  const cache = new ValueSetCache();
  cache.setValueSetFile(`${valueSetUrl}|R4`, warm ? mcode.valueSet as ValueSet : null);
  if (!warm) return cache;
  for (const system of [mcode.codeSystem, sdk.codeSystems.usCore.metadata, sdk.codeSystems.administrativeGender.metadata]) {
    cache.setCodeSystemFile(`${system.url}|fhir4`, system as CodeSystem);
    cache.setCodeSystemFile(`${system.url}|${system.version}`, system as CodeSystem);
  }
  const codes = await new ValueSetPackageLoader(cache).loadValueSet(valueSetUrl, 'R4');
  if (!codes) throw new Error('Maintained metadata fixture did not enumerate its ValueSet');
  cache.setExpandedCodes(valueSetUrl, new Set(codes));
  return cache;
}

export function definition(expression: string): StructureDefinition {
  const source = mcode.definition as StructureDefinition;
  const root = source.snapshot!.element[0];
  return { ...source, snapshot: { element: [{ ...root,
    constraint: [{ ...root.constraint![0], expression }],
  }] } };
}

export function membershipExpression(shape: 'trailing' | 'optional', url: string): string {
  return shape === 'trailing' ? `category.memberOf('${url}')`
    : `category.empty() or (category.memberOf('${url}'))`;
}

export interface VersionEvidence {
  name: string;
  base?: AtomName;
  exact?: AtomName;
  partial?: boolean;
  emptyExact?: boolean;
  other?: AtomName;
  unversioned?: boolean;
  expected: Verdict;
}

export const versionEvidence: VersionEvidence[] = [
  { name: 'exact accepts while base rejects', base: 'male', exact: 'member', expected: 'valid' },
  { name: 'exact rejects while base accepts', base: 'member', exact: 'male', expected: 'invalid' },
  { name: 'missing exact while base accepts', base: 'member', expected: 'unverified' },
  { name: 'missing exact while base rejects', base: 'male', expected: 'unverified' },
  { name: 'negative empty exact while base accepts', base: 'member', emptyExact: true, expected: 'unverified' },
  { name: 'only exact accepts', exact: 'member', expected: 'valid' },
  { name: 'only another business version exists', other: 'member', expected: 'unverified' },
  { name: 'unversioned base accepts', base: 'member', exact: 'male', unversioned: true, expected: 'valid' },
  { name: 'unversioned base rejects', base: 'male', exact: 'member', unversioned: true, expected: 'invalid' },
  { name: 'no local evidence', expected: 'unverified' },
  { name: 'partial exact miss with positive base', base: 'member', exact: 'male', partial: true, expected: 'unverified' },
  { name: 'partial exact hit with negative base', base: 'male', exact: 'member', partial: true, expected: 'valid' },
];

function seed(cache: ValueSetCache, canonical: string, member: AtomName, version: string, total = 1): void {
  const coding = atoms[member];
  cache.setExpandedCodes(canonical, new Set([`${coding.system}|${coding.code}`, coding.code]));
  cache.setValueSetFile(canonical.includes('|') ? canonical : `${canonical}|R4`, {
    resourceType: 'ValueSet', url: versionCanonical, status: 'active', version,
    expansion: { total, contains: [coding] },
  });
}

export function versionCache(evidence: VersionEvidence): ValueSetCache {
  const cache = new ValueSetCache();
  if (evidence.base) seed(cache, versionCanonical, evidence.base, '1.0.0');
  else cache.setValueSetFile(`${versionCanonical}|R4`, null);
  if (evidence.exact) seed(cache, requestedVersion, evidence.exact, '2.0.0', evidence.partial ? 2 : 1);
  else cache.setValueSetFile(requestedVersion, null);
  if (evidence.emptyExact) cache.setExpandedCodes(requestedVersion, new Set());
  if (evidence.other) seed(cache, `${versionCanonical}|3.0.0`, evidence.other, '3.0.0');
  return cache;
}
