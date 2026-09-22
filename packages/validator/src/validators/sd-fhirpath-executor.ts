import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { SDConstraintCollector } from './sd-constraint-collector.js';
import { SDElementMatcher } from './sd-element-matcher.js';
import {
    createFHIRPathContext,
    type FHIRPathBundleInput,
} from './fhirpath-functions.js';
import { logger } from '../logger.js';
import type { SDFHIRPathExpressionCache } from './sd-fhirpath-expression-cache.js';
import {
    createSDFHIRPathInvocationTable,
} from './sd-fhirpath-runtime.js';
import type { FHIRPathTerminologyResolver } from './fhirpath-async-terminology.js';
import { ValueSetCache } from './valueset-cache.js';
import { SDFHIRPathConstraintRunner } from './sd-fhirpath-constraint-runner.js';
import type { SDFHIRPathEvaluationScope } from './sd-fhirpath-evaluation-scope.js';

export { evaluateSpecialisedRootConstraint } from './sd-fhirpath-specialised-root-constraints.js';

export interface SDFHIRPathContext {
    resource: unknown;
    resourceType: string;
    structureDef: StructureDefinition;
    /**
     * FHIRPath `%resource` / `%rootResource` context. This differs from
     * `resource` when a non-resource datatype is validated recursively, for
     * example an Extension profile attached to Patient.gender.
     */
    rootResource?: unknown;
    bundle?: FHIRPathBundleInput;
    bundleResources?: Map<string, unknown>; // Map of fullUrl/id to resource
    fhirVersion?: 'R4' | 'R5' | 'R6';
    terminologyResolver?: FHIRPathTerminologyResolver;
}

export class SDFHIRPathExecutor {
    private readonly valueSetCache: ValueSetCache;
    private readonly constraintRunner: SDFHIRPathConstraintRunner;
    private readonly elementMatcher: SDElementMatcher;

    constructor(
        cache: ValueSetCache = new ValueSetCache(),
        expressionCache?: SDFHIRPathExpressionCache,
        constraintCollector?: SDConstraintCollector,
        elementMatcher: SDElementMatcher = new SDElementMatcher(),
    ) {
        this.valueSetCache = cache;
        this.constraintRunner = new SDFHIRPathConstraintRunner(
            cache,
            expressionCache,
            constraintCollector,
        );
        this.elementMatcher = elementMatcher;
    }

    /**
     * Execute ALL FHIRPath constraints from StructureDefinition
     */
    async execute(context: SDFHIRPathContext): Promise<ValidationIssue[]> {
        const {
            resource,
            resourceType,
            structureDef,
            bundle,
            bundleResources,
            fhirVersion = 'R4',
            terminologyResolver,
        } = context;
        if (!structureDef || !resource) return [];

        const rootResource = context.rootResource ?? resource;
        const profileUrl = structureDef.url;
        // Create FHIRPath context and build userInvocationTable once per execute() call
        const fhirPathContext = createFHIRPathContext(
            rootResource,
            bundleResources ?? bundle,
            this.valueSetCache,
        );
        const userInvocationTable = createSDFHIRPathInvocationTable(fhirPathContext);
        const evaluationScope: SDFHIRPathEvaluationScope = {
            bundle: bundleResources ?? bundle,
            fhirVersion,
            profileUrl,
            resource,
            resourceType,
            rootResource,
            terminologyResolver,
            userInvocationTable,
        };

        const matchResult = this.elementMatcher.match(resource, structureDef);

        logger.debug(`[SDFHIRPathExecutor] Matched ${matchResult.matches.length} elements, ${matchResult.constraintElements.length} with constraints`);

        const issues = await this.constraintRunner.evaluate(
            matchResult,
            structureDef,
            resource,
            resourceType,
            evaluationScope,
        );

        logger.debug(`[SDFHIRPathExecutor] Found ${issues.length} violations`);

        return issues;
    }

    getExpressionCacheStats(): ReturnType<SDFHIRPathExpressionCache['getStats']> {
        return this.constraintRunner.getExpressionCacheStats();
    }

    clearExpressionCache(): void {
        this.constraintRunner.clearExpressionCache();
    }
}
