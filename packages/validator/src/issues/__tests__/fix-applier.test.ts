import { describe, it, expect } from 'vitest';
import { applyFixPatch } from '../fix-applier';

const patient = () => ({
  resourceType: 'Patient',
  id: 'p1',
  name: [{ family: 'Smoke', given: ['Test'] }],
  identifier: [
    { system: 'http://example.org', value: 'A' },
    { system: 'http://example.org', value: 'B' },
  ],
});

describe('applyFixPatch — add', () => {
  it('adds a missing scalar field', () => {
    const result = applyFixPatch(patient(), {
      action: 'add',
      path: 'Patient.gender',
      value: 'other',
    });
    expect(result.applied).toBe(true);
    expect((result.resource as any).gender).toBe('other');
  });

  it('coerces JSON-shaped values into objects', () => {
    const result = applyFixPatch(patient(), {
      action: 'add',
      path: 'Patient.meta',
      value: '{"versionId": "1", "lastUpdated": "2026-05-03"}',
    });
    expect(result.applied).toBe(true);
    expect((result.resource as any).meta).toEqual({ versionId: '1', lastUpdated: '2026-05-03' });
  });

  it('creates intermediate objects when adding into a missing parent', () => {
    const r = patient();
    delete (r as any).meta;
    const result = applyFixPatch(r, {
      action: 'add',
      path: 'Patient.meta.versionId',
      value: '42',
    });
    expect(result.applied).toBe(true);
    expect((result.resource as any).meta).toEqual({ versionId: 42 });
  });

  it('appends into an existing array via [n]', () => {
    const result = applyFixPatch(patient(), {
      action: 'add',
      path: 'Patient.identifier[2].system',
      value: 'http://newsystem.org',
    });
    expect(result.applied).toBe(true);
    const id = (result.resource as any).identifier[2];
    expect(id).toEqual({ system: 'http://newsystem.org' });
  });

  it('treats resource-type-prefixed and bare paths the same', () => {
    const a = applyFixPatch(patient(), { action: 'add', path: 'gender', value: 'other' });
    const b = applyFixPatch(patient(), { action: 'add', path: 'Patient.gender', value: 'other' });
    expect((a.resource as any).gender).toBe((b.resource as any).gender);
  });
});

describe('applyFixPatch — replace', () => {
  it('replaces an existing scalar value', () => {
    const result = applyFixPatch(patient(), {
      action: 'replace',
      path: 'Patient.identifier[0].value',
      value: 'AAA',
    });
    expect(result.applied).toBe(true);
    expect((result.resource as any).identifier[0].value).toBe('AAA');
    // Sibling untouched
    expect((result.resource as any).identifier[1].value).toBe('B');
  });

  it('rejects replace when the target field does not exist', () => {
    const result = applyFixPatch(patient(), {
      action: 'replace',
      path: 'Patient.gender',
      value: 'other',
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/Cannot replace missing field/);
  });

  it('rejects replace when the array index has no entry', () => {
    const result = applyFixPatch(patient(), {
      action: 'replace',
      path: 'Patient.identifier[5].value',
      value: 'X',
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/does not exist/);
  });

  it('rejects replace on a top-level array index that is out of bounds', () => {
    const r = patient();
    const result = applyFixPatch(r, {
      action: 'replace',
      path: 'Patient.identifier[5]',
      value: '{"system":"http://x","value":"Y"}',
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/out of bounds/);
  });
});

describe('applyFixPatch — remove', () => {
  it('removes a scalar field', () => {
    const result = applyFixPatch(patient(), { action: 'remove', path: 'Patient.id' });
    expect(result.applied).toBe(true);
    expect('id' in (result.resource as any)).toBe(false);
  });

  it('removes an array entry by index', () => {
    const result = applyFixPatch(patient(), {
      action: 'remove',
      path: 'Patient.identifier[0]',
    });
    expect(result.applied).toBe(true);
    expect((result.resource as any).identifier).toHaveLength(1);
    expect((result.resource as any).identifier[0].value).toBe('B');
  });
});

describe('applyFixPatch — rejection cases', () => {
  it('rejects unresolved templates in the path', () => {
    const r = applyFixPatch(patient(), {
      action: 'replace',
      path: 'Patient.{{field}}',
      value: 'x',
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/unresolved/);
  });

  it('rejects unresolved templates in the value', () => {
    const r = applyFixPatch(patient(), {
      action: 'replace',
      path: 'Patient.id',
      value: '{{newId}}',
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/unresolved/);
  });

  it('rejects unknown actions', () => {
    const r = applyFixPatch(patient(), {
      action: 'mutate' as any,
      path: 'Patient.id',
      value: 'x',
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/Unknown patch action/);
  });

  it('rejects add/replace without a value', () => {
    const r = applyFixPatch(patient(), {
      action: 'add',
      path: 'Patient.gender',
    } as any);
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/requires a value/);
  });
});

describe('applyFixPatch — immutability', () => {
  it('does not mutate the input resource', () => {
    const input = patient();
    const before = JSON.stringify(input);
    applyFixPatch(input, { action: 'add', path: 'Patient.gender', value: 'other' });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('returns the original resource on failure', () => {
    const input = patient();
    const r = applyFixPatch(input, {
      action: 'replace',
      path: 'Patient.does.not.exist',
      value: 'x',
    });
    expect(r.applied).toBe(false);
    expect(r.resource).toBe(input);
  });
});
