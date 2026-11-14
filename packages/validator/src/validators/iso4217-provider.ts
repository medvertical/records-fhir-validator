import { createHash } from 'node:crypto';
import type { CodeSystemValidationResult } from './terminology-api-types.js';
import { verifiedCodeSystemResult } from './code-system-validation-evidence.js';
import { assessTerminologyLabels, displayUnverifiedMessage, type LocalDisplayAssessment } from './valueset-display-authority.js';

export interface CurrencyProviderSnapshot {
  readonly kind: 'provider-snapshot';
  readonly canonical: 'urn:iso:std:iso:4217';
  readonly businessVersion: null;
  readonly language: 'en';
  readonly coverage: 'listed-currency-codes-only';
  readonly sources: ReadonlyArray<Readonly<Record<string, string>>>;
  readonly rows: ReadonlyArray<readonly [string, readonly string[]]>;
}
export const currencyCanonical = 'urn:iso:std:iso:4217';
export const currencyProviderIdentity = 'SIX:ISO4217:2a8fd0c65463f6a9efac0e015e626c5860f47e330d9b68728705140d722ca0a6';
const acceptedInventorySha256 = currencyProviderIdentity.split(':')[2];
const verifiedInventories = new WeakSet<CurrencyProviderSnapshot>();
const sourceInventories = new WeakMap<object, CurrencyProviderSnapshot>();

export function isCurrencyProviderSnapshot(value: unknown): value is CurrencyProviderSnapshot {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && (verifiedInventories.has(value as CurrencyProviderSnapshot)
        || createHash('sha256').update(JSON.stringify(value)).digest('hex') === acceptedInventorySha256);
  } catch { return false; }
}
/** The source publication date is not a terminology business edition or a completeness assertion. */
export function currencyProviderSnapshot(value: unknown): CurrencyProviderSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  const retained = sourceInventories.get(value);
  if (retained) return retained;
  let snapshot: unknown;
  try { snapshot = structuredClone(value); } catch { return null; }
  if (!isCurrencyProviderSnapshot(snapshot)) return null;
  for (const row of snapshot.rows) { Object.freeze(row[1]); Object.freeze(row); }
  for (const source of snapshot.sources) Object.freeze(source);
  Object.freeze(snapshot.sources); Object.freeze(snapshot.rows);
  Object.freeze(snapshot);
  verifiedInventories.add(snapshot);
  sourceInventories.set(value, snapshot);
  return snapshot;
}
export function currencyCodeMembership(selected: CurrencyProviderSnapshot, code: string): true | null {
  return isCurrencyProviderSnapshot(selected) && selected.rows.some(row => row[0] === code) ? true : null;
}
export function assessCurrencyDisplay(selected: CurrencyProviderSnapshot, code: string, display: string, language?: string): LocalDisplayAssessment {
  const labels = isCurrencyProviderSnapshot(selected) ? selected.rows.find(row => row[0] === code)?.[1] : undefined;
  return labels ? assessTerminologyLabels({ code, system: selected.canonical },
    labels.map(value => ({ value, language: selected.language })), display, language, labels[0])
    : { outcome: 'unverified', displays: [] };
}
export function validateCurrencyCode(selected: CurrencyProviderSnapshot, code: string, display?: string, language?: string): CodeSystemValidationResult | null {
  if (currencyCodeMembership(selected, code) !== true) return null;
  const expected = selected.rows.find(row => row[0] === code)?.[1][0];
  const assessment = display ? assessCurrencyDisplay(selected, code, display, language) : undefined;
  if (assessment?.outcome === 'unverified') return verifiedCodeSystemResult({ valid: true, display: expected,
    reason: 'display-unverified', displayLanguage: language, issues: [{ severity: 'warning', code: 'display-unverified',
      message: displayUnverifiedMessage({ system: selected.canonical, code, display }, language), source: 'local-code-system' }] });
  if (assessment?.outcome === 'mismatch') {
    const message = `Wrong Display Name '${display}' for ${selected.canonical}#${code}. Valid display is '${expected}'`;
    return verifiedCodeSystemResult({ valid: false, reason: 'display-mismatch', display: expected, message,
      issues: [{ severity: 'error', code: 'invalid-display', message, source: 'local-code-system' }] });
  }
  return verifiedCodeSystemResult({ valid: true, display: expected });
}
