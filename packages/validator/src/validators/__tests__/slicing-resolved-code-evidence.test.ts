import { describe, expect, it } from 'vitest';
import { SlicingValidator } from '../slicing-validator.js';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import metadata from '../__fixtures__/slicing-resolved-code-mii-patho-metadata.json';

const path = 'DiagnosticReport.result';
const targets = metadata.targets as unknown as StructureDefinition[];
const names = ['intraoperative-observations', 'macroscopic-observations', 'microscopic-observations', 'additional-observations', 'diagnostic-conclusion'];
const code = (index: number) => structuredClone(targets[index].snapshot!.element[0].patternCodeableConcept);
interface Options { rules?: 'open' | 'closed' | 'openAtEnd'; ordered?: boolean; composite?: boolean; missingMetadata?: boolean; literalMin?: number; shape?: 'display' | 'identifier'; claim?: boolean }
async function check(labels: string[], options: Options = {}, discriminatorType: 'value' | 'pattern' = 'value') {
  const report = structuredClone(metadata.report) as unknown as StructureDefinition;
  const selected = options.rules === 'open' || options.rules === 'openAtEnd' ? [0, 1] : [4];
  report.snapshot!.element = report.snapshot!.element.filter(element => !element.id?.includes(':')
    || selected.some(index => element.id!.startsWith(`${path}:${names[index]}`)));
  for (const element of report.snapshot!.element) {
    if (element.path === path) element.min = 0;
    if (element.path === `${path}.reference`) element.min = options.literalMin ?? 1;
  }
  report.snapshot!.element[0].slicing = {
    rules: options.rules ?? 'closed', ordered: options.ordered ?? true,
    discriminator: [{ type: discriminatorType, path: 'resolve().code' }],
  };
  if (options.composite) {
    report.snapshot!.element[0].slicing!.discriminator!.push({ type: 'value', path: 'display' });
    for (const [index, label] of ['first', 'second'].entries()) report.snapshot!.element.push({
      id: `${path}:${names[index]}.display`, path: `${path}.display`, min: 1, max: '1', fixedString: label,
    });
  }
  const references = labels.map(label => options.shape === 'identifier'
    ? { identifier: { system: 'http://example.test/reference', value: label } }
    : options.shape === 'display' ? { display: label }
      : { reference: `Observation/${label}`, ...(options.composite ? { display: label } : {}),
        ...(options.claim ? { meta: { profile: [targets[4].url] } } : {}) });
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async canonical => options.missingMetadata ? null
    : structuredClone(targets.find(target => target.url === canonical) ?? null));
  const issues = await validator.validateSlicing(references, path, report, reference => {
    const label = reference.substring('Observation/'.length);
    if (label === 'unknown') return null;
    if (label === 'missing-code') return { resourceType: 'Observation' };
    const targetCode = label === 'bad' ? { coding: [{ system: 'http://loinc.org', code: 'known-nonmember' }] }
      : code(label === 'first' ? 0 : label === 'second' ? 1 : 4);
    return { resourceType: 'Observation', code: targetCode };
  }, path, 'R4');
  return issues;
}
const has = (issues: Awaited<ReturnType<typeof check>>, code: string) => issues.some(issue => issue.code === code);
const unknown = (issues: Awaited<ReturnType<typeof check>>) => issues.some(issue => issue.code === 'profile-slice-validation-incomplete'
  && String((issue.details as Record<string, unknown> | undefined)?.reason).startsWith('unresolved'));

describe.each(['value', 'pattern'] as const)('post-resolve code %s occurrence evidence', discriminatorType => {
  it.each(['bad', 'missing-code'].flatMap(negative => [
    ['diagnostic', negative, 'unknown'], ['unknown', 'diagnostic', negative], [negative, 'unknown', 'diagnostic'],
  ]))('keeps the proved closed negative beside unknown: %j', async (...labels) => {
    const issues = await check(labels, {}, discriminatorType);
    expect(issues.filter(issue => issue.code === 'profile-slice-closed-unmatched')).toHaveLength(1);
    expect(unknown(issues)).toBe(true);
  });

  it('does not use conditional display membership to order unknown code identities', async () => {
    const issues = await check(['second', 'first'], { rules: 'open', composite: true, missingMetadata: true }, discriminatorType);
    expect(has(issues, 'profile-slice-ordering-violation')).toBe(false);
    expect(issues.some(issue => issue.severity === 'error')).toBe(false);
    expect(unknown(issues)).toBe(true);
  });

  it.each([['second', 'unknown', 'first'], ['unknown', 'second', 'first'], ['second', 'first', 'unknown']])(
    'retains proved reversed ordering with unknown: %j', async (...labels) => {
      const issues = await check(labels, { rules: 'open' }, discriminatorType);
      expect(has(issues, 'profile-slice-ordering-violation')).toBe(true);
      expect(unknown(issues)).toBe(true);
    },
  );

  it.each([
    { labels: ['unknown', 'first'], warning: false }, { labels: ['first', 'unknown', 'second'], warning: false },
    { labels: ['bad', 'unknown', 'first'], warning: true }, { labels: ['first', 'bad', 'unknown', 'second'], warning: true },
  ])('openAtEnd gap proof: $labels', async ({ labels, warning }) => {
    const issues = await check(labels, { rules: 'openAtEnd', ordered: false }, discriminatorType);
    expect(has(issues, 'profile-slice-ordering-violation')).toBe(warning);
    expect(unknown(issues)).toBe(true);
    expect(issues.filter(issue => issue.code === 'profile-slice-open-unmatched')).toHaveLength(warning ? 1 : 0);
  });
});

it.each(['display', 'identifier'] as const)('optional literal %s reference remains unknown, required literal remains rejected', async shape => {
  for (const missingMetadata of [false, true]) {
    const optional = await check(['opaque'], { shape, literalMin: 0, missingMetadata });
    expect(optional.some(issue => issue.severity === 'error')).toBe(false);
    expect(unknown(optional)).toBe(true);
    const required = await check(['opaque'], { shape, literalMin: 1, missingMetadata });
    expect(has(required, 'profile-slice-closed-unmatched')).toBe(true);
  }
});

it('a profile claim on an unreadable Reference cannot prove a code match or nonmatch', async () => {
  const issues = await check(['unknown'], { claim: true });
  expect(has(issues, 'profile-slice-closed-unmatched')).toBe(false);
  expect(unknown(issues)).toBe(true);
});
