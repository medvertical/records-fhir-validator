import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { BatchValidationAbortedError } from '../batch-validator';
import { executeSelectedAspects } from '../multi-aspect-aspect-execution';
import { MultiAspectSessionPolicy } from '../multi-aspect-session-policy';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';
import type { AspectResult } from '../multi-aspect-types';

function deferred() {
  let resolve!: (issues: ValidationIssue[]) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ValidationIssue[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function executionOptions(deps: MultiAspectDeps, aspects: string[]) {
  const collectedAspects: AspectResult[] = [];
  const context = { resource: { resourceType: 'Patient' }, resourceType: 'Patient',
    profileUrl: 'http://hl7.org/fhir/StructureDefinition/Patient', fhirVersion: 'R4' as const,
    structureDef: { resourceType: 'StructureDefinition' as const, type: 'Patient' },
    strictMode: false, settings: undefined };
  const policy = new MultiAspectSessionPolicy(undefined);
  return {
    deps, selectedAspects: new Set(aspects), context, collectedAspects,
    profileSourceContext: { fhirVersion: 'R4' as const }, profileFallbackIssue: null,
    runCustomRules: true, recursionDepth: 0, throwIfStopped() {},
    runAspect: policy.createRunner({ collectedAspects, fhirVersion: 'R4',
      profileUrl: context.profileUrl, throwIfStopped() {} }),
    validateOne: vi.fn(), targetProfileValidator: {} as never, sdFHIRPathExecutor: {} as never,
  } as Parameters<typeof executeSelectedAspects>[0];
}

describe('multi-aspect admitted work drainage', () => {
  it('starts reference reads during profile validation but publishes them after the prerequisite', async () => {
    const profile = deferred();
    const reference = deferred();
    const referenceExecutor = vi.fn(() => reference.promise);
    const deps = {
      sdLoader: {},
      profileExecutor: { validate: vi.fn(() => profile.promise) },
      terminologyExecutor: { getFHIRPathTerminologyResolver: () => undefined },
      referenceExecutor: { validate: referenceExecutor },
      invariantExecutor: { validate: vi.fn(async () => []) },
    } as unknown as MultiAspectDeps;
    const options = executionOptions(deps, ['profile', 'reference', 'invariant']);
    options.skipTargetProfileConformance = true;

    const execution = executeSelectedAspects(options);
    expect(referenceExecutor).toHaveBeenCalledOnce();
    reference.resolve([]);
    await setImmediate();
    expect(options.collectedAspects.map(aspect => aspect.aspect)).not.toContain('reference');

    profile.resolve([]);
    await execution;
    expect(options.collectedAspects.map(aspect => aspect.aspect).sort()).toEqual(['invariant', 'profile', 'reference']);
  });

  it('drains an early reference read when the profile prerequisite is aborted', async () => {
    const profile = deferred();
    const reference = deferred();
    const deps = {
      sdLoader: {},
      profileExecutor: { validate: () => profile.promise },
      terminologyExecutor: { getFHIRPathTerminologyResolver: () => undefined },
      referenceExecutor: { validate: () => reference.promise },
      invariantExecutor: { validate: vi.fn(async () => []) },
    } as unknown as MultiAspectDeps;
    const options = executionOptions(deps, ['profile', 'reference', 'invariant']);
    options.skipTargetProfileConformance = true;
    let settled = false;
    const execution = executeSelectedAspects(options);
    void execution.finally(() => { settled = true; }).catch(() => undefined);

    profile.reject(new BatchValidationAbortedError());
    await setImmediate();
    expect(settled).toBe(false);
    reference.resolve([]);
    await expect(execution).rejects.toBeInstanceOf(BatchValidationAbortedError);
  });

  it('routes an early reference failure through the existing aspect policy', async () => {
    const profile = deferred();
    const reference = deferred();
    const deps = {
      sdLoader: {},
      profileExecutor: { validate: () => profile.promise },
      terminologyExecutor: { getFHIRPathTerminologyResolver: () => undefined },
      referenceExecutor: { validate: () => reference.promise },
      invariantExecutor: { validate: vi.fn(async () => []) },
    } as unknown as MultiAspectDeps;
    const options = executionOptions(deps, ['profile', 'reference', 'invariant']);
    options.skipTargetProfileConformance = true;
    const execution = executeSelectedAspects(options);

    reference.reject(new Error('read failed'));
    await setImmediate();
    expect(options.collectedAspects.map(aspect => aspect.aspect)).not.toContain('reference');
    profile.resolve([]);
    await execution;
    expect(options.collectedAspects.find(aspect => aspect.aspect === 'reference')?.issues)
      .toEqual([expect.objectContaining({ code: 'internal-error' })]);
  });

  it('routes a synchronous early reference failure through the existing aspect policy', async () => {
    const profile = deferred();
    const deps = {
      sdLoader: {},
      profileExecutor: { validate: () => profile.promise },
      terminologyExecutor: { getFHIRPathTerminologyResolver: () => undefined },
      referenceExecutor: { validate: () => { throw new Error('read failed immediately'); } },
      invariantExecutor: { validate: vi.fn(async () => []) },
    } as unknown as MultiAspectDeps;
    const options = executionOptions(deps, ['profile', 'reference', 'invariant']);
    options.skipTargetProfileConformance = true;
    const execution = executeSelectedAspects(options);

    expect(options.collectedAspects.map(aspect => aspect.aspect)).not.toContain('reference');
    profile.resolve([]);
    await execution;
    expect(options.collectedAspects.find(aspect => aspect.aspect === 'reference')?.issues)
      .toEqual([expect.objectContaining({ code: 'internal-error' })]);
  });

  it.each(['before-invariant', 'parallel'] as const)(
    'retains the resource until a sibling settles after %s cancellation', async phase => {
      const failing = deferred();
      const sibling = deferred();
      const invariant = vi.fn(async () => []);
      const firstExecutor = vi.fn(() => failing.promise);
      const siblingExecutor = vi.fn(() => sibling.promise);
      const deps = phase === 'before-invariant'
        ? { profileExecutor: { validate: firstExecutor }, terminologyExecutor: { validate: siblingExecutor },
          terminologyResourceValidator: { validate: () => [] }, invariantExecutor: { validate: invariant } }
        : { referenceExecutor: { validate: firstExecutor }, customRuleExecutor: { validate: siblingExecutor } };
      const aspects = phase === 'before-invariant'
        ? ['profile', 'terminology', 'invariant'] : ['reference', 'custom_rule'];
      let settled = false;
      const execution = executeSelectedAspects(executionOptions(deps as unknown as MultiAspectDeps, aspects));
      const observed = execution.then(() => { settled = true; }, () => { settled = true; });
      expect(firstExecutor).toHaveBeenCalledOnce();
      expect(siblingExecutor).toHaveBeenCalledOnce();

      failing.reject(new BatchValidationAbortedError());
      await setImmediate();
      const releasedBeforeSibling = settled;
      sibling.resolve([]);
      await expect(execution).rejects.toBeInstanceOf(BatchValidationAbortedError);
      await observed;

      expect(releasedBeforeSibling).toBe(false);
      expect(invariant).not.toHaveBeenCalled();
    },
  );
});
