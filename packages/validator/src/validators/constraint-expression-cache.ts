import fhirpath from 'fhirpath';
import { getFhirPathModel } from './fhirpath-model-resolver.js';
import { rewriteCollectionTypeOperators } from './fhirpath-as-operator-rewrite.js';
import {
  VersionedExpressionCache,
  type FHIRPathExpressionCacheStats,
} from './fhirpath-expression-cache-core.js';

function compileFHIRPathExpression(expression: string, fhirVersion: 'R4' | 'R5' | 'R6') {
  return fhirpath.compile(
    rewriteCollectionTypeOperators(expression),
    getFhirPathModel(fhirVersion),
    { async: false },
  );
}

export type CompiledFHIRPathExpression = ReturnType<typeof compileFHIRPathExpression>;

export interface SynchronousFHIRPathExpressionCache {
  getOrCompile(
    expression: string,
    fhirVersion?: 'R4' | 'R5' | 'R6',
  ): CompiledFHIRPathExpression | null;
}

export class ConstraintExpressionCache {
  private readonly expressions = new VersionedExpressionCache<CompiledFHIRPathExpression>({
    maxSize: 500,
    compile: compileFHIRPathExpression,
  });

  getOrCompile(
    expression: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): CompiledFHIRPathExpression {
    return this.expressions.getOrCompile(expression, fhirVersion);
  }

  getStats(): FHIRPathExpressionCacheStats {
    return this.expressions.getStats();
  }

  clear(): void {
    this.expressions.clear();
  }
}
