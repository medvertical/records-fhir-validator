import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetValidator } from '../valueset-validator.js';
import { QuestionnaireValidator } from '../questionnaire-validator.js';
import { validateQuestionnaireCodingAnswer } from '../questionnaire-coding-answer-validator.js';
import { versionedCacheKey } from '../valueset-package-utils.js';
import type { CodeSystem } from '../valueset-types.js';
import type { QuestionnaireItem } from '../questionnaire-types.js';

const system = 'https://example.test/CodeSystem/questionnaire-context';
const valueSet = 'https://example.test/ValueSet/questionnaire-context';
const question: QuestionnaireItem = { linkId: 'answer', type: 'choice', answerValueSet: valueSet };
const definition = (version: string, display: string): CodeSystem => ({ resourceType: 'CodeSystem', url: system,
  version, content: 'complete', concept: [{ code: 'a', display }] });
const codes = (cache: ValueSetCache, display: string, version?: string, codingSystem = system) =>
  validateQuestionnaireCodingAnswer({ valueCoding: { system: codingSystem, code: 'a', display, ...(version ? { version } : {}) } },
    question, 'QuestionnaireResponse.item[0].answer[0]', cache, false).map(issue => issue.code);
const wrongDisplay = ['qr-display-mismatch', 'qr-code-not-in-valueset'];

