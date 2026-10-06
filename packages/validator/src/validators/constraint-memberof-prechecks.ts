import type { ConstraintExpressionCache } from './constraint-expression-cache.js';
import {
  evaluateCachedMemberOf,
  evaluateSimpleMemberOfExists,
  rewriteLegacyValueSetInExists,
  type MemberOfPrecheckResult,
} from './fhirpath-memberof-precheck.js';
import type { ValueSetCache } from './valueset-cache.js';
import { ValueSetPackageLoader } from './valueset-package-loader.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

/** Owns the cache-backed MemberOf special cases used before general FHIRPath evaluation. */
export class ConstraintMemberOfPrechecks {
  private readonly valueSetLoader: ValueSetPackageLoader;

  constructor(
    private readonly valueSetCache: ValueSetCache,
    private readonly expressionCache: ConstraintExpressionCache,
  ) {
    this.valueSetLoader = new ValueSetPackageLoader(valueSetCache);
  }

  evaluateSimple(
    expression: string,
    resource: unknown,
    resourceType: string,
    fhirVersion: FhirVersion,
    deferUnavailableTerminology: boolean,
  ): Promise<MemberOfPrecheckResult> {
    return evaluateSimpleMemberOfExists(
      expression,
      resource,
      resourceType,
      this.valueSetLoader,
      fhirVersion,
      deferUnavailableTerminology,
    );
  }

  evaluateCached(
    expression: string,
    resource: unknown,
    fhirVersion: FhirVersion,
    deferUnavailableTerminology: boolean,
  ): Promise<MemberOfPrecheckResult> {
    return evaluateCachedMemberOf(
      expression,
      resource,
      this.valueSetCache,
      this.valueSetLoader,
      fhirVersion,
      deferUnavailableTerminology,
      this.expressionCache,
    );
  }

  rewriteLegacyExpression(expression: string): string {
    return rewriteLegacyValueSetInExists(expression);
  }
}
