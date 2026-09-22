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
