/**
 * The structural engines the dispatcher actually implements.
 *
 * `StructuralValidationEngine` also carries `server`, which is declared in the
 * settings schema but has no branch in the dispatcher — it throws. Persisted
 * settings must keep parsing, so the declared union stays as it is and this
 * narrower list is what the UI may offer and what the dispatcher names when it
 * refuses a value.
 */
export const DISPATCHABLE_STRUCTURAL_ENGINES = ['records', 'hapi', 'schema'] as const;

export type DispatchableStructuralEngine = (typeof DISPATCHABLE_STRUCTURAL_ENGINES)[number];

export function isDispatchableStructuralEngine(
  value: unknown,
): value is DispatchableStructuralEngine {
  return typeof value === 'string'
    && (DISPATCHABLE_STRUCTURAL_ENGINES as readonly string[]).includes(value);
}
