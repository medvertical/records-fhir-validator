import { describe, expect, it } from 'vitest';
import { createMemberOfFunction } from './fhirpath-custom-functions';
import { ConstraintValidator } from './constraint-validator';
import { SDFHIRPathExecutor } from './sd-fhirpath-executor';
import { atoms, definition, membershipExpression, metadataCache, valueSetUrl } from './__tests__/memberof-sync-fixtures';

type AccessorField = 'code' | 'system' | 'data';
const accessorFields: AccessorField[] = ['code', 'system', 'data'];
const malformedSystems: unknown[] = [42, null, {}, undefined, ''];

function accessorCoding(field: AccessorField, reads: { count: number }, throws = true): unknown {
  const coding = field === 'data' ? { fhirNodeDataType: 'Coding' } : { ...atoms.member };
  return Object.defineProperty(coding, field, { enumerable: true, get() {
    reads.count++;
    if (throws) throw new Error('memberOf control getter must not execute');
    return field === 'code' ? atoms.member.code : field === 'system' ? atoms.member.system : atoms.member;
  } });
}

async function evaluate(implementation: 'general' | 'SD', shape: 'trailing' | 'optional', coding: unknown[]) {
  const cache = await metadataCache();
  const profile = definition(membershipExpression(shape, valueSetUrl));
  const resource = { resourceType: 'Condition', category: [{ coding }] };
  return implementation === 'general'
    ? new ConstraintValidator(undefined, undefined, cache).validate(resource, profile.snapshot!.element, profile.url!)
    : new SDFHIRPathExecutor(cache).execute({ resource, resourceType: 'Condition', structureDef: profile });
}

function incompleteIssues() {
  return [expect.objectContaining({ severity: 'information', ruleId: 'us-core-1',
    details: expect.objectContaining({ validationComplete: false }) })];
}

describe('memberOf local Coding evidence boundaries', () => {
  it.each(malformedSystems)('does not turn present malformed system %j into bare-code evidence', async system => {
    const fn = createMemberOfFunction(await metadataCache()).fn;
    const malformed = { system, code: atoms.member.code };
    expect(fn([{ coding: [atoms.male, malformed] }], valueSetUrl)).toEqual([]);
    expect(fn([malformed], valueSetUrl)).toEqual([]);
    expect(fn([{ coding: [malformed, atoms.member] }], valueSetUrl)).toEqual([true]);
    expect(fn([{ coding: [atoms.member, malformed] }], valueSetUrl)).toEqual([true]);
  });

  it.each(accessorFields)('short-circuits before a later %s getter', async field => {
    const reads = { count: 0 };
    expect(createMemberOfFunction(await metadataCache()).fn([
      { coding: [atoms.member, accessorCoding(field, reads)] },
    ], valueSetUrl)).toEqual([true]);
    expect(reads.count).toBe(0);
  });

  it.each(accessorFields)('treats an encountered %s getter as unknown without invoking it', async field => {
    const reads = { count: 0 };
    const fn = createMemberOfFunction(await metadataCache()).fn;
    expect(fn([{ coding: [accessorCoding(field, reads), atoms.member] }], valueSetUrl)).toEqual([true]);
    expect(fn([{ coding: [atoms.male, accessorCoding(field, reads)] }], valueSetUrl)).toEqual([]);
    expect(reads.count).toBe(0);
  });

  it('does not invoke even a nonthrowing later accessor', async () => {
    const reads = { count: 0 };
    expect(createMemberOfFunction(await metadataCache()).fn([
      { coding: [atoms.member, accessorCoding('code', reads, false)] },
    ], valueSetUrl)).toEqual([true]);
    expect(reads.count).toBe(0);
  });

  it('does not treat inherited Coding or CodeableConcept fields as own data evidence', async () => {
    const fn = createMemberOfFunction(await metadataCache()).fn;
    expect(fn([{ coding: [atoms.male, Object.create(atoms.member)] }], valueSetUrl)).toEqual([]);
    expect(fn([Object.create({ coding: [atoms.male, atoms.member] })], valueSetUrl)).toEqual([]);
    expect(fn([{ coding: [atoms.male, Object.assign(Object.create({ system: atoms.member.system }), { code: atoms.member.code })] }], valueSetUrl)).toEqual([]);
    expect(fn([{ coding: [atoms.male, Object.assign(Object.create({ code: atoms.member.code }), { system: atoms.member.system })] }], valueSetUrl)).toEqual([]);
    expect(fn([Object.assign(Object.create(null), { coding: [atoms.male, atoms.member] })], valueSetUrl)).toEqual([true]);
  });

  it('does not invoke Coding-array accessors after a proved member', async () => {
    const reads = { count: 0 };
    const coding: unknown[] = [atoms.member];
    Object.defineProperty(coding, '1', { get() { reads.count++; throw new Error('later array getter'); } });
    expect(createMemberOfFunction(await metadataCache()).fn([{ coding }], valueSetUrl)).toEqual([true]);
    expect(reads.count).toBe(0);
  });
});

describe.each(['general', 'SD'] as const)('%s local memberOf evidence safety', implementation => {
  describe.each(['trailing', 'optional'] as const)('%s constraint', shape => {
    it.each(malformedSystems)('leaves malformed system %j incomplete instead of inferring membership', async system => {
      await expect(evaluate(implementation, shape, [atoms.male, { system, code: atoms.member.code }]))
        .resolves.toEqual(incompleteIssues());
    });

    it.each(accessorFields)(implementation === 'SD'
      ? 'preserves the existing SD matcher rejection for a later %s getter'
      : 'retains a proved member without touching a later %s getter', async field => {
      const reads = { count: 0 };
      const evaluation = evaluate(implementation, shape, [atoms.member, accessorCoding(field, reads)]);
      if (implementation === 'SD') {
        await expect(evaluation).rejects.toThrow('memberOf control getter must not execute');
        expect(reads.count).toBe(1);
      } else {
        await expect(evaluation).resolves.toEqual([]);
        expect(reads.count).toBe(0);
      }
    });
  });
});
