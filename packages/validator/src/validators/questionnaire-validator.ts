/**
 * Questionnaire Validator
 *
 * Validates Questionnaire and QuestionnaireResponse resources:
 * - LinkId uniqueness within Questionnaire
 * - FHIR R4 que-* invariants (que-0 … que-12)
 * - Required answers in QuestionnaireResponse
 * - Answer type validation against Questionnaire definition
 * - EnableWhen logic evaluation
 * - Option validation for choice questions
 *
 * Supports SDC (Structured Data Capture) extensions.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';
import { validateQuestionnaireAnswerTypes } from './questionnaire-answer-validator';
import {
    buildQuestionnaireAnswerMap,
    isQuestionnaireItemEnabled,
} from './questionnaire-enable-when';
import { validateQuestionnaireItems } from './questionnaire-item-validator';
import { validateQuestionnaireSdcConstraints } from './questionnaire-sdc-validator';
import type {
    QuestionnaireItem,
    QuestionnaireResponseAnswer,
    QuestionnaireResponseItem,
} from './questionnaire-types';

export type {
    AnswerOption,
    EnableWhen,
    QuestionnaireItem,
    QuestionnaireResponseAnswer,
    QuestionnaireResponseItem,
} from './questionnaire-types';

// ============================================================================
// Questionnaire Validator
// ============================================================================

export class QuestionnaireValidator {

    /**
     * Entry point used by the validation engine. Handles either a
     * Questionnaire or a QuestionnaireResponse, and also walks any contained
     * Questionnaire/QuestionnaireResponse resources so the Java validator's
     * path emission style (`Resource.contained[0]/<slash>Q/id<slash>.item...`)
     * can be matched.
     *
     * When `contextQuestionnaire` is supplied on a QuestionnaireResponse, the
     * validator also evaluates SDC extensions (minValue/maxValue/…) against
     * the response's answers.
     */
    validateAnyResource(resource: any, contextQuestionnaire?: any): ValidationIssue[] {
        if (!resource || typeof resource !== 'object') return [];
        const issues: ValidationIssue[] = [];

        const rt = resource.resourceType;
        if (rt === 'Questionnaire') {
            issues.push(...this.validateQuestionnaire(resource, 'Questionnaire'));
        } else if (rt === 'QuestionnaireResponse') {
            // Prefer a caller-supplied questionnaire; otherwise fall back
            // to a contained reference (`#id`) picked up from the QR.
            let q = contextQuestionnaire;
            if (!q && typeof resource.questionnaire === 'string' && resource.questionnaire.startsWith('#')) {
                const id = resource.questionnaire.slice(1);
                const contained = Array.isArray(resource.contained) ? resource.contained : [];
                q = contained.find((c: any) => c?.id === id && c?.resourceType === 'Questionnaire');
            }
            issues.push(...this.validateQuestionnaireResponse(resource, q));
        }

        // Walk contained resources (max one level — contained resources
        // cannot themselves have `contained`, per FHIR R4 rules)
        if (Array.isArray(resource.contained)) {
            for (let i = 0; i < resource.contained.length; i++) {
                const c = resource.contained[i];
                const cPath = `${rt}.contained[${i}]`;
                if (c?.resourceType === 'Questionnaire') {
                    issues.push(...this.validateQuestionnaire(c, cPath));
                }
            }
        }

        return issues;
    }

    /**
     * Validate a Questionnaire resource, including the FHIR R4 `que-*`
     * invariants published at https://www.hl7.org/fhir/R4/questionnaire.html#invs.
     *
     * The invariants are spec-defined as FHIRPath constraints on the
     * StructureDefinition. Records evaluates them directly so the checks
     * run even when the base Questionnaire SD is unavailable.
     */
    validateQuestionnaire(questionnaire: any, basePath: string = 'Questionnaire'): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (questionnaire?.resourceType !== 'Questionnaire') {
            return issues;
        }

        logger.debug('[QuestionnaireValidator] Validating Questionnaire');

        // Check required fields
        if (!questionnaire.status) {
            issues.push(createValidationIssue({
                code: 'questionnaire-missing-status',
                path: `${basePath}.status`,
                resourceType: 'Questionnaire',
                customMessage: 'Questionnaire.status is required',
                severityOverride: 'error',
            }));
        }

        // que-0: Name should be usable as an identifier — must match [A-Z]([A-Za-z0-9_]){0,254}
        if (questionnaire.name !== undefined && questionnaire.name !== null) {
            const name = String(questionnaire.name);
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

        // Validate items (recursive, applies que-1 / que-3..que-12)
        if (questionnaire.item && Array.isArray(questionnaire.item)) {
            const linkIdSet = new Set<string>();
            issues.push(...validateQuestionnaireItems(questionnaire.item, linkIdSet, `${basePath}.item`));
        }

        return issues;
    }

    /**
     * Validate a QuestionnaireResponse against its Questionnaire
     */
    validateQuestionnaireResponse(
        response: any,
        questionnaire?: any
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (response?.resourceType !== 'QuestionnaireResponse') {
            return issues;
        }

        logger.debug('[QuestionnaireValidator] Validating QuestionnaireResponse');

        // Check required fields
        if (!response.status) {
            issues.push(createValidationIssue({
                code: 'qr-missing-status',
                path: 'QuestionnaireResponse.status',
                resourceType: 'QuestionnaireResponse',
                customMessage: 'QuestionnaireResponse.status is required',
                severityOverride: 'error',
            }));
        }

        // If no questionnaire provided, only do basic validation
        if (!questionnaire) {
            if (response.item && Array.isArray(response.item)) {
                issues.push(...this.validateResponseItemsBasic(response.item, 'QuestionnaireResponse.item'));
            }
            return issues;
        }

        // Build question map from Questionnaire
        const questionMap = new Map<string, QuestionnaireItem>();
        this.buildQuestionMap(questionnaire.item || [], questionMap);

        // Build answer map from QuestionnaireResponse
        const answerMap = new Map<string, QuestionnaireResponseAnswer[]>();
        buildQuestionnaireAnswerMap(response.item || [], answerMap);

        // Validate response items against questionnaire
        if (response.item && Array.isArray(response.item)) {
            issues.push(...this.validateResponseItems(
                response.item,
                questionMap,
                'QuestionnaireResponse.item'
            ));
        }

        // Check for required questions without answers (considering enableWhen)
        issues.push(...this.checkRequiredQuestions(response.item || [], questionMap, answerMap));

        // Evaluate SDC extensions on each answer (minValue, maxValue, …)
        // The question map already holds every linkId-keyed item, so we
        // can walk the response items in parallel and read each question's
        // extension array.
        if (response.item && Array.isArray(response.item)) {
            issues.push(...validateQuestionnaireSdcConstraints(
                response.item,
                questionMap,
                'QuestionnaireResponse.item'
            ));
        }

        return issues;
    }

    /**
     * Basic validation without questionnaire definition
     */
    private validateResponseItemsBasic(
        items: QuestionnaireResponseItem[],
        basePath: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const path = `${basePath}[${i}]`;

            if (!item.linkId) {
                issues.push(createValidationIssue({
                    code: 'qr-missing-linkid',
                    path: `${path}.linkId`,
                    resourceType: 'QuestionnaireResponse',
                    customMessage: 'Response item must have a linkId',
                    severityOverride: 'error',
                }));
            }

            if (item.item) {
                issues.push(...this.validateResponseItemsBasic(item.item, `${path}.item`));
            }
        }

        return issues;
    }

    /**
     * Build map of linkId -> QuestionnaireItem
     */
    private buildQuestionMap(
        items: QuestionnaireItem[],
        map: Map<string, QuestionnaireItem>
    ): void {
        for (const item of items) {
            if (item.linkId) {
                map.set(item.linkId, item);
            }
            if (item.item) {
                this.buildQuestionMap(item.item, map);
            }
        }
    }

    /**
     * Validate response items against questionnaire definition
     */
    private validateResponseItems(
        items: QuestionnaireResponseItem[],
        questionMap: Map<string, QuestionnaireItem>,
        basePath: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const path = `${basePath}[${i}]`;

            if (!item.linkId) continue;

            const question = questionMap.get(item.linkId);
            if (!question) {
                issues.push(createValidationIssue({
                    code: 'not-found',
                    path: `${path}.linkId`,
                    resourceType: 'QuestionnaireResponse',
                    customMessage: `LinkId '${item.linkId}' not found in questionnaire`,
                    severityOverride: 'error',
                }));
                continue;
            }

            // Items of type 'display' cannot have answers
            if (question.type === 'display' && item.answer && item.answer.length > 0) {
                issues.push(createValidationIssue({
                    code: 'structure',
                    path,
                    resourceType: 'QuestionnaireResponse',
                    customMessage: `Items of type 'display' cannot have answers`,
                    severityOverride: 'error',
                }));
                continue;
            }

            // Items of type 'group' cannot have answers (only sub-items)
            if (question.type === 'group' && item.answer && item.answer.length > 0) {
                issues.push(createValidationIssue({
                    code: 'structure',
                    path,
                    resourceType: 'QuestionnaireResponse',
                    customMessage: `Items of type 'group' cannot have answers, only sub-items`,
                    severityOverride: 'error',
                }));
            }

            // Required items must have answers (unless display/group)
            if (question.required && question.type !== 'display') {
                if (question.type === 'group') {
                    // Required groups must have at least one sub-item with content
                    const hasSubItems = item.item && item.item.length > 0;
                    if (!hasSubItems) {
                        issues.push(createValidationIssue({
                            code: 'qr-required-group',
                            path,
                            resourceType: 'QuestionnaireResponse',
                            customMessage: `No sub-items found for required group`,
                            severityOverride: 'error',
                        }));
                    }
                } else if (!item.answer || item.answer.length === 0) {
                    issues.push(createValidationIssue({
                        code: 'required',
                        path,
                        resourceType: 'QuestionnaireResponse',
                        customMessage: `No response answer found for required item '${item.linkId}'`,
                        severityOverride: 'error',
                    }));
                }
            }

            // Non-repeating items must not have multiple answers
            if (!question.repeats && item.answer && item.answer.length > 1) {
                issues.push(createValidationIssue({
                    code: 'qr-repeats-violation',
                    path,
                    resourceType: 'QuestionnaireResponse',
                    customMessage: `Only one response answer item with this linkId allowed`,
                    severityOverride: 'error',
                }));
            }

            // Validate answer types and answer options
            if (item.answer) {
                issues.push(...validateQuestionnaireAnswerTypes(item.answer, question, `${path}.answer`));
            }

            // Validate nested items
            if (item.item) {
                issues.push(...this.validateResponseItems(item.item, questionMap, `${path}.item`));
            }
        }

        return issues;
    }

    /**
     * Check that required questions have answers (considering enableWhen).
     *
     * Only flags items that do NOT appear in the response at all —
     * items that appear but lack answers are already caught by
     * `validateResponseItems` above.
     */
    private checkRequiredQuestions(
        responseItems: QuestionnaireResponseItem[],
        questionMap: Map<string, QuestionnaireItem>,
        answerMap: Map<string, QuestionnaireResponseAnswer[]>
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const presentLinkIds = new Set<string>();

        // Collect all linkIds present in the response (whether answered or not)
        const collectPresent = (items: QuestionnaireResponseItem[]) => {
            for (const item of items) {
                if (item.linkId) {
                    presentLinkIds.add(item.linkId);
                }
                if (item.item) collectPresent(item.item);
            }
        };
        collectPresent(responseItems);

        // Check required questions that are ABSENT from the response
        for (const [linkId, question] of questionMap) {
            if (!question.required) continue;
            if (presentLinkIds.has(linkId)) continue; // handled by validateResponseItems
            if (question.type === 'display') continue;

            // Skip if question is disabled by enableWhen
            if (!isQuestionnaireItemEnabled(question, answerMap)) continue;

            if (question.type === 'group') {
                // Required groups that are absent → "No sub-items found"
                issues.push(createValidationIssue({
                    code: 'qr-required-group',
                    path: `QuestionnaireResponse.item(linkId=${linkId})`,
                    resourceType: 'QuestionnaireResponse',
                    customMessage: `No sub-items found for required group`,
                    severityOverride: 'error',
                }));
            } else {
                issues.push(createValidationIssue({
                    code: 'required',
                    path: `QuestionnaireResponse.item(linkId=${linkId})`,
                    resourceType: 'QuestionnaireResponse',
                    customMessage: `No response answer found for required item '${linkId}'`,
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }
}

// Singleton
export const questionnaireValidator = new QuestionnaireValidator();
