import type { MultiAspectValidateResult } from './multi-aspect-types.js';

export interface SemanticAspectPlan {
  requested: ReadonlySet<string>;
  executors: ReadonlySet<string>;
}

/** Executor names describe implementation; emitted aspect labels describe findings. */
export function resolveSemanticAspectPlan(aspects: readonly string[]): SemanticAspectPlan {
  const requested = new Set(aspects);
  const executors = new Set(aspects);
  if (['structural', 'profile', 'reference', 'terminology', 'invariant'].some(aspect => requested.has(aspect))) {
    // Profile/invariant emit base and imposed-profile constraints. Structural
    // also emits reference/terminology findings; invariant consumes profile context.
    for (const dependency of ['structural', 'profile', 'invariant']) executors.add(dependency);
  }
  return { requested, executors };
}

/** Preserve partial findings without turning an incomplete dependency into a valid result. */
export function projectSemanticAspectResult(
  result: MultiAspectValidateResult,
  plan: SemanticAspectPlan,
): MultiAspectValidateResult {
  const incomplete = new Set<string>();
  const markDependentAspects = (dependency: string) => {
    for (const requested of plan.requested) {
      if (resolveSemanticAspectPlan([requested]).executors.has(dependency)) incomplete.add(requested);
    }
  };
  for (const aspect of result.aspects) {
    if (!plan.executors.has(aspect.aspect)) continue;
    if (aspect.isValid === false && !aspect.issues.some(issue => ['error', 'fatal'].includes(issue.severity))) {
      markDependentAspects(aspect.aspect);
    }
    for (const issue of aspect.evidenceIssues ?? aspect.issues) {
      if (['internal-error', 'validation-error', 'profile-not-found'].includes(issue.code ?? '')) {
        if (!plan.requested.has(aspect.aspect)) throw new Error('Required validation dependency could not be completed');
        markDependentAspects(aspect.aspect);
      }
      if (['profile-not-resolved', 'structural-resource-type-mismatch'].includes(issue.code ?? '')
        || (typeof issue.details === 'object' && issue.details?.validationComplete === false)) {
        if (!result.structureDef) throw new Error('Required validation dependency could not be completed');
        markDependentAspects(aspect.aspect);
      }
    }
  }
  const aspects = result.aspects.filter(aspect => plan.requested.has(aspect.aspect))
    .map(aspect => incomplete.has(aspect.aspect) ? { ...aspect, isValid: false } : aspect);
  if ([...plan.requested].some(required => !aspects.some(aspect => aspect.aspect === required))) {
    throw new Error('Required validation aspect could not be completed');
  }
  return { ...result, aspects, isValid: aspects.every(aspect => aspect.isValid) };
}
