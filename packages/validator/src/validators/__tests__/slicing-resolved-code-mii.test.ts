import { describe, expect, it } from 'vitest';
import { SlicingValidator } from '../slicing-validator.js';
import { extractSlicingInfo } from '../slice-info-extractor.js';
import { assignElementsToSlices } from '../slicing-match-assignment.js';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import metadata from '../__fixtures__/slicing-resolved-code-mii-patho-metadata.json';

const report = metadata.report as unknown as StructureDefinition;
const targets = metadata.targets as unknown as StructureDefinition[];
const diagnostic = targets[4];
const names = ['intraoperative-observations', 'macroscopic-observations', 'microscopic-observations', 'additional-observations', 'diagnostic-conclusion'];
const path = 'DiagnosticReport.result';
const code = (definition: StructureDefinition) => definition.snapshot!.element.find(element => element.path === 'Observation.code')!.patternCodeableConcept;

type Target = { resourceType: string; id: string; code?: unknown; meta?: { profile: string[] } };
type Mode = 'available' | 'missing' | 'throws' | 'no-pattern' | 'wrong-canonical' | 'partial-alternatives' | 'wrong-version';

async function check(
  target: Target | null,
  discriminatorType: 'value' | 'pattern',
  mode: Mode = 'available',
  reference: unknown = { reference: 'Observation/ap6-target' },
  requiredReference = true,
) {
  const definition = structuredClone(report);
  definition.snapshot!.element[0].slicing!.discriminator = [{ type: discriminatorType, path: 'resolve().code' }];
  if (!requiredReference) definition.snapshot!.element.filter(element => element.path === `${path}.reference`).forEach(element => { element.min = 0; });
  const diagnosticSlice = definition.snapshot!.element.find(element => element.sliceName === 'diagnostic-conclusion')!;
  if (mode === 'partial-alternatives') diagnosticSlice.type![0].targetProfile!.push('http://example.test/ap6/unavailable-alternative');
  if (mode === 'wrong-version') diagnosticSlice.type![0].targetProfile = [`${diagnostic.url}|2026.0.2`];
  const calls: Array<{ canonical: string; family?: string; source?: string }> = [];
  const resolver = async (canonical: string, family?: string, source?: { url?: string }) => {
    calls.push({ canonical, family, source: source?.url });
    if (mode === 'throws') throw new Error('isolated metadata failure');
    if (mode === 'missing') return null;
    const found = targets.find(candidate => candidate.url === canonical.split('|')[0]);
    if (!found) return null;
    const result = structuredClone(found);
    if (mode === 'no-pattern') result.snapshot!.element.forEach(element => { delete element.patternCodeableConcept; });
    if (mode === 'wrong-canonical') result.url = 'http://example.test/ap6/another-definition';
    return result;
  };
  const slicing = await extractSlicingInfo(path, definition, resolver, { loadValueSet: async () => null }, path);
  const assignment = assignElementsToSlices([reference], slicing!.slices, slicing!.slicing, () => target);
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(resolver);
  const issues = await validator.validateSlicing([reference], path, definition, () => target, path, 'R4');
  return { issues, identities: [...assignment.sliceMatches.keys()], calls, slicing };
}

const summary = (issues: Awaited<ReturnType<typeof check>>['issues']) => issues.map(issue => ({ code: issue.code, severity: issue.severity, reason: (issue.details as Record<string, unknown> | undefined)?.reason }));

