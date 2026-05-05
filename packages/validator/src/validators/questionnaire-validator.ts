/* eslint-disable max-lines */
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
import { valueSetCache } from './valueset-cache';
import type { CodeSystem, CodeSystemConcept } from './valueset-types';

// ============================================================================
// Types
// ============================================================================

export interface QuestionnaireItem {
    linkId: string;
    text?: string;
    type: 'group' | 'display' | 'boolean' | 'decimal' | 'integer' | 'date' | 'dateTime' |
    'time' | 'string' | 'text' | 'url' | 'choice' | 'open-choice' | 'attachment' |
    'reference' | 'quantity';
    required?: boolean;
    repeats?: boolean;
    readOnly?: boolean;
    maxLength?: number;
    answerOption?: AnswerOption[];
    answerValueSet?: string;
    enableWhen?: EnableWhen[];
    enableBehavior?: 'all' | 'any';
    item?: QuestionnaireItem[];
}

export interface AnswerOption {
    valueInteger?: number;
    valueDate?: string;
    valueTime?: string;
    valueString?: string;
    valueCoding?: { system?: string; code: string; display?: string };
    valueReference?: { reference: string };
    extension?: Array<{ url: string; valueBoolean?: boolean }>;
}

export interface EnableWhen {
    question: string;
    operator: 'exists' | '=' | '!=' | '>' | '<' | '>=' | '<=';
    answerBoolean?: boolean;
    answerDecimal?: number;
    answerInteger?: number;
    answerDate?: string;
    answerDateTime?: string;
    answerTime?: string;
    answerString?: string;
    answerCoding?: { system?: string; code: string };
    answerQuantity?: { value: number; unit?: string };
    answerReference?: { reference: string };
}

export interface QuestionnaireResponseItem {
    linkId: string;
    text?: string;
    answer?: QuestionnaireResponseAnswer[];
    item?: QuestionnaireResponseItem[];
}

