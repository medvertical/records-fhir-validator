/** Validates StructureDefinition FHIRPath constraints against resource and slice targets. */
import type { ElementDefinition } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { ConstraintEvaluationEngine } from './constraint-evaluation-engine.js';
import { evaluateConstraintFHIRPath } from './constraint-fhirpath-evaluator.js';
import type { FHIRPathTerminologyResolver } from './fhirpath-async-terminology.js';
import type { ConstraintValidationOptions } from './constraint-validation-input.js';
import type { FHIRPathConstraintDiagnostics } from './fhirpath-constraint-diagnostics.js';
import { ValueSetCache } from './valueset-cache.js';
import { ConstraintExpressionCache } from './constraint-expression-cache.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import { ConstraintValidationPipeline } from './constraint-validation-pipeline.js';

export type { FHIRPathConstraintDiagnostics, FHIRPathConstraintSkipSample } from './fhirpath-constraint-diagnostics.js';

export class ConstraintValidator {
  private readonly evaluationEngine: ConstraintEvaluationEngine;
  private readonly validationPipeline: ConstraintValidationPipeline;
  private evaluateFHIRPath: typeof evaluateConstraintFHIRPath;

  constructor(
    terminologyResolver?: FHIRPathTerminologyResolver,
    evaluateFHIRPath: typeof evaluateConstraintFHIRPath = evaluateConstraintFHIRPath,
    private readonly valueSetCache: ValueSetCache = new ValueSetCache(),
    expressionCache: ConstraintExpressionCache = new ConstraintExpressionCache(),
    private readonly operationCache?: TerminologyOperationCache,
  ) {
    this.evaluateFHIRPath = evaluateFHIRPath;
    this.evaluationEngine = new ConstraintEvaluationEngine(
      terminologyResolver,
      (...args) => this.evaluateFHIRPath(...args),
      this.valueSetCache,
      expressionCache,
    );
    this.validationPipeline = new ConstraintValidationPipeline(
      this.evaluationEngine,
      this.valueSetCache,
      this.operationCache,
    );
  }

  validate(
    input: unknown,
    elements: ElementDefinition[],
    profileUrl: string,
    options?: ConstraintValidationOptions,
  ): Promise<ValidationIssue[]> {
    return this.validationPipeline.validate(input, elements, profileUrl, options);
  }

  getDiagnostics(): FHIRPathConstraintDiagnostics {
    return this.evaluationEngine.getDiagnostics();
  }

  clearDiagnostics(): void {
    this.evaluationEngine.clearDiagnostics();
  }

  getExpressionCacheStats(): ReturnType<ConstraintExpressionCache['getStats']> {
    return this.evaluationEngine.getExpressionCacheStats();
  }

  clearExpressionCache(): void {
    this.evaluationEngine.clearExpressionCache();
  }

}
