import { afterEach, expect, it } from 'vitest';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { builtInProviderSnapshot } from '../built-in-terminology-provider.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetValidator } from '../valueset-validator.js';
import currencies from './fixtures/iso4217-currencies-valueset.json';

const system = 'urn:iso:std:iso:4217';
const originalSource = getProfileSource();
afterEach(() => setProfileSource(originalSource));

it('uses configured currency terminology and keeps an absent local inventory unverified', async () => {
  setProfileSource({});
  expect(builtInProviderSnapshot(system)).toBeNull();
  expect(builtInProviderSnapshot(system, undefined, { unexpected: () => 'uncloneable' })).toBeNull();
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', reportUnverifiedBindings: true });
  expect(values.registerExternalTerminologyResource(currencies, 'R4')).toBe(true);
  const bind = (code: string) => values.resolveCodeBindingForBinding(code, system, `${currencies.url}|4.0.1`, 'required', 'R4');
  expect(await bind('EUR')).toBe('unverified');
  expect(values.registerExternalTerminologyResource({
    resourceType: 'CodeSystem', url: system, status: 'active', content: 'fragment', caseSensitive: true,
    concept: [{ code: 'EUR', display: 'Euro' }],
  }, 'R4')).toBe(true);
  expect(await bind('EUR')).toBe('valid');
  expect(await bind('ZZZ')).toBe('unverified');
});