export interface QuestionnaireResponseAnswer {
    valueBoolean?: boolean;
    valueDecimal?: number;
    valueInteger?: number;
    valueDate?: string;
    valueDateTime?: string;
    valueTime?: string;
    valueString?: string;
    valueUri?: string;
    valueAttachment?: any;
    valueCoding?: { system?: string; code: string; display?: string };
    valueQuantity?: { value: number; unit?: string };
    valueReference?: { reference: string };
    item?: QuestionnaireResponseItem[];
}

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
            issues.push(...this.validateItems(questionnaire.item, linkIdSet, `${basePath}.item`));
        }

        return issues;
    }

    /**
     * Validate Questionnaire items recursively.
     *
     * Covers (in addition to linkId uniqueness / required fields):
     *   que-1   group implies nested items; display implies no nested items
     *   que-2   linkId uniqueness across the questionnaire
     *   que-3   display items cannot have a `code`
     *   que-4   cannot have both answerOption and answerValueSet
     *   que-5   answerValueSet only on choice / open-choice
     *   que-6   required / repeats not allowed on display
     *   que-7   enableWhen.operator = 'exists' implies answerBoolean value
     *   que-8   no initial on group / display
     *   que-9   no readOnly on display
     *   que-10  maxLength only on simple typed items
     *   que-11  answerOption and initial cannot coexist
     *   que-12  >1 enableWhen implies enableBehavior present
     */
    // eslint-disable-next-line max-lines-per-function
    private validateItems(
        items: any[],
        linkIdSet: Set<string>,
        basePath: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const path = `${basePath}[${i}]`;
            const type: string | undefined = item?.type;

            // linkId required + que-2 (uniqueness)
            if (!item.linkId) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-missing-linkid',
                    path: `${path}.linkId`,
                    resourceType: 'Questionnaire',
                    customMessage: 'Item must have a linkId',
                    severityOverride: 'error',
                }));
            } else {
                if (linkIdSet.has(item.linkId)) {
                    issues.push(createValidationIssue({
                        code: 'questionnaire-invariant-que-2',
                        path: `${path}.linkId`,
                        resourceType: 'Questionnaire',
                        customMessage:
                            "Constraint failed: que-2: 'The link ids for groups " +
                            "and questions must be unique within the questionnaire'",
                        severityOverride: 'error',
                    }));
                }
                linkIdSet.add(item.linkId);
            }

            // type required
            if (!type) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-missing-type',
                    path: `${path}.type`,
                    resourceType: 'Questionnaire',
                    customMessage: 'Item must have a type',
                    severityOverride: 'error',
                }));
            }

            const nestedItems: any[] | undefined = Array.isArray(item?.item) ? item.item : undefined;

            // que-1: group must have nested items; display must not
            if (type === 'group' && (!nestedItems || nestedItems.length === 0)) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-1',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-1: 'Group items must have nested " +
                        "items, display items cannot have nested items'",
                    severityOverride: 'error',
                }));
            }
            if (type === 'display' && nestedItems && nestedItems.length > 0) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-1',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-1: 'Group items must have nested " +
                        "items, display items cannot have nested items'",
                    severityOverride: 'error',
                }));
            }

            // que-3: display items cannot have `code`
            if (type === 'display' && Array.isArray(item?.code) && item.code.length > 0) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-3',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-3: 'Display items cannot have a \"code\" asserted'",
                    severityOverride: 'error',
                }));
            }

            // que-4: not both answerOption and answerValueSet
            const hasAnswerOption = Array.isArray(item?.answerOption) && item.answerOption.length > 0;
            const hasAnswerValueSet = !!item?.answerValueSet;
            if (hasAnswerOption && hasAnswerValueSet) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-4',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-4: 'A question cannot have both " +
                        "answerOption and answerValueSet'",
                    severityOverride: 'error',
                }));
            }

            // que-5: answerValueSet only on choice / open-choice
            if (hasAnswerValueSet && type !== 'choice' && type !== 'open-choice') {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-5',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-5: 'Only \u0027choice\u0027 and " +
                        "\u0027open-choice\u0027 items can have answerValueSet'",
                    severityOverride: 'error',
                }));
            }
            // que-5 also forbids answerOption outside choice/open-choice
            if (hasAnswerOption && type !== 'choice' && type !== 'open-choice') {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-5',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-5: 'Only \u0027choice\u0027 and " +
                        "\u0027open-choice\u0027 items can have answerOption'",
                    severityOverride: 'error',
                }));
            }

            // que-6: required / repeats not allowed on display
            if (type === 'display' && (item?.required !== undefined || item?.repeats !== undefined)) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-6',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-6: 'Required and repeats aren\u0027t " +
                        "permitted for display items'",
                    severityOverride: 'error',
                }));
            }

            // que-7: enableWhen exists operator → answerBoolean value
            if (Array.isArray(item?.enableWhen)) {
                for (let ewi = 0; ewi < item.enableWhen.length; ewi++) {
                    const ew = item.enableWhen[ewi];
                    if (ew?.operator === 'exists' && typeof ew?.answerBoolean !== 'boolean') {
                        issues.push(createValidationIssue({
                            code: 'questionnaire-invariant-que-7',
                            path: `${path}.enableWhen[${ewi}]`,
                            resourceType: 'Questionnaire',
                            customMessage:
                                "Constraint failed: que-7: 'If the operator is " +
                                "\u0027exists\u0027, the value must be a boolean'",
                            severityOverride: 'error',
                        }));
                    }
                }
            }

            // que-8: no initial on group / display
            const hasInitial = Array.isArray(item?.initial) && item.initial.length > 0;
            if ((type === 'group' || type === 'display') && hasInitial) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-8',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-8: 'Initial values can\u0027t be " +
                        "specified for groups or display items'",
                    severityOverride: 'error',
                }));
            }

            // que-9: no readOnly on display
            if (type === 'display' && item?.readOnly !== undefined) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-9',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-9: 'Read Only can\u0027t be specified " +
                        "for \"display\" items'",
                    severityOverride: 'error',
                }));
            }

            // que-10: maxLength only on simple typed items
            if (item?.maxLength !== undefined) {
                const simpleTypes = new Set([
                    'boolean', 'decimal', 'integer', 'string', 'text', 'url', 'open-choice',
                ]);
                if (!type || !simpleTypes.has(type)) {
                    issues.push(createValidationIssue({
                        code: 'questionnaire-invariant-que-10',
                        path,
                        resourceType: 'Questionnaire',
                        customMessage:
                            "Constraint failed: que-10: 'Maximum length can only be " +
                            "declared for simple question types'",
                        severityOverride: 'error',
                    }));
                }
            }

            // que-11: answerOption and initial cannot coexist
            if (hasAnswerOption && hasInitial) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-11',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-11: 'If one or more answerOption is " +
                        "present, initial[x] must be missing'",
                    severityOverride: 'error',
                }));
            }

            // que-12: more than one enableWhen requires enableBehavior
            if (Array.isArray(item?.enableWhen) && item.enableWhen.length > 1 && !item?.enableBehavior) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-12',
                    path,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-12: 'If there are more than one " +
                        "enableWhen, enableBehavior must be specified'",
                    severityOverride: 'error',
                }));
            }

            // Recurse into nested items
            if (nestedItems) {
                issues.push(...this.validateItems(nestedItems, linkIdSet, `${path}.item`));
            }
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
        this.buildAnswerMap(response.item || [], answerMap);

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
            issues.push(...this.validateSdcConstraints(
                response.item,
                questionMap,
                'QuestionnaireResponse.item'
            ));
        }

        return issues;
    }

    /**
     * Walk QR items in lockstep with the question map and evaluate the
     * SDC extensions declared on each question against the answers.
     *
     * Currently supports:
     *   - http://hl7.org/fhir/StructureDefinition/minValue
     *   - http://hl7.org/fhir/StructureDefinition/maxValue
     *
     * Each extension has a typed `valueX` field (valueDate, valueDecimal,
     * valueInteger, valueQuantity, …). We match against the answer's
     * corresponding value field and compare using the type's natural
     * ordering (ISO string compare for dates/dateTimes/times, numeric
     * for integer/decimal/quantity).
     *
     * Also evaluates:
     *   - questionnaire-minOccurs / questionnaire-maxOccurs (answer count)
     *   - maxLength (native Q field) + minLength (extension)
     *   - regex + entryFormat (pattern on string/url answers)
     */
    private validateSdcConstraints(
        items: QuestionnaireResponseItem[],
        questionMap: Map<string, QuestionnaireItem>,
        basePath: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const path = `${basePath}[${i}]`;
            const question = item.linkId ? questionMap.get(item.linkId) : undefined;

            if (question) {
                // Item-level SDC: answer count, length, regex
                issues.push(...this.validateItemLevelSdcConstraints(item, question, path));

                if (Array.isArray(item.answer)) {
                    for (let ai = 0; ai < item.answer.length; ai++) {
                        const answer = item.answer[ai];
                        issues.push(...this.validateAnswerAgainstExtensions(
                            answer,
                            question,
                            `${path}.answer[${ai}]`,
                        ));
                    }
                }
            }

            if (item.item && Array.isArray(item.item)) {
                issues.push(...this.validateSdcConstraints(
                    item.item,
                    questionMap,
                    `${path}.item`,
                ));
            }
        }

        return issues;
    }

    /**
     * SDC constraints at item level: answer-count bounds, string length
     * bounds, and regex pattern checks.
     */
    // eslint-disable-next-line max-lines-per-function
    private validateItemLevelSdcConstraints(
        item: QuestionnaireResponseItem,
        question: QuestionnaireItem,
        itemPath: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const qExt = (question as unknown as { extension?: Array<Record<string, unknown>> }).extension;
        const answerCount = Array.isArray(item.answer) ? item.answer.length : 0;

        // --- minOccurs / maxOccurs (answer count bounds) ---
        if (Array.isArray(qExt)) {
            for (const ext of qExt) {
                if (ext?.url === 'http://hl7.org/fhir/StructureDefinition/questionnaire-maxOccurs') {
                    const max = ext.valueInteger as number | undefined;
                    if (typeof max === 'number' && answerCount > max) {
                        issues.push(createValidationIssue({
                            code: 'questionnaire-sdc-maxoccurs',
                            path: itemPath,
                            resourceType: 'QuestionnaireResponse',
                            customMessage: `The maximum number of answers is ${max} but this has ${answerCount} answers`,
                            severityOverride: 'error',
                        }));
                    }
                }
                if (ext?.url === 'http://hl7.org/fhir/StructureDefinition/questionnaire-minOccurs') {
                    const min = ext.valueInteger as number | undefined;
                    if (typeof min === 'number' && answerCount < min) {
                        issues.push(createValidationIssue({
                            code: 'questionnaire-sdc-minoccurs',
                            path: itemPath,
                            resourceType: 'QuestionnaireResponse',
                            customMessage: `The minimum number of answers is ${min} but this has ${answerCount} answers`,
                            severityOverride: 'error',
                        }));
                    }
                }
            }
        }

        // --- maxLength / minLength / regex — apply to string/url answers ---
        if (Array.isArray(item.answer)) {
            const minLen = this.getExtensionInteger(qExt, 'http://hl7.org/fhir/StructureDefinition/minLength');
            const maxLen = question.maxLength;
            const regex = this.getExtensionString(qExt, 'http://hl7.org/fhir/StructureDefinition/regex');
            const entryFmt = this.getExtensionString(qExt, 'http://hl7.org/fhir/StructureDefinition/entryFormat');

            for (let ai = 0; ai < item.answer.length; ai++) {
                const strVal = item.answer[ai].valueString ?? item.answer[ai].valueUri;
                if (strVal === undefined) continue;
                const aPath = `${itemPath}.answer[${ai}].value`;

                if (typeof minLen === 'number' && strVal.length < minLen) {
                    issues.push(createValidationIssue({
                        code: 'questionnaire-sdc-minlength',
                        path: aPath,
                        resourceType: 'QuestionnaireResponse',
                        customMessage: `The answer '${strVal}' is shorter then the required minimum length of ${minLen}`,
                        severityOverride: 'error',
                    }));
                }
                if (typeof maxLen === 'number' && strVal.length > maxLen) {
                    issues.push(createValidationIssue({
                        code: 'questionnaire-sdc-maxlength',
                        path: aPath,
                        resourceType: 'QuestionnaireResponse',
                        customMessage: `The answer '${strVal}' is longer then the allowed maximum length of ${maxLen}`,
                        severityOverride: 'error',
                    }));
                }
                if (regex) {
                    try {
                        if (!new RegExp(regex).test(strVal)) {
                            const hint = entryFmt ? ` '${entryFmt}'` : '';
                            issues.push(createValidationIssue({
                                code: 'questionnaire-sdc-regex',
                                path: aPath,
                                resourceType: 'QuestionnaireResponse',
                                customMessage: `The answer '${strVal}' does not conform to the expected format${hint} (regex '${regex}')`,
                                severityOverride: 'error',
                            }));
                        }
                    } catch { /* invalid regex — skip */ }
                }

                // String answers for type=string should not contain newlines
                // (newlines are valid for type=text, not string)
                if (question.type === 'string' && item.answer[ai].valueString !== undefined
                    && /[\r\n]/.test(strVal)) {
                    issues.push(createValidationIssue({
                        code: 'questionnaire-sdc-string-newline',
                        path: aPath,
                        resourceType: 'QuestionnaireResponse',
                        customMessage: `The answer should not contain new line characters`,
                        severityOverride: 'warning',
                    }));
                }
            }
        }

        // --- maxDecimalPlaces (for decimal and Quantity answers) ---
        const maxDp = this.getExtensionInteger(qExt, 'http://hl7.org/fhir/StructureDefinition/maxDecimalPlaces');
        if (typeof maxDp === 'number' && Array.isArray(item.answer)) {
            for (let ai = 0; ai < item.answer.length; ai++) {
                const dec = this.getDecimalPlacesCandidate(item.answer[ai]);
                if (dec === undefined) continue;
                const decStr = String(dec);
                const dotIdx = decStr.indexOf('.');
                const actualDp = dotIdx < 0 ? 0 : decStr.length - dotIdx - 1;
                if (actualDp > maxDp) {
                    issues.push(createValidationIssue({
                        code: 'questionnaire-sdc-maxdecimalplaces',
                        path: `${itemPath}.answer[${ai}].value`,
                        resourceType: 'QuestionnaireResponse',
                        customMessage: `The value ${decStr} has too many decimal places (limit = ${maxDp})`,
                        severityOverride: 'error',
                    }));
                }
            }
        }

        return issues;
    }

    private getDecimalPlacesCandidate(answer: QuestionnaireResponseAnswer): number | string | undefined {
        if (answer.valueDecimal !== undefined) return answer.valueDecimal;
        if (answer.valueQuantity?.value !== undefined) return answer.valueQuantity.value;
        return undefined;
    }

    /** Extract an integer value from a named extension. */
    private getExtensionInteger(
        extensions: Array<Record<string, unknown>> | undefined, url: string,
    ): number | undefined {
        if (!Array.isArray(extensions)) return undefined;
        const ext = extensions.find(e => e?.url === url);
        return typeof ext?.valueInteger === 'number' ? ext.valueInteger : undefined;
    }

    /** Extract a string value from a named extension. */
    private getExtensionString(
        extensions: Array<Record<string, unknown>> | undefined, url: string,
    ): string | undefined {
        if (!Array.isArray(extensions)) return undefined;
        const ext = extensions.find(e => e?.url === url);
        return typeof ext?.valueString === 'string' ? ext.valueString : undefined;
    }

    /**
     * Check a single answer against the minValue / maxValue extensions
     * declared on its questionnaire item.
     */
    private validateAnswerAgainstExtensions(
        answer: QuestionnaireResponseAnswer,
        question: QuestionnaireItem,
        answerPath: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        const extensions = (question as unknown as { extension?: Array<Record<string, unknown>> }).extension;
        if (!Array.isArray(extensions) || extensions.length === 0) return issues;

        const MIN_URL = 'http://hl7.org/fhir/StructureDefinition/minValue';
        const MAX_URL = 'http://hl7.org/fhir/StructureDefinition/maxValue';

        for (const ext of extensions) {
            if (ext?.url !== MIN_URL && ext?.url !== MAX_URL) continue;

            const boundValue = this.extractExtensionValue(ext);
            if (boundValue === undefined || boundValue === null) continue;

            const actual = this.extractAnswerValueForCompare(answer);
            if (actual === undefined || actual === null) continue;

            const cmp = this.compareOrdinalValues(actual.value, boundValue.value);
            if (cmp === null) continue; // incompatible types, skip

            if (ext.url === MIN_URL && cmp < 0) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-sdc-minvalue',
                    path: answerPath,
                    resourceType: 'QuestionnaireResponse',
                    customMessage:
                        `The value ${actual.value} is less than the allowed minimum of ${boundValue.value}`,
                    severityOverride: 'error',
                }));
            } else if (ext.url === MAX_URL && cmp > 0) {
                issues.push(createValidationIssue({
                    code: 'questionnaire-sdc-maxvalue',
                    path: answerPath,
                    resourceType: 'QuestionnaireResponse',
                    customMessage:
                        `The value ${actual.value} is greater than the allowed maximum of ${boundValue.value}`,
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }

    /**
     * Pull the typed value out of an extension object. FHIR serialises
     * polymorphic extension values as `valueX` where X is the type code,
     * so we scan for any key starting with `value` and return it with
     * its type hint (for downstream comparison logic).
     */
    private extractExtensionValue(ext: Record<string, unknown>): { type: string; value: any } | null {
        for (const key of Object.keys(ext)) {
            if (key.startsWith('value') && key !== 'value') {
                const type = key.slice('value'.length); // e.g. "Date", "Decimal"
                return { type: type.toLowerCase(), value: ext[key] };
            }
        }
        return null;
    }

    /**
     * Pull the typed value out of a QR answer. Mirrors the extension
     * version but with an explicit key-whitelist matching the fields
     * declared on `QuestionnaireResponseAnswer`.
     */
    private extractAnswerValueForCompare(
        answer: QuestionnaireResponseAnswer,
    ): { type: string; value: any } | null {
        if (answer.valueBoolean !== undefined) return { type: 'boolean', value: answer.valueBoolean };
        if (answer.valueDecimal !== undefined) return { type: 'decimal', value: answer.valueDecimal };
        if (answer.valueInteger !== undefined) return { type: 'integer', value: answer.valueInteger };
        if (answer.valueDate !== undefined) return { type: 'date', value: answer.valueDate };
        if (answer.valueDateTime !== undefined) return { type: 'datetime', value: answer.valueDateTime };
        if (answer.valueTime !== undefined) return { type: 'time', value: answer.valueTime };
        if (answer.valueString !== undefined) return { type: 'string', value: answer.valueString };
        if (answer.valueUri !== undefined) return { type: 'uri', value: answer.valueUri };
        if (answer.valueQuantity !== undefined) {
            const q = answer.valueQuantity as { value?: number };
            return { type: 'quantity', value: q?.value };
        }
        return null;
    }

    /**
     * Compare two ordinal values the way FHIR semantics expect:
     *   - dates / dateTimes / times → ISO string compare (works for the
     *     common ISO prefix form, year / YYYY-MM / YYYY-MM-DD…)
     *   - decimal / integer / quantity → numeric compare
     *   - anything else → null (skip the check)
     *
     * Returns −1 / 0 / +1 when comparable, null otherwise.
     */
    private compareOrdinalValues(a: any, b: any): number | null {
        if (typeof a === 'number' && typeof b === 'number') {
            return Math.sign(a - b);
        }
        if (typeof a === 'string' && typeof b === 'string') {
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        }
        // Coerce numeric strings when one side is a number
        if (typeof a === 'number' && typeof b === 'string') {
            const bn = Number(b);
            return Number.isFinite(bn) ? Math.sign(a - bn) : null;
        }
        if (typeof a === 'string' && typeof b === 'number') {
            const an = Number(a);
            return Number.isFinite(an) ? Math.sign(an - b) : null;
        }
        return null;
    }

    /**
     * Build map of linkId -> answers for enableWhen evaluation
     */
    private buildAnswerMap(
        items: QuestionnaireResponseItem[],
        map: Map<string, QuestionnaireResponseAnswer[]>
    ): void {
        for (const item of items) {
            if (item.linkId && item.answer) {
                map.set(item.linkId, item.answer);
            }
            if (item.item) {
                this.buildAnswerMap(item.item, map);
            }
        }
    }

    /**
     * Evaluate enableWhen conditions for a question
     * Returns true if the question should be enabled (visible/answerable)
     */
    evaluateEnableWhen(
        question: QuestionnaireItem,
        answerMap: Map<string, QuestionnaireResponseAnswer[]>
    ): boolean {
        if (!question.enableWhen || question.enableWhen.length === 0) {
            return true; // No conditions = always enabled
        }

        const behavior = question.enableBehavior || 'all';
        const results = question.enableWhen.map(ew => this.evaluateSingleEnableWhen(ew, answerMap));

        if (behavior === 'all') {
            return results.every(r => r);
        } else {
            return results.some(r => r);
        }
    }

    /**
     * Evaluate a single enableWhen condition
     */
    private evaluateSingleEnableWhen(
        ew: EnableWhen,
        answerMap: Map<string, QuestionnaireResponseAnswer[]>
    ): boolean {
        const answers = answerMap.get(ew.question);
        const hasAnswer = answers && answers.length > 0;

        // Handle 'exists' operator specially
        if (ew.operator === 'exists') {
            const expectedExists = ew.answerBoolean ?? true;
            return hasAnswer === expectedExists;
        }

        // If no answer and not checking existence, condition is false
        if (!hasAnswer) {
            return false;
        }

        // Get the expected value from enableWhen
        const expectedValue = this.getEnableWhenValue(ew);
        if (expectedValue === undefined) {
            return false;
        }

        // Check if any answer matches the condition
        return answers!.some(answer => {
            const actualValue = this.getAnswerValue(answer);
            return this.compareValues(actualValue, ew.operator, expectedValue);
        });
    }

    /**
     * Get the expected value from an enableWhen condition
     */
    private getEnableWhenValue(ew: EnableWhen): any {
        if (ew.answerBoolean !== undefined) return ew.answerBoolean;
        if (ew.answerDecimal !== undefined) return ew.answerDecimal;
        if (ew.answerInteger !== undefined) return ew.answerInteger;
        if (ew.answerDate !== undefined) return ew.answerDate;
        if (ew.answerDateTime !== undefined) return ew.answerDateTime;
        if (ew.answerTime !== undefined) return ew.answerTime;
        if (ew.answerString !== undefined) return ew.answerString;
        if (ew.answerCoding !== undefined) return ew.answerCoding.code;
        if (ew.answerQuantity !== undefined) return ew.answerQuantity.value;
        if (ew.answerReference !== undefined) return ew.answerReference.reference;
        return undefined;
    }

    /**
     * Get the actual value from an answer
     */
    private getAnswerValue(answer: QuestionnaireResponseAnswer): any {
        if (answer.valueBoolean !== undefined) return answer.valueBoolean;
        if (answer.valueDecimal !== undefined) return answer.valueDecimal;
        if (answer.valueInteger !== undefined) return answer.valueInteger;
        if (answer.valueDate !== undefined) return answer.valueDate;
        if (answer.valueDateTime !== undefined) return answer.valueDateTime;
        if (answer.valueTime !== undefined) return answer.valueTime;
        if (answer.valueString !== undefined) return answer.valueString;
        if (answer.valueUri !== undefined) return answer.valueUri;
        if (answer.valueCoding !== undefined) return answer.valueCoding.code;
        if (answer.valueQuantity !== undefined) return answer.valueQuantity.value;
        if (answer.valueReference !== undefined) return answer.valueReference.reference;
        return undefined;
    }

    /**
     * Compare two values using the specified operator
     */
    private compareValues(actual: any, operator: EnableWhen['operator'], expected: any): boolean {
        switch (operator) {
            case '=':
                return actual === expected;
            case '!=':
                return actual !== expected;
            case '>':
                return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
            case '<':
                return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
            case '>=':
                return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
            case '<=':
                return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
            default:
                return false;
        }
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
                issues.push(...this.validateAnswerTypes(item.answer, question, `${path}.answer`));
            }

            // Validate nested items
            if (item.item) {
                issues.push(...this.validateResponseItems(item.item, questionMap, `${path}.item`));
            }
        }

        return issues;
    }

    /**
     * Validate answer types match question type, answer options, and
     * exclusive-option constraints.
     */
    private validateAnswerTypes(
        answers: QuestionnaireResponseAnswer[],
        question: QuestionnaireItem,
        basePath: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const expectedType = question.type;
        const hasOptions = Array.isArray(question.answerOption) && question.answerOption.length > 0;

        for (let i = 0; i < answers.length; i++) {
            const answer = answers[i];
            const path = `${basePath}[${i}]`;

            const actualType = this.getAnswerType(answer);

            // -- Type compatibility --
            if (!this.isTypeCompatible(actualType, expectedType)) {
                // choice with no option list + string answer → info, not error
                if (expectedType === 'choice' && actualType === 'string'
                    && !hasOptions && !question.answerValueSet) {
                    issues.push(createValidationIssue({
                        code: 'qr-type-mismatch',
                        path,
                        resourceType: 'QuestionnaireResponse',
                        customMessage: `Cannot validate string answer option because no option list is provided`,
                        severityOverride: 'information',
                    }));
                } else {
                    issues.push(createValidationIssue({
                        code: 'qr-type-mismatch',
                        path: `${path}.value`,
                        resourceType: 'QuestionnaireResponse',
                        customMessage: `Answer value must be of the type ${expectedType} not ${actualType}`,
                        severityOverride: 'error',
                    }));
                }
                continue;
            }

            // -- Answer option validation (for all value types) --
            if (hasOptions) {
                issues.push(...this.validateAnswerOption(
                    answer, question, actualType, path,
                ));
            }

            // -- Coding display-match check --
            // FHIR: when a Coding has both code and display, the display
            // SHOULD match the canonical display for that code. We cross-
            // check against answerOption first (strongest signal, since
            // the option is an explicit whitelist), then fall back to the
            // CodeSystem referenced via answerValueSet when it's already
            // loaded in the local cache.
            if (answer.valueCoding) {
                issues.push(...this.validateCodingDisplayMatch(answer, question, path));
                // When the question binds via answerValueSet and the VS is
                // already expanded in the cache, check code membership —
                // Java pairs the display mismatch with a code-invalid error
                // when the code itself isn't in the bound set.
                if (!hasOptions && question.answerValueSet) {
                    issues.push(...this.validateCodingInAnswerValueSet(answer, question, path));
                }
            }

            // -- Item-defined value content constraints --
            // Attachment mimeType / maxSize and Quantity unit / unit-bounds
            // are declared via SDC + base extensions on the question item.
            issues.push(...this.validateAnswerContentConstraints(
                answer, question, path,
            ));
        }

        // -- Exclusive option check --
        if (hasOptions && answers.length > 1) {
            issues.push(...this.validateExclusiveOptions(
                answers, question, basePath,
            ));
        }

        return issues;
    }

    /**
     * Validate per-answer constraints defined on the question item via
     * extensions:
     *   - http://hl7.org/fhir/StructureDefinition/mimeType (Attachment.contentType)
     *   - http://hl7.org/fhir/StructureDefinition/maxSize  (Attachment.size)
     *   - http://hl7.org/fhir/StructureDefinition/questionnaire-unitOption
     *     (Quantity unit allow-list)
     *   - http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-minQuantity
     *     and -maxQuantity (Quantity numeric bounds with unit compatibility)
     *
     * Messages and paths follow the Java reference validator's format.
     */
    private validateAnswerContentConstraints(
        answer: QuestionnaireResponseAnswer,
        question: QuestionnaireItem,
        answerPath: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const exts = (question as unknown as { extension?: Array<Record<string, unknown>> }).extension;
        if (!Array.isArray(exts) || exts.length === 0) return issues;

        if (answer.valueAttachment !== undefined) {
            issues.push(...this.validateAttachmentAnswer(answer.valueAttachment, exts, answerPath));
        }
        if (answer.valueQuantity !== undefined) {
            issues.push(...this.validateQuantityAnswer(
                answer.valueQuantity as Record<string, unknown>,
                exts,
                `${answerPath}.value.ofType(Quantity)`,
            ));
        }

        return issues;
    }

    /**
     * Attachment: enforce mimeType allow-list and maxSize bound.
     * Multiple `mimeType` extensions are aggregated into a single allow-list.
     */
    private validateAttachmentAnswer(
        attachment: Record<string, unknown>,
        extensions: Array<Record<string, unknown>>,
        answerPath: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const MIME_URL = 'http://hl7.org/fhir/StructureDefinition/mimeType';
        const MAX_SIZE_URL = 'http://hl7.org/fhir/StructureDefinition/maxSize';

        const allowedMimes = extensions
            .filter(e => e?.url === MIME_URL && typeof e.valueCode === 'string')
            .map(e => e.valueCode as string);
        const actualMime = attachment.contentType as string | undefined;
        if (allowedMimes.length > 0 && actualMime && !allowedMimes.includes(actualMime)) {
            issues.push(createValidationIssue({
                code: 'required',
                path: answerPath,
                resourceType: 'QuestionnaireResponse',
                customMessage:
                    `The mime type ${actualMime} is not valid for this answer ` +
                    `(allowed = ${allowedMimes.join(',')})`,
                severityOverride: 'error',
            }));
        }

        const maxSizeExt = extensions.find(e => e?.url === MAX_SIZE_URL);
        const maxSize = typeof maxSizeExt?.valueDecimal === 'number'
            ? maxSizeExt.valueDecimal as number
            : (typeof maxSizeExt?.valueInteger === 'number' ? maxSizeExt.valueInteger as number : undefined);
        const actualSize = typeof attachment.size === 'number' ? attachment.size : undefined;
        if (typeof maxSize === 'number' && typeof actualSize === 'number' && actualSize > maxSize) {
            issues.push(createValidationIssue({
                code: 'required',
                path: answerPath,
                resourceType: 'QuestionnaireResponse',
                customMessage:
                    `The attachment is too large (allowed = ${maxSize}, found = ${actualSize})`,
                severityOverride: 'error',
            }));
        }

        return issues;
    }

    /**
     * Quantity: enforce unitOption allow-list and SDC min/maxQuantity bounds.
     *
     * Bound comparison rules (mirroring the Java reference validator):
     *   - if either side lacks a `system+code` pair → "no formal units"
     *   - if codes match exactly → numeric compare
     *   - otherwise → "cannot be compared" (different UCUM codes)
     */
    private validateQuantityAnswer(
        quantity: Record<string, unknown>,
        extensions: Array<Record<string, unknown>>,
        answerPath: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const UNIT_OPT_URL = 'http://hl7.org/fhir/StructureDefinition/questionnaire-unitOption';
        const MIN_Q_URL = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-minQuantity';
        const MAX_Q_URL = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-maxQuantity';

        const unitOptions = extensions
            .filter(e => e?.url === UNIT_OPT_URL)
            .map(e => e.valueCoding as { system?: string; code?: string; display?: string } | undefined)
            .filter((c): c is { system?: string; code?: string; display?: string } => !!c);

        if (unitOptions.length > 0) {
            const matches = unitOptions.some(opt =>
                (opt.system === undefined || opt.system === quantity.system)
                && opt.code === quantity.code,
            );
            if (!matches) {
                const allowed = unitOptions.map(o => `${o.display ?? o.code} (UCUM#${o.code})`).join(',');
                issues.push(createValidationIssue({
                    code: 'invariant',
                    path: answerPath,
                    resourceType: 'QuestionnaireResponse',
                    customMessage:
                        `The value ${this.formatQuantityForMessage(quantity)} has a unit ` +
                        `that is not valid (allowed = ${allowed})`,
                    severityOverride: 'error',
                }));
            }
        }

        for (const ext of extensions) {
            if (ext?.url !== MIN_Q_URL && ext?.url !== MAX_Q_URL) continue;
            const bound = ext.valueQuantity as Record<string, unknown> | undefined;
            if (!bound) continue;
            issues.push(...this.compareQuantityBound(quantity, bound, ext.url === MIN_Q_URL, answerPath));
        }

        return issues;
    }

    /** Render a Quantity as `{value} {unit} (UCUM#{code})` or omit the
     *  parenthesised UCUM hint when no formal code is present. */
    private formatQuantityForMessage(q: Record<string, unknown>): string {
        const value = q.value;
        const unit = q.unit ?? '';
        const code = q.code as string | undefined;
        const base = `${value} ${unit}`.trimEnd();
        return code ? `${base} (UCUM#${code})` : base;
    }

    /**
     * Compare an answer Quantity against a single min/max bound. Emits one
     * issue when out of range or when the units cannot be compared.
     *
     * Supports simple UCUM commensurability + conversion for the common
     * length/mass/time families used by the reference test suite. Anything
     * outside the table degrades to "cannot be compared" (matching the
     * Java validator's behaviour for incommensurable units).
     */
    private compareQuantityBound(
        actual: Record<string, unknown>,
        bound: Record<string, unknown>,
        isMin: boolean,
        answerPath: string,
    ): ValidationIssue[] {
        const label = isMin ? 'minimum' : 'maximum';
        const actualHasUcum = !!(actual.system && actual.code);
        const boundHasUcum = !!(bound.system && bound.code);

        // No formal units on either side
        if (!actualHasUcum || !boundHasUcum) {
            return [createValidationIssue({
                code: 'invariant',
                path: answerPath,
                resourceType: 'QuestionnaireResponse',
                customMessage:
                    `The quantity ${this.formatQuantityForMessage(actual)} cannot be compared to the ` +
                    `allowed ${label} of ${this.formatQuantityForMessage(bound)} ` +
                    `because no formal units are specified`,
                severityOverride: 'error',
            })];
        }

        const av = typeof actual.value === 'number' ? actual.value : Number(actual.value);
        const bv = typeof bound.value === 'number' ? bound.value : Number(bound.value);
        if (!Number.isFinite(av) || !Number.isFinite(bv)) return [];

        const converted = this.convertUcumValue(av, actual.code as string, bound.code as string);
        if (converted === null) {
            // Different UCUM codes from incommensurable families → not comparable
            return [createValidationIssue({
                code: 'invariant',
                path: answerPath,
                resourceType: 'QuestionnaireResponse',
                customMessage:
                    `The quantity ${this.formatQuantityForMessage(actual)} cannot be compared to the ` +
                    `allowed ${label} of ${this.formatQuantityForMessage(bound)}`,
                severityOverride: 'error',
            })];
        }

        const violates = isMin ? converted < bv : converted > bv;
        if (!violates) return [];

        const cmp = isMin ? 'less than' : 'greater than';
        return [createValidationIssue({
            code: 'invariant',
            path: answerPath,
            resourceType: 'QuestionnaireResponse',
            customMessage:
                `The quantity ${this.formatQuantityForMessage(actual)} is ${cmp} the ` +
                `allowed ${label} of ${this.formatQuantityForMessage(bound)}`,
            severityOverride: 'error',
        })];
    }

    /**
     * Convert `value` from `fromCode` to `toCode` using a small UCUM table
     * for the families exercised by the FHIR conformance suite (length,
     * mass, time, volume). Returns null if the two codes belong to
     * different families (incommensurable) or are unknown.
     *
     * Same code → identity (no conversion needed).
     */
    private convertUcumValue(value: number, fromCode: string, toCode: string): number | null {
        if (fromCode === toCode) return value;
        // family → unitCode → factor relative to the base unit
        const families: Record<string, Record<string, number>> = {
            length: {
                'm': 1, 'km': 1000, 'cm': 0.01, 'mm': 0.001, 'um': 1e-6, 'nm': 1e-9,
                '[in_i]': 0.0254, '[ft_i]': 0.3048, '[yd_i]': 0.9144, '[mi_i]': 1609.344,
            },
            mass: {
                'g': 1, 'kg': 1000, 'mg': 0.001, 'ug': 1e-6, 'ng': 1e-9,
                '[lb_av]': 453.59237, '[oz_av]': 28.349523125,
            },
            time: {
                's': 1, 'min': 60, 'h': 3600, 'd': 86400, 'wk': 604800,
                'mo': 2629800, 'a': 31557600, 'ms': 0.001,
            },
            volume: {
                'L': 1, 'mL': 0.001, 'dL': 0.1, 'uL': 1e-6,
            },
        };
        for (const units of Object.values(families)) {
            const f = units[fromCode];
            const t = units[toCode];
            if (f !== undefined && t !== undefined) {
                return (value * f) / t;
            }
        }
        return null;
    }

    /**
     * Check whether a single answer value matches one of the permitted
     * `answerOption` entries on the Questionnaire item. Works for Coding,
     * integer, date, time, string, and reference option types.
     */
    private validateAnswerOption(
        answer: QuestionnaireResponseAnswer,
        question: QuestionnaireItem,
        answerType: string,
        answerPath: string,
    ): ValidationIssue[] {
        const options = question.answerOption!;
        const expectedType = question.type;
        const isOpenChoice = expectedType === 'open-choice';

        // For open-choice, valueString is always acceptable (free-text)
        if (isOpenChoice && answerType === 'string') return [];

        const matchFound = options.some(opt => this.optionMatchesAnswer(opt, answer));
        if (matchFound) return [];

        // No match — build a human-readable description of the bad value
        const desc = this.describeAnswerValue(answer, answerType);
        return [createValidationIssue({
            code: 'qr-invalid-option',
            path: answerPath,
            resourceType: 'QuestionnaireResponse',
            customMessage: `The ${desc.typeName} ${desc.displayValue} is not in the set of permitted values`,
            severityOverride: 'error',
        })];
    }

    /**
     * Emit an issue when a Coding answer carries a `display` that disagrees
     * with the canonical display for that code. Two sources of truth are
     * consulted:
     *   1. `question.answerOption.valueCoding` — matched on system+code
     *   2. CodeSystem in the local `valueSetCache` — matched on system URL
     *
     * Mirrors the Java validator's `Wrong Display Name …` error (severity
     * error, code invalid) at path `…answer[i].value.ofType(Coding).display`.
     * Cache-only: if the CodeSystem isn't loaded we skip the check rather
     * than trigger disk I/O during validation.
     */
    private validateCodingDisplayMatch(
        answer: QuestionnaireResponseAnswer,
        question: QuestionnaireItem,
        answerPath: string,
    ): ValidationIssue[] {
        const coding = answer.valueCoding;
        if (!coding || !coding.code || !coding.display) return [];

        const expectedDisplay = this.resolveExpectedCodingDisplay(coding, question);
        if (expectedDisplay === null) return [];
        if (expectedDisplay === coding.display) return [];

        const systemRef = coding.system ? `${coding.system}#${coding.code}` : coding.code;
        return [createValidationIssue({
            code: 'qr-display-mismatch',
            path: `${answerPath}.value.ofType(Coding).display`,
            resourceType: 'QuestionnaireResponse',
            customMessage:
                `Wrong Display Name '${coding.display}' for ${systemRef}. ` +
                `Valid display is '${expectedDisplay}'`,
            severityOverride: 'error',
        })];
    }

    /**
     * Resolve the canonical display for a Coding answer. Prefers an
     * explicit `answerOption.valueCoding` match over a CodeSystem lookup.
     * Returns `null` when we can't determine the expected display (the
     * check is silently skipped in that case).
     */
    private resolveExpectedCodingDisplay(
        coding: { system?: string; code: string; display?: string },
        question: QuestionnaireItem,
    ): string | null {
        if (Array.isArray(question.answerOption)) {
            for (const opt of question.answerOption) {
                const optCoding = opt.valueCoding;
                if (!optCoding) continue;
                const systemsMatch = optCoding.system === coding.system
                    || optCoding.system === undefined;
                if (systemsMatch && optCoding.code === coding.code
                    && typeof optCoding.display === 'string') {
                    return optCoding.display;
                }
            }
        }

        if (!coding.system) return null;
        const codeSystem = this.resolveCachedCodeSystem(coding.system);
        if (!codeSystem) return null;

        const concept = this.findCodeSystemConcept(codeSystem.concept, coding.code);
        return concept?.display ?? null;
    }

    /**
     * Look up a CodeSystem by URL from the shared cache. Handles both the
     * bare URL and the package-loader's version-suffixed keys (`…|fhir4`,
     * `…|fhir5`) produced during ValueSet expansion.
     */
    private resolveCachedCodeSystem(systemUrl: string): CodeSystem | null {
        const direct = valueSetCache.getCodeSystem(systemUrl)
            ?? valueSetCache.getCodeSystemFile(systemUrl);
        if (direct) return direct;
        for (const major of ['4', '5', '6']) {
            const suffixed = `${systemUrl}|fhir${major}`;
            const hit = valueSetCache.getCodeSystem(suffixed)
                ?? valueSetCache.getCodeSystemFile(suffixed);
            if (hit) return hit;
        }
        return null;
    }

    /**
     * When a question binds via `answerValueSet`, emit a code-invalid error
     * if the Coding's system|code is not in the ValueSet's expansion —
     * OR if the display is known to disagree with the CodeSystem's concept
     * display. The Java reference validator pairs this error with the
     * display-mismatch error whenever the display is wrong, so we mirror
     * that behaviour. The prewarm step (on registerQuestionnaire) populates
     * the expansion in the cache; if it's still missing at validation time
     * we skip silently rather than fail-loud.
     */
    private validateCodingInAnswerValueSet(
        answer: QuestionnaireResponseAnswer,
        question: QuestionnaireItem,
        answerPath: string,
    ): ValidationIssue[] {
        const coding = answer.valueCoding;
        if (!coding?.code || !question.answerValueSet) return [];

        const vsUrl = question.answerValueSet;
        const expanded = valueSetCache.getExpandedCodes(vsUrl)
            ?? valueSetCache.getExpandedCodes(vsUrl.split('|')[0]);

        let notInSet = false;
        if (expanded && expanded.size > 0) {
            const fullCode = coding.system ? `${coding.system}|${coding.code}` : coding.code;
            notInSet = !(expanded.has(fullCode) || expanded.has(coding.code));
        }

        let wrongDisplay = false;
        if (!notInSet && typeof coding.display === 'string') {
            const expected = this.resolveExpectedCodingDisplay(coding, question);
            wrongDisplay = expected !== null && expected !== coding.display;
        }

        if (!notInSet && !wrongDisplay) return [];

        const vsName = vsUrl.split('/').pop()?.replace(/[-_]/g, ' ') ?? vsUrl;
        const system = coding.system ?? '';
        return [createValidationIssue({
            code: 'qr-code-not-in-valueset',
            path: answerPath,
            resourceType: 'QuestionnaireResponse',
            customMessage:
                `The code '${coding.code}' in the system '${system}' is not in ` +
                `the options value set (${vsName}) specified by the questionnaire`,
            severityOverride: 'error',
        })];
    }

    /** Recursive depth-first search for a concept by code. */
    private findCodeSystemConcept(
        concepts: CodeSystemConcept[] | undefined,
        code: string,
    ): CodeSystemConcept | null {
        if (!concepts) return null;
        for (const concept of concepts) {
            if (concept.code === code) return concept;
            const nested = this.findCodeSystemConcept(concept.concept, code);
            if (nested) return nested;
        }
        return null;
    }

    /**
     * Does a single answerOption match a given answer?
     */
    private optionMatchesAnswer(
        opt: AnswerOption,
        answer: QuestionnaireResponseAnswer,
    ): boolean {
        if (opt.valueCoding && answer.valueCoding) {
            return (opt.valueCoding.system === answer.valueCoding.system
                && opt.valueCoding.code === answer.valueCoding.code);
        }
        if (opt.valueInteger !== undefined && answer.valueInteger !== undefined) {
            return opt.valueInteger === answer.valueInteger;
        }
        if (opt.valueDate !== undefined && answer.valueDate !== undefined) {
            return opt.valueDate === answer.valueDate;
        }
        if (opt.valueTime !== undefined && answer.valueTime !== undefined) {
            return opt.valueTime === answer.valueTime;
        }
        if (opt.valueString !== undefined && answer.valueString !== undefined) {
            return opt.valueString === answer.valueString;
        }
        if (opt.valueReference && answer.valueReference) {
            return opt.valueReference.reference === answer.valueReference.reference;
        }
        return false;
    }

    /**
     * Produce a type name + display value suitable for error messages,
     * following the Java validator's formatting conventions.
     */
    private describeAnswerValue(
        answer: QuestionnaireResponseAnswer,
        answerType: string,
    ): { typeName: string; displayValue: string } {
        if (answer.valueCoding) {
            const sys = answer.valueCoding.system || '';
            return { typeName: 'code', displayValue: `${sys}::${answer.valueCoding.code}` };
        }
        if (answer.valueInteger !== undefined) return { typeName: 'integer', displayValue: String(answer.valueInteger) };
        if (answer.valueDate !== undefined) return { typeName: 'date', displayValue: answer.valueDate };
        if (answer.valueTime !== undefined) return { typeName: 'time', displayValue: answer.valueTime };
        if (answer.valueString !== undefined) return { typeName: 'string', displayValue: answer.valueString };
        if (answer.valueReference) return { typeName: 'reference', displayValue: answer.valueReference.reference };
        return { typeName: answerType, displayValue: '(unknown)' };
    }

    /**
     * If any selected answer carries the `questionnaire-optionExclusive`
     * extension (valueBoolean = true) and more than one answer is present,
     * flag it.
     */
    private validateExclusiveOptions(
        answers: QuestionnaireResponseAnswer[],
        question: QuestionnaireItem,
        basePath: string,
    ): ValidationIssue[] {
        const EXCLUSIVE_URL = 'http://hl7.org/fhir/StructureDefinition/questionnaire-optionExclusive';
        const issues: ValidationIssue[] = [];
        const options = question.answerOption!;

        for (let i = 0; i < answers.length; i++) {
            const answer = answers[i];
            // Find the matching answerOption
            const matchingOpt = options.find(opt => this.optionMatchesAnswer(opt, answer));
            if (!matchingOpt) continue;

            const isExclusive = matchingOpt.extension?.some(
                ext => ext.url === EXCLUSIVE_URL && ext.valueBoolean === true
            );
            if (isExclusive) {
                const desc = this.describeAnswerValue(answer, this.getAnswerType(answer));
                const optionLabel = answer.valueCoding
                    ? `${answer.valueCoding.system || ''}#${answer.valueCoding.code}`
                    : desc.displayValue;
                issues.push(createValidationIssue({
                    code: 'qr-exclusive-option',
                    path: `${basePath}[${i}]`,
                    resourceType: 'QuestionnaireResponse',
                    customMessage: `Selected answer ${optionLabel} is an exclusive option - can't select anything else at the same time`,
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }

    /**
     * Get answer type from answer object
     */
    private getAnswerType(answer: QuestionnaireResponseAnswer): string {
        if (answer.valueBoolean !== undefined) return 'boolean';
        if (answer.valueDecimal !== undefined) return 'decimal';
        if (answer.valueInteger !== undefined) return 'integer';
        if (answer.valueDate !== undefined) return 'date';
        if (answer.valueDateTime !== undefined) return 'dateTime';
        if (answer.valueTime !== undefined) return 'time';
        if (answer.valueString !== undefined) return 'string';
        if (answer.valueUri !== undefined) return 'url';
        if (answer.valueAttachment !== undefined) return 'attachment';
        if (answer.valueCoding !== undefined) return 'coding';
        if (answer.valueQuantity !== undefined) return 'quantity';
        if (answer.valueReference !== undefined) return 'reference';
        return 'unknown';
    }

    /**
     * Check if answer type is compatible with question type
     */
    private isTypeCompatible(answerType: string, questionType: string): boolean {
        if (answerType === questionType) return true;

        // Special cases
        if (questionType === 'choice' && answerType === 'coding') return true;
        if (questionType === 'open-choice' && (answerType === 'coding' || answerType === 'string')) return true;
        if (questionType === 'text' && answerType === 'string') return true;

        return false;
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
            if (!this.evaluateEnableWhen(question, answerMap)) continue;

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
