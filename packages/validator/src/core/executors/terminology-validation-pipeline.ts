import { createTerminologyEvidencePort } from './terminology-validation-evidence-port.js';
import type { ProfileSourceContext } from '../../persistence/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ValueSetCache } from '../../validators/valueset-cache.js';
import { UcumCodeValidator } from '../../validators/ucum-validator.js';
import { instanceElementPaths, loadContentReferenceSources } from '../content-reference-elements.js';
import type { StructureDefinition } from '../structure-definition-types.js';
import { CodeSystemReferenceLookupCache } from './terminology-code-system-reference-rules.js';
import { TerminologyElementPlanCache } from './terminology-element-plan-cache.js';
import { validateTerminologyElement } from './terminology-element-validator.js';
import { appendTerminologyFailure } from './terminology-executor-helpers.js';
import { createTerminologyGlobalRules } from './terminology-global-rule-plan.js';
import { TerminologySlicePlanCache } from './terminology-slice-plan-cache.js';
import type { TerminologyValidationPort } from './terminology-validation-port.js';

export interface TerminologyValidationContext {
  resource: unknown;
  /** Falls back to `resource.resourceType`; only needed for embedded non-resource values. */
  resourceType?: string;
  structureDef: StructureDefinition;
  getValueAtPath: (resource: unknown, path: string) => unknown;
  fhirVersion?: 'R4' | 'R5' | 'R6';
  sourceContext?: ProfileSourceContext;
}

/** Resolves the definitions absolute contentReferences name. */
export type StructureDefinitionLoad = (
  url: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
) => Promise<StructureDefinition | null>;

/** Coordinates terminology validation rules and their runtime caches. */
export class TerminologyValidationPipeline {
  private readonly elementPlanCache = new TerminologyElementPlanCache();
  private readonly slicePlanCache = new TerminologySlicePlanCache();
  private readonly codeSystemReferenceLookupCache = new CodeSystemReferenceLookupCache();
  private readonly ucumValidator = new UcumCodeValidator();

  constructor(
    private readonly valueSetValidator: TerminologyValidationPort,
    private readonly valueSetCache: ValueSetCache,
    private readonly loadStructureDefinition?: StructureDefinitionLoad,
  ) {}

  clearCache(): void {
    this.codeSystemReferenceLookupCache.clear();
    this.ucumValidator.clear();
  }

  async validate(context: TerminologyValidationContext): Promise<ValidationIssue[]> {
    const run = () => this.validateScoped(context);
    return this.valueSetValidator.withSourceContext?.(context.sourceContext, run) ?? run();
  }

  private async validateScoped(context: TerminologyValidationContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const valueSetValidator = createTerminologyEvidencePort(this.valueSetValidator);
    const failureMessages = new Set<string>();
    const { resource, structureDef, getValueAtPath, sourceContext } = context;
    this.valueSetValidator.setSourceContext?.(sourceContext);
    const profileUrl = typeof structureDef.url === 'string' ? structureDef.url : undefined;
    const fhirVersion = context.fhirVersion ?? 'R4';

    const load = this.loadStructureDefinition;
    const contentReferenceSources = load
      ? await loadContentReferenceSources(structureDef, url => load(url, fhirVersion))
      : undefined;
    const elementPlan = this.elementPlanCache.get(structureDef, instanceElementPaths(resource), contentReferenceSources);
    for (const elementDef of elementPlan) {
      try {
        issues.push(
          ...(await validateTerminologyElement(
            {
              resource,
              elementDef,
              structureDef,
              getValueAtPath,
              profileUrl,
              fhirVersion,
              sourceContext,
            },
            {
              valueSetCache: this.valueSetCache,
              valueSetValidator,
              slicePlanCache: this.slicePlanCache,
              codeSystemReferenceLookupCache: this.codeSystemReferenceLookupCache,
              ucumValidator: this.ucumValidator,
            },
          )),
        );
      } catch (error) {
        appendTerminologyFailure(
          issues,
          failureMessages,
          error,
          resource,
          structureDef,
          profileUrl,
          elementDef.path,
        );
      }
    }

    const globalRules = createTerminologyGlobalRules({
      resource,
      existingIssues: issues,
      ucumValidator: this.ucumValidator,
      valueSetValidator,
      fhirVersion,
      sourceContext,
    });
    for (const rule of globalRules) {
      try {
        issues.push(...(await rule()));
      } catch (error) {
        appendTerminologyFailure(
          issues,
          failureMessages,
          error,
          resource,
          structureDef,
          profileUrl,
        );
      }
    }
    return issues;
  }
}