describe.each(['value', 'pattern'] as const)('resolved code %s discriminator using original Patho metadata', discriminatorType => {
  it.each(targets.flatMap((target, index) => ['none', 'matching', 'other'].map(claim => ({ index, target, claim }))))(
    'identifies code from target $index with $claim profile claim', async ({ index, target, claim }) => {
      const resource: Target = { resourceType: 'Observation', id: 'ap6-target', code: structuredClone(code(target)) };
      if (claim !== 'none') resource.meta = { profile: [(claim === 'matching' ? target : targets[(index + 1) % targets.length]).url] };
      const result = await check(resource, discriminatorType);
      expect(result.identities).toEqual([names[index]]);
      const codes = result.issues.map(issue => issue.code);
      expect(codes.includes('profile-slice-closed-unmatched')).toBe(false);
      expect(codes.includes('profile-slice-min-cardinality')).toBe(index !== 4);
      // Slice identity never attests other target-profile constraints or a false claim.
    },
  );

  it.each(['wrong-system', 'nonmember', 'missing', 'text-only'].flatMap(kind => [false, true].map(claim => ({ kind, claim }))))(
    'rejects known $kind code nonmatch with claim=$claim', async ({ kind, claim }) => {
      const target: Target = { resourceType: 'Observation', id: 'ap6-target' };
      if (kind === 'wrong-system') target.code = { coding: [{ system: 'http://example.test/ap6/not-loinc', code: '22637-3' }] };
      if (kind === 'nonmember') target.code = { coding: [{ system: 'http://loinc.org', code: 'AP6-known-pattern-nonmatch' }] };
      if (kind === 'text-only') target.code = { text: 'Transient synthetic label' };
      if (claim) target.meta = { profile: [diagnostic.url] };
      const result = await check(target, discriminatorType);
      expect(result.identities).toEqual([]);
      expect(result.issues.map(issue => issue.code)).toContain('profile-slice-closed-unmatched');
      expect(result.issues.some(issue => String((issue.details as Record<string, unknown> | undefined)?.reason).startsWith('unresolved-'))).toBe(false);
    },
  );

  it.each(['missing', 'throws', 'no-pattern', 'wrong-canonical', 'partial-alternatives', 'wrong-version'] as const)(
    'retains unresolved %s definition evidence despite a positive profile claim', async mode => {
      const result = await check({ resourceType: 'Observation', id: 'ap6-target', code: structuredClone(code(diagnostic)), meta: { profile: [diagnostic.url] } }, discriminatorType, mode);
      expect(summary(result.issues).some(issue => String(issue.reason).startsWith('unresolved-'))).toBe(true);
      expect(result.issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal')).toBe(false);
      expect(result.identities).toEqual([]);
    },
  );

  it('keeps target availability distinct from discriminator metadata availability', async () => {
    for (const mode of ['available', 'missing'] as const) {
      const result = await check(null, discriminatorType, mode);
      expect(summary(result.issues)).toContainEqual({ code: 'profile-slice-validation-incomplete', severity: 'warning', reason: 'unresolved-reference-discriminator' });
      expect(result.issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(false);
    }
  });

  it.each([{ identifier: { value: 'opaque-target' } }, { display: 'Transient target' }, {}])(
    'keeps known required-reference profile rejection when code definitions are unavailable (%j)', async reference => {
      const result = await check(null, discriminatorType, 'missing', reference);
      expect(result.issues.map(issue => issue.code)).toContain('profile-slice-closed-unmatched');
      expect(result.issues.some(issue => String((issue.details as Record<string, unknown> | undefined)?.reason).startsWith('unresolved-'))).toBe(true);
    },
  );

  it.each([{ identifier: { value: 'opaque-target' } }, { display: 'Transient target' }])(
    'does not infer a base structural error from missing literal URI (%j)', async reference => {
      const result = await check(null, discriminatorType, 'missing', reference, false);
      expect(result.issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal')).toBe(false);
      expect(result.issues.some(issue => String((issue.details as Record<string, unknown> | undefined)?.reason).startsWith('unresolved-'))).toBe(true);
    },
  );

  it('does not treat a primitive sidecar as proof that the required element is absent', async () => {
    const result = await check(null, discriminatorType, 'missing', { _reference: { extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'unknown' }] } });
    expect(result.issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal')).toBe(false);
    expect(result.issues.some(issue => String((issue.details as Record<string, unknown> | undefined)?.reason).startsWith('unresolved-'))).toBe(true);
  });

  it('forwards the bound FHIR family and referencing-profile context to real target lookup', async () => {
    const result = await check({ resourceType: 'Observation', id: 'ap6-target', code: structuredClone(code(diagnostic)) }, discriminatorType);
    expect(result.calls.filter(call => call.family !== undefined)).toEqual(targets.map(target => ({ canonical: target.url, family: 'R4', source: report.url })));
    const slices = result.slicing!.slices;
    expect(slices.flatMap(slice => [...slice.childPatterns?.keys() ?? []])).not.toContain('code');
    expect(slices.flatMap(slice => [...slice.childFixed?.keys() ?? []])).not.toContain('code');
    expect(slices.map(slice => slice.childMin?.get('reference'))).toEqual([1, 1, 1, 1, 1]);
  });
});

it('pins original definition and package metadata provenance without asserting SDK selection', () => {
  expect(metadata.originalSources.map(source => source.sha256)).toEqual([
    'fbdaf8a57d9fc7ffae4bb01ee0b156c764e59ed4c902ae64b26d7875ff67a650',
    '25f9021e935256931de7f97807259c3e6b134cf239b79c70f8b0076c067a0664',
    '3441d1a0046f5ae2984e6597467f532825b7e83cbd95321cbbb1dd31ed29a286',
    '69cda786a72166b0d7e36c1f5de4733cbc614298a9b171cbaf1be13bcae9dd5a',
    '141f579e0b10333c49c632bbf2e9570a1f646a0c90d290e6f37e01b6634e5ac9',
    '0f66e0b787e7eca5890e984ab252b0574d5477a4980a78cd2bdbd17cb435526c',
  ]);
  expect(metadata.packageSource.manifestSha256).toBe('436183138e6d6a80dc64bcd064266ed9f047a3171f4dfe6e21e830879033b6ec');
  expect(metadata.packageSource.directoryInventorySha256).toBe('eacc6dc4506afb4ea2ed069bf55eed1fc45c3704b793f15ccc8b1b7979bb19e3');
});

describe('explicit synthetic fixed-code definition contract', () => {
  it.each((['value', 'pattern'] as const).flatMap(discriminatorType => ['exact', 'wrong-system', 'missing'].map(kind => ({ discriminatorType, kind }))))(
    'uses fixed code evidence with $discriminatorType/$kind', async ({ discriminatorType, kind }) => {
      const fixedTarget = structuredClone(diagnostic);
      fixedTarget.url = 'http://example.test/ap6/synthetic-fixed-code';
      const codeElement = fixedTarget.snapshot!.element[0];
      const fixedCode = structuredClone(codeElement.patternCodeableConcept);
      delete codeElement.patternCodeableConcept;
      codeElement.fixedCodeableConcept = fixedCode;
      const definition = structuredClone(report);
      definition.snapshot!.element = definition.snapshot!.element.filter(element => !element.sliceName || element.sliceName === 'diagnostic-conclusion');
      definition.snapshot!.element = definition.snapshot!.element.filter(element => element.path !== `${path}.reference` || element.id === `${path}:diagnostic-conclusion.reference`);
      definition.snapshot!.element[0].slicing!.discriminator = [{ type: discriminatorType, path: 'resolve().code' }];
      definition.snapshot!.element.find(element => element.sliceName)!.type![0].targetProfile = [fixedTarget.url];
      const target: Target = { resourceType: 'Observation', id: 'ap6-target' };
      if (kind === 'exact') target.code = structuredClone(fixedCode);
      if (kind === 'wrong-system') target.code = { coding: [{ system: 'http://example.test/ap6/not-loinc', code: '22637-3' }] };
      const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
      validator.setTypeProfileResolver(async () => fixedTarget);
      const issues = await validator.validateSlicing([{ reference: 'Observation/ap6-target' }], path, definition, () => target);
      expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(kind !== 'exact');
      expect(issues.some(issue => String((issue.details as Record<string, unknown> | undefined)?.reason).startsWith('unresolved-'))).toBe(false);
    },
  );
});
