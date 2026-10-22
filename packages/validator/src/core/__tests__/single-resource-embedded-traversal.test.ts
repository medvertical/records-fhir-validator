import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RecordsValidator } from '../validator-engine';
import { StructuralExecutor } from '../executors/structural-executor';

const base = 'http://hl7.org/fhir/StructureDefinition/';
const bundle = (resource: unknown) => ({ resourceType: 'Bundle', type: 'collection', entry: [{ resource }] });

describe('single-resource embedded traversal', () => {
  let validator: RecordsValidator;

  beforeAll(async () => {
    validator = new RecordsValidator({ autoDownload: false, enableCaching: true, strictMode: false });
    await validator.waitForInitialization();
  }, 120_000);

  afterEach(() => vi.restoreAllMocks());

  it.each(['contained', 'parameters', 'bundle'])('visits descendants once across additional %s profiles', async kind => {
    const leaf = { resourceType: 'Patient', id: 'leaf', identifier: [{ system: 'urn:oid:1', value: 'test' }] };
    const child = { resourceType: 'Parameters', id: 'parent',
      meta: { profile: [`${base}Parameters`, `${base}Parameters|4.0.1`] },
      parameter: [{ name: 'patient', resource: leaf }],
    };
    const resource = kind === 'contained' ? { resourceType: 'Patient', contained: [child] }
      : kind === 'parameters' ? { resourceType: 'Parameters', parameter: [{ name: 'group', resource: child }] }
        : bundle(child);
    const structural = vi.spyOn(StructuralExecutor.prototype, 'validate');

    const issues = await validator.validate(resource);

    expect(structural.mock.calls.filter(([target]) => target === leaf)).toHaveLength(1);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'structural-invalid-uri' }));
    expect(issues.some(issue => issue.code === 'validation-error')).toBe(false);
  }, 120_000);

  it('retains code-inferred attribution for an unprofiled Bundle entry', async () => {
    const issues = await validator.validate(bundle({ resourceType: 'Observation', status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
    }));

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-code-inferred-signpost', path: expect.stringContaining('Bundle.entry[0].resource'),
      details: expect.objectContaining({ profileSource: 'code-inferred' }),
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-cardinality-min', aspect: 'profile', profile: `${base}bp`,
      details: expect.objectContaining({ profileSource: 'code-inferred' }),
    }));
  }, 120_000);

  it('visits nested Bundle children once and stops at the embedding depth limit', async () => {
    const withinLimit = { resourceType: 'Patient', id: 'depth-three' };
    const beyondLimit = { resourceType: 'Patient', id: 'depth-four' };
    const structural = vi.spyOn(StructuralExecutor.prototype, 'validate');

    await validator.validate(bundle(bundle(bundle(withinLimit))));
    await validator.validate(bundle(bundle(bundle(bundle(beyondLimit)))));

    expect(structural.mock.calls.filter(([target]) => target === withinLimit)).toHaveLength(1);
    expect(structural.mock.calls.filter(([target]) => target === beyondLimit)).toHaveLength(0);
  }, 120_000);
});
