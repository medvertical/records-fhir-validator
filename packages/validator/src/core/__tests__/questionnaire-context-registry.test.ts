import { describe, expect, it } from 'vitest';
import { QuestionnaireContextRegistry } from '../questionnaire-context-registry';

// Small owner fixtures exercise registry policy, not original corpus authority.
const canonical = 'https://example.org/Questionnaire/registered-editions';
function questionnaire(version?: string) {
  return {
    resourceType: 'Questionnaire', id: 'registered-editions', url: canonical,
    status: 'active', ...(version ? { version } : {}),
  };
}

describe('QuestionnaireContextRegistry edition selection', () => {
  it.each([
    ['1.0.0', '2.0.0'],
    ['2.0.0', '1.0.0'],
  ])('retains own editions when %s is registered before %s', (firstVersion, lastVersion) => {
    const registry = new QuestionnaireContextRegistry();
    const first = questionnaire(firstVersion);
    const last = questionnaire(lastVersion);
    expect(registry.register(first)).toBe(true);
    expect(registry.register(last)).toBe(true);

    expect(registry.get(`${canonical}|${firstVersion}`)).toBe(first);
    expect(registry.get(`${canonical}|${lastVersion}`)).toBe(last);
    expect(registry.get(canonical)).toBe(last);
    expect(registry.get(`${canonical}|3.0.0`)).toBeNull();
  });

  it('preserves the existing id aliases and their requested editions', () => {
    const registry = new QuestionnaireContextRegistry();
    const first = questionnaire('1.0.0');
    const last = questionnaire('2.0.0');
    registry.register(first);
    registry.register(last);

    for (const alias of ['Questionnaire/registered-editions', '#registered-editions']) {
      expect(registry.get(alias)).toBe(last);
      expect(registry.get(`${alias}|1.0.0`)).toBe(first);
      expect(registry.get(`${alias}|2.0.0`)).toBe(last);
      expect(registry.get(`${alias}|3.0.0`)).toBeNull();
    }
  });

  it('does not treat an unversioned registered body as an explicitly requested edition', () => {
    const registry = new QuestionnaireContextRegistry();
    const unversioned = questionnaire();
    registry.register(unversioned);

    expect(registry.get(canonical)).toBe(unversioned);
    expect(registry.get(`${canonical}|1.0.0`)).toBeNull();
    expect(registry.resolveForResponse({
      resourceType: 'QuestionnaireResponse', questionnaire: `${canonical}|1.0.0`,
    })).toBeUndefined();
  });

  it('checks the actual body version even when a cached edition alias is stale', () => {
    const registry = new QuestionnaireContextRegistry();
    const registered = questionnaire('1.0.0');
    registry.register(registered);
    registered.version = '2.0.0';

    expect(registry.get(`${canonical}|1.0.0`)).toBeNull();
    expect(registry.get(`${canonical}|2.0.0`)).toBe(registered);
  });
});
