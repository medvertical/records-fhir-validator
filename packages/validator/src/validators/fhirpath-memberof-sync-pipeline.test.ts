import { describe, expect, it, vi } from 'vitest';
import { ConstraintValidator } from './constraint-validator';
import { SDFHIRPathExecutor } from './sd-fhirpath-executor';
import type { FHIRPathTerminologyResolver } from './fhirpath-terminology-types';
import type { ValueSetCache } from './valueset-cache';
import { atoms, definition, membershipExpression, metadataCache, requestedVersion, valueSetUrl,
  versionCache, versionCanonical, versionEvidence, type AtomName, type Verdict } from './__tests__/memberof-sync-fixtures';

const implementations = ['general', 'SD'] as const;
const shapes = ['trailing', 'optional'] as const;

function expectedIssues(verdict: Verdict) {
  if (verdict === 'valid') return [];
  return [expect.objectContaining(verdict === 'invalid'
    ? { severity: 'warning', ruleId: 'us-core-1' }
    : { severity: 'information', ruleId: 'us-core-1', details: expect.objectContaining({ validationComplete: false }) })];
}

function resolver(outcome: Verdict): FHIRPathTerminologyResolver {
  return { resolveCodeMembership: vi.fn().mockResolvedValue(outcome), resolveSubsumption: vi.fn().mockResolvedValue('unknown') };
}

function run(implementation: typeof implementations[number], shape: typeof shapes[number], cache: ValueSetCache,
  coding: unknown[], requested: string, scoped?: FHIRPathTerminologyResolver) {
  const resource = { resourceType: 'Condition', category: [{ coding }] };
  const profile = definition(membershipExpression(shape, requested));
  return implementation === 'general'
    ? new ConstraintValidator(scoped, undefined, cache).validate(resource, profile.snapshot!.element, profile.url!)
    : new SDFHIRPathExecutor(cache).execute({ resource, resourceType: 'Condition', structureDef: profile, terminologyResolver: scoped });
}

describe.each(implementations)('%s synchronous memberOf pipeline', implementation => {
  describe.each(shapes)('%s constraint', shape => {
    it.each<[AtomName[], Verdict]>([
      [['member'], 'valid'], [['male'], 'invalid'], [['male', 'member'], 'valid'], [['member', 'male'], 'valid'],
      [['male', 'female', 'member'], 'valid'], [['member', 'female', 'male'], 'valid'], [['male', 'female'], 'invalid'],
    ])('uses original valid Coding sequence %j', async (names, expected) => {
      for (const configured of [false, true]) {
        const scoped = configured ? resolver('invalid') : undefined;
        if (scoped) vi.mocked(scoped.resolveCodeMembership).mockImplementation(async (code, system, url) =>
          code === atoms.member.code && system === atoms.member.system && url === valueSetUrl ? 'valid' : 'invalid');
        await expect(run(implementation, shape, await metadataCache(), names.map(name => atoms[name]), valueSetUrl, scoped))
          .resolves.toEqual(expectedIssues(expected));
      }
    });

    it('does not reject unknown Coding values without an authoritative resolver', async () => {
      await expect(run(implementation, shape, await metadataCache(), [atoms.male, null], valueSetUrl))
        .resolves.toEqual(expectedIssues('unverified'));
    });

    it.each(versionEvidence)('uses $name', async evidence => {
      const requested = evidence.unversioned ? versionCanonical : requestedVersion;
      for (const configured of [false, true]) {
        const scoped = configured ? resolver(evidence.expected) : undefined;
        await expect(run(implementation, shape, versionCache(evidence), [atoms.member], requested, scoped))
          .resolves.toEqual(expectedIssues(evidence.expected));
        if (scoped && evidence.expected === 'unverified') {
          expect(scoped.resolveCodeMembership).toHaveBeenCalledWith(atoms.member.code, atoms.member.system, requested, 'R4');
        }
      }
    });

    it.each(['valid', 'invalid', 'unverified'] as const)('defers missing exact version to its %s resolver result', async outcome => {
      const scoped = resolver(outcome);
      const cache = versionCache({ name: 'missing exact', base: 'member', expected: 'unverified' });
      await expect(run(implementation, shape, cache, [atoms.member], requestedVersion, scoped)).resolves.toEqual(expectedIssues(outcome));
      expect(scoped.resolveCodeMembership).toHaveBeenCalledWith(atoms.member.code, atoms.member.system, requestedVersion, 'R4');
    });
  });
});
