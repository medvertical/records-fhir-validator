import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import { buildQuestionnaireAnswerMap } from './questionnaire-enable-when.js';
import { validateQuestionnaireItems } from './questionnaire-item-validator.js';
import { validateQuestionnaireSdcConstraints } from './questionnaire-sdc-validator.js';
import { ValueSetCache } from './valueset-cache.js';
import type {
    QuestionnaireResponseAnswer,
} from './questionnaire-types.js';
import {
    buildQuestionnaireItemMap,
    validateQuestionnaireResponseItems,
    validateQuestionnaireResponseItemsBasic,
    validateRequiredQuestionnaireItems,
} from './questionnaire-response-structure-validator.js';

export type {
    AnswerOption,
    EnableWhen,
    QuestionnaireItem,
    QuestionnaireResponseAnswer,
    QuestionnaireResponseItem,
} from './questionnaire-types.js';

export interface QuestionnaireValidationOptions {
    warnOnUnresolvedQuestionnaireReference?: boolean;
}

export class QuestionnaireValidator {
    constructor(private readonly cache: ValueSetCache = new ValueSetCache()) {}

    validateAnyResource(
        resource: unknown,
        contextQuestionnaire?: unknown,
        options: QuestionnaireValidationOptions = {},
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    ): ValidationIssue[] {
        const resourceRecord = asRecord(resource);
        if (!resourceRecord) return [];
        const issues: ValidationIssue[] = [];

        const rt = resourceRecord.resourceType;
        if (rt === 'Questionnaire') {
            issues.push(...this.validateQuestionnaire(resourceRecord, 'Questionnaire', fhirVersion));
        } else if (rt === 'QuestionnaireResponse') {
            let q = isQuestionnaire(contextQuestionnaire) ? contextQuestionnaire : undefined;
            if (!q && typeof resourceRecord.questionnaire === 'string' && resourceRecord.questionnaire.startsWith('#')) {
                const id = resourceRecord.questionnaire.slice(1);
                const contained = Array.isArray(resourceRecord.contained) ? resourceRecord.contained : [];
                q = contained.find(candidate =>
                    isQuestionnaire(candidate) && candidate.id === id
                );
            }
            issues.push(...this.validateQuestionnaireResponse(resourceRecord, q, options));
        }

        if (Array.isArray(resourceRecord.contained)) {
            for (let i = 0; i < resourceRecord.contained.length; i++) {
                const c = resourceRecord.contained[i];
                const cPath = `${rt}.contained[${i}]`;
                if (isQuestionnaire(c)) {
                    issues.push(...this.validateQuestionnaire(c, cPath, fhirVersion));
                }
            }
        }

        return issues;
    }

