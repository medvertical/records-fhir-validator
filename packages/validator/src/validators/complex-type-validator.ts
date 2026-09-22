import type { ValidationIssue } from '@records-fhir/validation-types';
import type { TypeValidator } from './type-validator.js';
import { ValueSetValidator, type TerminologyResolutionConfig } from './valueset-validator.js';
import type { StructureDefinition, ElementDefinition } from '../core/structure-definition-types.js';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader.js';
import { logger } from '../logger.js';
import {
    isPrimitiveType,
} from '../core/executors/structural-executor-helpers.js';
import { checkExtensionExt1, checkPeriodPer1 } from './complex-type-invariants.js';
import { checkRangeBounds, isRangeBoundType } from './range-bound-invariants.js';
import {
    narrowChoiceTypeForConcreteSegment,
    rewriteChoiceTypeBasePath,
    shouldSkipComplexDeepValidation,
} from './complex-type-path-rules.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { ComplexTypeDefinitionResolver } from './complex-type-definition-resolver.js';
import { validateComplexTypeSubElement } from './complex-type-sub-element-validation.js';
import { DatatypeInvariantEvaluator } from './datatype-invariant-evaluator.js';

export class ComplexTypeValidator {
    private valueSetValidator: ValueSetValidator;
    private readonly definitionResolver: ComplexTypeDefinitionResolver;
    private readonly datatypeInvariantEvaluator = new DatatypeInvariantEvaluator();

    constructor(
        sdLoader: StructureDefinitionLoader,
        private typeValidator?: TypeValidator,
        valueSetValidator: ValueSetValidator = new ValueSetValidator(),
    ) {
        this.valueSetValidator = valueSetValidator;
        this.definitionResolver = new ComplexTypeDefinitionResolver(sdLoader);
    }

    configureTerminologyResolution(config: Partial<TerminologyResolutionConfig>): void {
        this.valueSetValidator.setResolutionConfig(config);
    }

    async validateComplexTypeSubElements(
        value: unknown,
        elementDef: ElementDefinition,
        basePath: string,
        profileUrl: string,
        parentStructureDef?: StructureDefinition,
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        try {
            if (!elementDef.type || elementDef.type.length === 0) return issues;

            logger.debug('[ComplexTypeValidator] Resolving complex type', {
                pathDepth: basePath.split('.').length,
                candidateCount: elementDef.type.length,
            });
            // A concrete choice property (`valueQuantity`) already names its type;
            // key-shape matching across all value[x] candidates may otherwise pick
            // a wrong lookalike (e.g. `{value: 2}` matching `uuid.value`).
            const effectiveTypes = narrowChoiceTypeForConcreteSegment(
                elementDef,
                elementDef.path?.split('.').pop() ?? '',
                (basePath.split('.').pop() ?? '').replace(/\[\d+\]$/, ''),
            ).type ?? elementDef.type;
            const primaryType = await this.definitionResolver.resolveMatchingType(value, effectiveTypes, fhirVersion);
            if (!primaryType) return issues;
            if (isPrimitiveType(primaryType.code)) return issues;
            if (typeof value !== 'object' || value === null) return issues;
            if (shouldSkipComplexDeepValidation(basePath)) return issues;

            basePath = rewriteChoiceTypeBasePath(basePath, primaryType.code);

            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) {
                    const el = value[i];
                    if (el && typeof el === 'object' && !Array.isArray(el)) {
                        issues.push(...await this.validateComplexTypeSubElements(
                            el, elementDef, `${basePath}[${i}]`, profileUrl, parentStructureDef, fhirVersion
                        ));
                    }
                }
                return issues;
            }

            if (primaryType.code === 'Extension') {
                const ext1Issue = checkExtensionExt1(value, basePath);
                if (ext1Issue) issues.push(ext1Issue);
            }

            if (primaryType.code === 'Period') {
                const per1Issue = checkPeriodPer1(value, basePath);
                if (per1Issue) issues.push(per1Issue);
            }

            if (isRangeBoundType(primaryType.code)) {
                const boundsIssue = checkRangeBounds(value, basePath, primaryType.code, fhirVersion);
                if (boundsIssue) issues.push(boundsIssue);
            }

            const typeDefinition = await this.definitionResolver.loadTypeDefinition(
                primaryType.code, fhirVersion,
            );
            if (typeDefinition) {
                issues.push(...this.datatypeInvariantEvaluator.evaluate({
                    value: value as Record<string, unknown>,
                    structureDef: typeDefinition,
                    basePath,
                    profileUrl,
                    fhirVersion,
                }));
            }

            const effectiveElements = await this.definitionResolver.buildEffectiveElements(
                primaryType.code, basePath, parentStructureDef, fhirVersion
            );
            if (!effectiveElements) return issues;

            for (const [elementPath, subElementDef] of effectiveElements.entries()) {
                if (subElementDef.path === primaryType.code) continue;
                const subIssues = await validateComplexTypeSubElement({
                    value,
                    elementPath,
                    subElementDef,
                    typeCode: primaryType.code,
                    basePath,
                    profileUrl,
                    parentStructureDef,
                    fhirVersion,
                }, {
                    typeValidator: this.typeValidator,
                    valueSetValidator: this.valueSetValidator,
                    validateNested: (...args) => this.validateComplexTypeSubElements(...args),
                });
                issues.push(...subIssues);
            }
        } catch (error) {
            logger.debug(
                `[ComplexTypeValidator] Error validating complex type sub-elements for ${basePath}`,
                validationFailureMetadata(error),
            );
        }

        return issues;
    }

}
