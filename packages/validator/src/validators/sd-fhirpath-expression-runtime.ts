import { normalizePrimitiveConstraintExpression } from './fhirpath-primitive-expression.js';
import {
  AsyncFHIRPathTerminologyCache,
  evaluateAsyncFHIRPathTerminology,
  hasAsyncFHIRPathTerminology,
  type FHIRPathTerminologyResolver,
} from './fhirpath-async-terminology.js';
import {
  evaluateConstraintTarget,
  type ConstraintTargetEvaluation,
} from './sd-fhirpath-constraint-target.js';
import { SDFHIRPathExpressionCache } from './sd-fhirpath-expression-cache.js';
import { evaluateCompiledSDFHIRPath } from './sd-fhirpath-runtime.js';
import type { ValueSetCache } from './valueset-cache.js';
import { ValueSetPackageLoader } from './valueset-package-loader.js';
import { SDFHIRPathPrimitiveContext } from './sd-fhirpath-primitive-context.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

export type SDFHIRPathTargetEvaluation = Omit<
  ConstraintTargetEvaluation,
  'evaluateExpression' | 'expressionCache' | 'memberOfValueSetLoader' | 'valueSetCache'
>;

/** Owns the executable FHIRPath and terminology dependencies for constraint targets. */
export class SDFHIRPathExpressionRuntime {
  private readonly asyncExpressionCache = new AsyncFHIRPathTerminologyCache();
  private readonly primitiveContext = new SDFHIRPathPrimitiveContext();
  private readonly memberOfValueSetLoader: ValueSetPackageLoader;

  constructor(
    private readonly valueSetCache: ValueSetCache,
    private readonly expressionCache: SDFHIRPathExpressionCache,
  ) {
    this.memberOfValueSetLoader = new ValueSetPackageLoader(valueSetCache);
  }

  evaluateTarget(
    target: SDFHIRPathTargetEvaluation,
  ): ReturnType<typeof evaluateConstraintTarget> {
    return evaluateConstraintTarget({
      ...target,
      memberOfValueSetLoader: this.memberOfValueSetLoader,
      valueSetCache: this.valueSetCache,
      expressionCache: this.expressionCache,
      evaluateExpression: (expression, context, root, table, version, terminology, focus) => {
        const input = this.primitiveContext.prepare(context, target.resolveRootResource, target.path,
          target.fhirVersion, root, focus, target.decimalInput);
        return this.evaluateExpression(expression, input.context, input.rootResource, table, version, terminology, input.focusResource);
      },
    });
  }

  private evaluateExpression(
    expression: string,
    context: unknown,
    rootResource: unknown,
    userInvocationTable?: unknown,
    fhirVersion: FhirVersion = 'R4',
    terminologyResolver?: FHIRPathTerminologyResolver,
    focusResource?: unknown,
  ): unknown | Promise<unknown> {
    expression = normalizePrimitiveConstraintExpression(expression, context);
    if (terminologyResolver && hasAsyncFHIRPathTerminology(expression)) {
      return evaluateAsyncFHIRPathTerminology({
        expression,
        context,
        rootResource,
        focusResource,
        fhirVersion,
        resolver: terminologyResolver,
        userInvocationTable,
        expressionCache: this.asyncExpressionCache,
      });
    }

    const compiled = this.expressionCache.getOrCompile(expression, fhirVersion);
    if (!compiled) throw new Error(`Failed to compile FHIRPath expression: ${expression}`);
    return evaluateCompiledSDFHIRPath(
      compiled,
      context,
      rootResource,
      userInvocationTable,
      focusResource,
      fhirVersion,
    );
  }
}