    validateQuestionnaire(
        questionnaire: unknown,
        basePath: string = 'Questionnaire',
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        const questionnaireRecord = asRecord(questionnaire);
        if (questionnaireRecord?.resourceType !== 'Questionnaire') {
            return issues;
        }

        logger.debug('[QuestionnaireValidator] Validating Questionnaire');

        if (!questionnaireRecord.status) {
            issues.push(createValidationIssue({
                code: 'questionnaire-missing-status',
                path: `${basePath}.status`,
                resourceType: 'Questionnaire',
                customMessage: 'Questionnaire.status is required',
                severityOverride: 'error',
            }));
        }

        if (questionnaireRecord.name !== undefined && questionnaireRecord.name !== null) {
            const name = String(questionnaireRecord.name);
            if (!/^[A-Z]([A-Za-z0-9_]){0,254}$/.test(name)) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-0',
                    path: basePath,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-0: 'Name should be usable as an " +
                        "identifier for the module by machine processing " +
                        "applications such as code generation'",
                    severityOverride: 'warning',
                }));
            }
        }

        if (Array.isArray(questionnaireRecord.item)) {
            const linkIdSet = new Set<string>();
            issues.push(...validateQuestionnaireItems(
                questionnaireRecord.item,
                linkIdSet,
                `${basePath}.item`,
                fhirVersion,
            ));
        }

        return issues;
    }

    validateQuestionnaireResponse(
        response: unknown,
        questionnaire?: unknown,
        options: QuestionnaireValidationOptions = {},
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        const responseRecord = asRecord(response);
        if (responseRecord?.resourceType !== 'QuestionnaireResponse') {
            return issues;
        }

        logger.debug('[QuestionnaireValidator] Validating QuestionnaireResponse');

        if (!responseRecord.status) {
            issues.push(createValidationIssue({
                code: 'qr-missing-status',
                path: 'QuestionnaireResponse.status',
                resourceType: 'QuestionnaireResponse',
                customMessage: 'QuestionnaireResponse.status is required',
                severityOverride: 'error',
            }));
        }

        if (!questionnaire) {
            if (options.warnOnUnresolvedQuestionnaireReference && typeof responseRecord.questionnaire === 'string' && responseRecord.questionnaire.trim()) {
                const canonical = responseRecord.questionnaire.split('|')[0];
                const wrongType = this.cache.getValueSetFile(canonical) ??
                    this.cache.getCodeSystemFile(canonical);
                const explicitCanonicalType = canonical.match(
                    /\/(ValueSet|CodeSystem|StructureDefinition|ConceptMap|Library|PlanDefinition|ActivityDefinition)\//,
                )?.[1];
                const wrongResourceType = wrongType?.resourceType ?? explicitCanonicalType;
                if (wrongResourceType) {
                    issues.push(createValidationIssue({
                        code: 'questionnaire-reference-wrong-type',
                        path: 'QuestionnaireResponse.questionnaire',
                        resourceType: 'QuestionnaireResponse',
                        customMessage:
                            `Canonical URL '${responseRecord.questionnaire}' refers to a resource that has the wrong type. ` +
                            `Found ${wrongResourceType} expecting Questionnaire`,
                        severityOverride: 'error',
                    }));
                }
                issues.push(createValidationIssue({
                    code: 'questionnaire-reference-not-resolved',
                    path: 'QuestionnaireResponse.questionnaire',
                    resourceType: 'QuestionnaireResponse',
                    customMessage: `Questionnaire '${responseRecord.questionnaire}' could not be resolved; QuestionnaireResponse items were not validated against the questionnaire definition.`,
                    severityOverride: 'warning',
                    details: {
                        questionnaire: responseRecord.questionnaire,
                    },
                }));
            }

            if (Array.isArray(responseRecord.item)) {
                issues.push(...validateQuestionnaireResponseItemsBasic(
                    responseRecord.item,
                    'QuestionnaireResponse.item',
                ));
            }
            return issues;
        }

        const questionnaireRecord = asRecord(questionnaire);
        if (!questionnaireRecord) return issues;
        const questionnaireItems = Array.isArray(questionnaireRecord.item)
            ? questionnaireRecord.item
            : [];
        const responseItems = Array.isArray(responseRecord.item)
            ? responseRecord.item
            : [];
        const questionMap = buildQuestionnaireItemMap(questionnaireItems);

        const answerMap = new Map<string, QuestionnaireResponseAnswer[]>();
        buildQuestionnaireAnswerMap(responseItems, answerMap);

        if (responseItems.length > 0) {
            issues.push(...validateQuestionnaireResponseItems(
                responseItems,
                questionMap,
                'QuestionnaireResponse.item',
                this.cache,
            ));
        }

        issues.push(...validateRequiredQuestionnaireItems(responseItems, questionMap, answerMap));

        if (responseItems.length > 0) {
            issues.push(...validateQuestionnaireSdcConstraints(
                responseItems,
                questionMap,
                'QuestionnaireResponse.item'
            ));
        }

        return issues;
    }

}

function isQuestionnaire(value: unknown): value is Record<string, unknown> {
    const record = asRecord(value);
    return record?.resourceType === 'Questionnaire';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}
