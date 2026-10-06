import { afterEach, describe, expect, it } from 'vitest';
import { getProfileSource, setProfileSource, type ProfileSourceContext } from '../../persistence/profile-source.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetValidator } from '../valueset-validator.js';
import { versionedCacheKey } from '../valueset-package-utils.js';
import { validateQuestionnaireCodingAnswer } from '../questionnaire-coding-answer-validator.js';

const system = 'https://example.test/CodeSystem/host-questionnaire';
const valueSet = 'https://example.test/ValueSet/host-questionnaire';
const originalSource = getProfileSource();
afterEach(() => setProfileSource(originalSource));
const source = (calls: Array<{ type: string; version?: string; context?: ProfileSourceContext }>, delay?: (context?: ProfileSourceContext) => Promise<void>) => ({
  async findCanonicalResource(_canonical: string, type: string, version: string | undefined, context?: ProfileSourceContext) {
    calls.push({ type, version, context: context ? { ...context } : undefined });
    if (delay) await delay(context);
    return type === 'ValueSet'
      ? { resourceType: 'ValueSet', url: valueSet, version: '2.0.0', compose: { include: [{ system, version: '2.0.0' }] } }
      : { resourceType: 'CodeSystem', url: system, version: '2.0.0', content: 'complete',
          concept: [{ code: 'a', display: `${context?.organizationId}:${context?.fhirVersion}` }] };
  },
});
const issues = (cache: ValueSetCache, display: string) => validateQuestionnaireCodingAnswer(
  { valueCoding: { system, version: '2.0.0', code: 'a', display } },
  { linkId: 'choice', type: 'choice', answerValueSet: valueSet }, 'answer', cache, false).map(issue => issue.code);
const wrongDisplay = ['qr-display-mismatch', 'qr-code-not-in-valueset'];

describe('Questionnaire prewarm host source context', () => {
  for (const release of ['R4', 'R5', 'R6'] as const) it(`host ${release} explicit override retains tenant and version, cold/warm`, async () => {
    const calls: Array<{ type: string; version?: string; context?: ProfileSourceContext }> = [];
    setProfileSource(source(calls));
    const cache = new ValueSetCache(); const validator = new ValueSetValidator(cache, undefined, []);
    validator.setResolutionConfig({ strategy: 'local-only' });
    const context: ProfileSourceContext = { organizationId: 91, serverId: 9, fhirVersion: 'R4' };
    await validator.withSourceContext(context, async () => {
      for (let warm = 0; warm < 2; warm++) {
        await validator.prewarmValueSet(`${valueSet}|2.0.0`, release);
        cache.sourceContexts.run(release, () => {
          expect(cache.getCodeSystemFile(versionedCacheKey(system, '2.0.0', release))?.version).toBe('2.0.0');
          expect(issues(cache, `91:${release}`)).toEqual([]);
          expect(issues(cache, 'wrong')).toEqual(wrongDisplay);
        });
      }
    });
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.context?.organizationId === 91 && call.context?.serverId === 9 && call.context?.fhirVersion === release && call.version === '2.0.0')).toBe(true);
  });
  it('overlapping async host scopes retain request-entry identities after await', async () => {
    const calls: Array<{ type: string; version?: string; context?: ProfileSourceContext }> = [];
    let releaseA!: () => void; let sawA!: () => void;
    const waitingA = new Promise<void>(resolve => { releaseA = resolve; });
    const enteredA = new Promise<void>(resolve => { sawA = resolve; });
    setProfileSource(source(calls, async context => { if (context?.organizationId === 101) { sawA(); await waitingA; } }));
    const cache = new ValueSetCache(); const validator = new ValueSetValidator(cache, undefined, []);
    validator.setResolutionConfig({ strategy: 'local-only' });
    const contextA: ProfileSourceContext = { organizationId: 101, serverId: 1, fhirVersion: 'R4' };
    const contextB: ProfileSourceContext = { organizationId: 102, serverId: 2, fhirVersion: 'R5' };
    const requestA = validator.withSourceContext(contextA, () => validator.prewarmValueSet(`${valueSet}|2.0.0`, 'R4'));
    await enteredA;
    await validator.withSourceContext(contextB, () => validator.prewarmValueSet(`${valueSet}|2.0.0`, 'R5'));
    releaseA(); await requestA;
    for (const context of [contextA, contextB]) cache.sourceContexts.runWith(context, () => {
      expect(issues(cache, `${context.organizationId}:${context.fhirVersion}`)).toEqual([]);
      expect(issues(cache, 'wrong')).toEqual(wrongDisplay);
    });
    expect(calls.filter(call => call.context?.organizationId === 101)).toHaveLength(2);
    expect(calls.filter(call => call.context?.organizationId === 102)).toHaveLength(2);
  });
  it('host scoped lookup never consumes an intentional plain cache from another source', () => {
    setProfileSource(source([])); const cache = new ValueSetCache();
    cache.setCodeSystem(system, { resourceType: 'CodeSystem', url: system, version: '2.0.0', content: 'complete', concept: [{ code: 'a', display: 'Wrong source' }] });
    cache.sourceContexts.runWith({ organizationId: 303, serverId: 3, fhirVersion: 'R4' }, () => expect(issues(cache, 'elsewhere')).toEqual([]));
  });
  it('direct Coding consumer snapshots bound tenant before consulting cache', () => {
    setProfileSource(source([])); const cache = new ValueSetCache();
    const validator = new ValueSetValidator(cache, undefined, []);
    cache.setCodeSystem(system, { resourceType: 'CodeSystem', url: system, version: '2.0.0', content: 'complete', concept: [{ code: 'a', display: 'Wrong source' }] });
    validator.setSourceContext({ organizationId: 404, serverId: 4, fhirVersion: 'R4' });
    expect(issues(cache, 'elsewhere')).toEqual([]);
  });

});
