import { createHash } from 'node:crypto';
import type SnapshotShape from './unm49-provider-snapshot.json';
import { createRequire } from 'node:module';
const rawSnapshot: typeof SnapshotShape = createRequire(import.meta.url)('./unm49-provider-snapshot.json');
import type { CodeSystem, ValueSetComposeInclude } from './valueset-types.js';
import type { CodeSystemValidationResult } from './terminology-api-types.js';
import { verifiedCodeSystemResult } from './code-system-validation-evidence.js';
import { assessTerminologyLabels, displayUnverifiedMessage, type LocalDisplayAssessment } from './valueset-display-authority.js';
import { hasUnknownTerminologyModifiers } from './valueset-concept-filter-membership.js';

type Filter = NonNullable<ValueSetComposeInclude['filter']>[number];
export interface ProviderSnapshot {
  readonly kind: 'provider-snapshot';
  readonly canonical: string;
  readonly businessVersion: null;
  readonly language: 'en';
  readonly coverage: 'listed-concepts-with-explicit-class';
  readonly source: Readonly<Record<string, string>>;
  readonly rowsSha256: string;
  readonly rows: ReadonlyArray<readonly [string, string, string, 'country' | 'region']>;
}
export type LocalTerminologyAuthority = { readonly kind: 'code-system'; readonly codeSystem: CodeSystem }
  | { readonly kind: 'provider'; readonly snapshot: ProviderSnapshot; readonly scopeKey: string };
export const unm49Canonical = 'http://unstats.un.org/unsd/methods/m49/m49.htm';
export const providerIdentity = 'FHIRsmith:0ecadbdeabbf278a45e7e1eb4b1ce15e555de61f:UN-M49:fa5d0902be5d064ac6808852edb6923770aead1fe848829da09708233a9e6472';
export const providerLookupKey = `built-in-provider:${providerIdentity}`;
const expectedSnapshotSha256 = 'b651a2221ccead780b30c1d791c54697c23401d50f99598bdb6d704b3018efc6';
const snapshotSha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function validSnapshot(value: unknown): value is ProviderSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'provider-snapshot' || record.canonical !== unm49Canonical || record.businessVersion !== null
    || record.language !== 'en' || !Array.isArray(record.rows) || record.rows.length !== 270) return false;
  try { return snapshotSha256(value) === expectedSnapshotSha256; } catch { return false; }
}
function freezeSnapshot(): ProviderSnapshot | null {
  if (!validSnapshot(rawSnapshot)) return null;
  for (const row of rawSnapshot.rows) Object.freeze(row);
  Object.freeze(rawSnapshot.rows); Object.freeze(rawSnapshot.source);
  return Object.freeze(rawSnapshot);
}
const snapshot = freezeSnapshot();

/** The provider has a source revision, but no FHIR terminology business edition. */
export function builtInProviderSnapshot(system: string, requestedVersion?: string): ProviderSnapshot | null {
  return system === unm49Canonical && requestedVersion === undefined ? snapshot : null;
}
export function scopedProviderSnapshot(authority: LocalTerminologyAuthority | null, scopeKey: string): ProviderSnapshot | null {
  return authority?.kind === 'provider' && authority.scopeKey === scopeKey && validSnapshot(authority.snapshot) ? authority.snapshot : null;
}
export function providerCodeMembership(snapshot: ProviderSnapshot, code: string): true | null {
  return validSnapshot(snapshot) && snapshot.rows.some(row => row[0] === code) ? true : null;
}
export function supportsProviderFilter(snapshot: ProviderSnapshot, filter: Filter): boolean {
  return validSnapshot(snapshot) && !hasUnknownTerminologyModifiers(filter)
    && ['class', 'type'].includes(filter.property) && filter.op === '=' && typeof filter.value === 'string' && filter.value.length > 0;
}
export function providerFilterMembership(snapshot: ProviderSnapshot, code: string, filter: Filter): boolean | null {
  if (!supportsProviderFilter(snapshot, filter)) return null;
  const row = snapshot.rows.find(row => row[0] === code);
  return row ? row[3] === filter.value : null;
}
function providerDisplay(snapshot: ProviderSnapshot, code: string): string | undefined {
  if (!validSnapshot(snapshot)) return undefined;
  const row = snapshot.rows.find(row => row[0] === code);
  return row ? row[2] ? `${row[1]} (${row[2]})` : row[1] : undefined;
}
export function assessProviderDisplay(snapshot: ProviderSnapshot, code: string, display: string, language?: string): LocalDisplayAssessment {
  const expected = providerDisplay(snapshot, code);
  return expected ? assessTerminologyLabels({ code, system: snapshot.canonical },
    [{ value: expected, language: snapshot.language }], display, language, expected) : { outcome: 'unverified', displays: [] };
}
export function validateProviderCode(snapshot: ProviderSnapshot, code: string, display?: string, language?: string): CodeSystemValidationResult | null {
  if (providerCodeMembership(snapshot, code) !== true) return null;
  const expected = providerDisplay(snapshot, code);
  const assessment = display ? assessProviderDisplay(snapshot, code, display, language) : undefined;
  if (assessment?.outcome === 'unverified') return verifiedCodeSystemResult({
    valid: true, reason: 'display-unverified', display: expected, displayLanguage: language,
    issues: [{ severity: 'warning', code: 'display-unverified',
      message: displayUnverifiedMessage({ system: snapshot.canonical, code, display }, language), source: 'local-code-system' }],
  });
  if (assessment?.outcome === 'mismatch') {
    const message = `Wrong Display Name '${display}' for ${snapshot.canonical}#${code}. Valid display is '${expected}'`;
    return verifiedCodeSystemResult({ valid: false, reason: 'display-mismatch', display: expected, message,
      issues: [{ severity: 'error', code: 'invalid-display', message, source: 'local-code-system' }] });
  }
  return verifiedCodeSystemResult({ valid: true, display: expected });
}