// Package fixtures are synthetic; no resource inputs from the public corpus are copied.
function stores() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-context-stores-'));
  const directories = [base];
  for (const release of ['R4', 'R5', 'R6'] as const) {
    const directory = path.join(base, `example.${release.toLowerCase()}.core#2026.1.0`, 'package'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `example.${release}`, version: '2026.1.0',
      fhirVersions: [release === 'R4' ? '4.0.1' : release === 'R5' ? '5.0.0' : '6.0.0'] }));
    fs.writeFileSync(path.join(directory, 'CodeSystem-questionnaire-context.json'), JSON.stringify(definition('2.0.0', release)));
    fs.writeFileSync(path.join(directory, 'ValueSet-questionnaire-context.json'), JSON.stringify({ resourceType: 'ValueSet', url: valueSet,
      version: '2026.1.0', compose: { include: [{ system }] } }));
  }
  return { directories, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

describe('Questionnaire Coding cached definition context', () => {
  for (const release of ['R4', 'R5', 'R6'] as const) {
    for (const valid of [true, false]) it(`${release} encoded definition ${valid ? 'valid' : 'wrong display'}`, () => {
      const cache = new ValueSetCache(); cache.sourceContexts.run(release, () => {
        cache.setCodeSystemFile(versionedCacheKey(system, undefined, release), definition('2.0.0', release));
        expect(codes(cache, valid ? release : 'wrong')).toEqual(valid ? [] : wrongDisplay);
      });
    });
    for (const display of ['R4', 'R5', 'R6']) it(`registration selects ${release}, display ${display}`, () => {
      const cache = new ValueSetCache();
      for (const registered of ['R4', 'R5', 'R6'] as const) cache.registerResource('CodeSystem', system, '2.0.0', registered, definition('2.0.0', registered));
      cache.sourceContexts.run(release, () => expect(codes(cache, display)).toEqual(display === release ? [] : wrongDisplay));
    });
    it(`${release} cold/warm package prewarm uses explicit publication`, async () => {
      const fixture = stores(); const cache = new ValueSetCache(); const validator = new ValueSetValidator(cache, undefined, fixture.directories);
      validator.setResolutionConfig({ strategy: 'local-only' });
      try {
        for (let warm = 0; warm < 2; warm++) {
          await validator.prewarmValueSet(valueSet, release);
          cache.sourceContexts.run(release, () => {
            const selected = cache.getCodeSystemFile(versionedCacheKey(system, undefined, release));
            expect(selected?.concept?.[0].display).toBe(release);
            expect(codes(cache, release)).toEqual([]);
            expect(codes(cache, 'wrong')).toEqual(wrongDisplay);
          });
        }
      } finally { fixture.cleanup(); }
    });
  }
  for (const version of ['2.0.0', '2.0.1', '9.9.9']) {
    for (const display of ['First', 'Second']) it(`exact Coding.version ${version} display ${display}`, () => {
      const cache = new ValueSetCache();
      cache.registerResource('CodeSystem', system, '2.0.0', 'R4', definition('2.0.0', 'First'));
      cache.registerResource('CodeSystem', system, '2.0.1', 'R4', definition('2.0.1', 'Second'));
      cache.sourceContexts.run('R4', () => expect(codes(cache, display, version)).toEqual(
        version === '9.9.9' || display === (version === '2.0.0' ? 'First' : 'Second') ? [] : wrongDisplay));
    });
  }
  it('does not infer a FHIR family from a cache entry without request context', () => {
    const cache = new ValueSetCache(); cache.setCodeSystemFile(versionedCacheKey(system, undefined, 'R5'), definition('2.0.0', 'R5'));
    expect(codes(cache, 'wrong')).toEqual([]);
  });
  it('preserves intentional plain-cache display tests', () => {
    const cache = new ValueSetCache(); cache.setCodeSystem(system, definition('2.0.0', 'Plain'));
    expect(codes(cache, 'Plain')).toEqual([]); expect(codes(cache, 'wrong')).toEqual(wrongDisplay);
  });
  it('unknown code and unavailable definition do not become clinical invalidity', () => {
    const cache = new ValueSetCache();
    cache.sourceContexts.run('R4', () => {
      cache.setCodeSystemFile(versionedCacheKey(system, undefined, 'R4'), definition('2.0.0', 'First'));
      expect(codes(cache, 'wrong', undefined, 'https://example.test/unknown')).toEqual([]);
      expect(validateQuestionnaireCodingAnswer({ valueCoding: { system, code: 'not-in-local-content', display: 'unknown' } },
        question, 'answer', cache, false)).toEqual([]);
    });
  });
  it('tenant source identity isolates encoded definitions cold/warm', () => {
    const cache = new ValueSetCache(); const sourceA = { organizationId: 41, serverId: 4, fhirVersion: 'R4' as const };
    const sourceB = { organizationId: 42, serverId: 4, fhirVersion: 'R4' as const };
    for (const [context, display] of [[sourceA, 'A'], [sourceB, 'B']] as const) cache.sourceContexts.runWith(context, () =>
      cache.setCodeSystemFile(versionedCacheKey(system, undefined, 'R4'), definition('2.0.0', display)));
    for (let warm = 0; warm < 2; warm++) for (const [context, display] of [[sourceA, 'A'], [sourceB, 'B']] as const)
      cache.sourceContexts.runWith(context, () => {
        expect(codes(cache, display)).toEqual([]); expect(codes(cache, 'wrong')).toEqual(wrongDisplay);
      });
  });
  it('clear removes definition evidence', () => {
    const cache = new ValueSetCache(); cache.sourceContexts.run('R4', () => {
      cache.setCodeSystemFile(versionedCacheKey(system, undefined, 'R4'), definition('2.0.0', 'First'));
      expect(codes(cache, 'wrong')).toEqual(wrongDisplay);
    }); cache.clear(); cache.sourceContexts.run('R4', () => expect(codes(cache, 'wrong')).toEqual([]));
  });
  it('direct validateAnyResource honors its explicit FHIR context', () => {
    const cache = new ValueSetCache();
    for (const release of ['R4', 'R5'] as const) cache.registerResource('CodeSystem', system, '2.0.0', release, definition('2.0.0', release));
    const questionnaire = { resourceType: 'Questionnaire', status: 'active', item: [question] };
    const response = { resourceType: 'QuestionnaireResponse', status: 'completed', item: [{ linkId: 'answer', answer: [{ valueCoding: { system, code: 'a', display: 'R5' } }] }] };
    expect(new QuestionnaireValidator(cache).validateAnyResource(response, questionnaire, {}, 'R5')
      .filter(issue => wrongDisplay.includes(issue.code ?? '')).map(issue => issue.code)).toEqual([]);
  });
  for (const [version, display, expected] of [
    ['2.0.0', 'First', []],
    ['2.0.0', 'wrong', ['qr-display-mismatch']],
    ['2.0.1', 'Second', []],
    [undefined, 'wrong', ['qr-display-mismatch']],
  ] as const) it(`answerOption display version ${version ?? 'unspecified'} ${display}`, () => {
    const cache = new ValueSetCache();
    const optionQuestion: QuestionnaireItem = { linkId: 'choice', type: 'choice',
      answerOption: [{ valueCoding: { system, version: '2.0.0', code: 'a', display: 'First' } }] };
    expect(validateQuestionnaireCodingAnswer({ valueCoding: { system, version, code: 'a', display } },
      optionQuestion, 'answer', cache, true).map(issue => issue.code)).toEqual(expected);
  });

});
