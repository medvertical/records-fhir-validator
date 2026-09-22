import { ConstraintExpressionCache } from './constraint-expression-cache.js';
import type { ConstraintValidationState, FhirResource } from './constraint-validation-input.js';
import {
  evaluateAsyncFHIRPathTerminology,
  hasAsyncFHIRPathTerminology,
  AsyncFHIRPathTerminologyCache,
  type FHIRPathTerminologyResolver,
} from './fhirpath-async-terminology.js';
import { toFHIRPathInvocationTable } from './sd-fhirpath-runtime.js';

export function evaluateConstraintFHIRPath(
  context: unknown,
  expression: string,
  rootResource: FhirResource,
  fhirVersion: ConstraintValidationState['fhirVersion'],
  userInvocationTable: ConstraintValidationState['userInvocationTable'],
  terminologyResolver?: FHIRPathTerminologyResolver,
  expressionCache: ConstraintExpressionCache = new ConstraintExpressionCache(),
  asyncExpressionCache: AsyncFHIRPathTerminologyCache = new AsyncFHIRPathTerminologyCache(),
): unknown | Promise<unknown> {
  if (terminologyResolver && hasAsyncFHIRPathTerminology(expression)) {
    return evaluateAsyncFHIRPathTerminology({
      expression,
      context,
      rootResource,
      fhirVersion,
      resolver: terminologyResolver,
      userInvocationTable,
      expressionCache: asyncExpressionCache,
    });
  }
  const compiled = expressionCache.getOrCompile(expression, fhirVersion);
  const invocationTable = toFHIRPathInvocationTable(userInvocationTable);
  return compiled(
    context,
    { resource: rootResource, rootResource },
    {
      traceFn: () => {},
      ...(invocationTable ? { userInvocationTable: invocationTable } : {}),
    },
  );
}
