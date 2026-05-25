import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

interface QuestionnaireItemValidationState {
    item: any;
    path: string;
    type: string | undefined;
    nestedItems: any[] | undefined;
    hasAnswerOption: boolean;
    hasAnswerValueSet: boolean;
    hasInitial: boolean;
}

/**
 * Validate Questionnaire items recursively.
 *
 * Covers linkId uniqueness and FHIR R4 que-1 through que-12 item invariants.
 */
export function validateQuestionnaireItems(
    items: any[],
    linkIdSet: Set<string>,
    basePath: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (let i = 0; i < items.length; i++) {
        const state = createItemState(items[i], `${basePath}[${i}]`);

        issues.push(...validateLinkId(state.item, state.path, linkIdSet));
        issues.push(...validateRequiredType(state));
        issues.push(...validateGroupAndDisplayShape(state));
        issues.push(...validateAnswerSources(state));
        issues.push(...validateDisplayRestrictions(state));
        issues.push(...validateEnableWhenDefinition(state));
        issues.push(...validateInitialAndLength(state));

        if (state.nestedItems) {
            issues.push(...validateQuestionnaireItems(state.nestedItems, linkIdSet, `${state.path}.item`));
        }
    }

    return issues;
}

function createItemState(item: any, path: string): QuestionnaireItemValidationState {
    return {
        item,
        path,
        type: item?.type,
        nestedItems: Array.isArray(item?.item) ? item.item : undefined,
        hasAnswerOption: Array.isArray(item?.answerOption) && item.answerOption.length > 0,
        hasAnswerValueSet: !!item?.answerValueSet,
        hasInitial: Array.isArray(item?.initial) && item.initial.length > 0,
    };
}

function validateLinkId(
    item: any,
    path: string,
    linkIdSet: Set<string>,
): ValidationIssue[] {
    if (!item.linkId) {
        return [createValidationIssue({
            code: 'questionnaire-missing-linkid',
            path: `${path}.linkId`,
            resourceType: 'Questionnaire',
            customMessage: 'Item must have a linkId',
            severityOverride: 'error',
        })];
    }

    const issues: ValidationIssue[] = [];
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

    return issues;
}

function validateRequiredType(state: QuestionnaireItemValidationState): ValidationIssue[] {
    if (state.type) return [];

    return [createValidationIssue({
        code: 'questionnaire-missing-type',
        path: `${state.path}.type`,
        resourceType: 'Questionnaire',
        customMessage: 'Item must have a type',
        severityOverride: 'error',
    })];
}

function validateGroupAndDisplayShape(state: QuestionnaireItemValidationState): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { item, nestedItems, path, type } = state;

    if (type === 'group' && (!nestedItems || nestedItems.length === 0)) {
        issues.push(createQue1Issue(path));
    }
    if (type === 'display' && nestedItems && nestedItems.length > 0) {
        issues.push(createQue1Issue(path));
    }
    if (type === 'display' && Array.isArray(item?.code) && item.code.length > 0) {
        issues.push(createValidationIssue({
            code: 'questionnaire-invariant-que-3',
            path,
            resourceType: 'Questionnaire',
            customMessage: 'Constraint failed: que-3: \'Display items cannot have a "code" asserted\'',
            severityOverride: 'error',
        }));
    }

    return issues;
}

function createQue1Issue(path: string): ValidationIssue {
    return createValidationIssue({
        code: 'questionnaire-invariant-que-1',
        path,
        resourceType: 'Questionnaire',
        customMessage:
            "Constraint failed: que-1: 'Group items must have nested " +
            "items, display items cannot have nested items'",
        severityOverride: 'error',
    });
}

function validateAnswerSources(state: QuestionnaireItemValidationState): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { hasAnswerOption, hasAnswerValueSet, path, type } = state;

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

    if (hasAnswerValueSet && type !== 'choice' && type !== 'open-choice') {
        issues.push(createAnswerSourceTypeIssue(path, 'answerValueSet'));
    }
    if (hasAnswerOption && type !== 'choice' && type !== 'open-choice') {
        issues.push(createAnswerSourceTypeIssue(path, 'answerOption'));
    }

    return issues;
}

function createAnswerSourceTypeIssue(path: string, field: 'answerOption' | 'answerValueSet'): ValidationIssue {
    return createValidationIssue({
        code: 'questionnaire-invariant-que-5',
        path,
        resourceType: 'Questionnaire',
        customMessage:
            "Constraint failed: que-5: 'Only \u0027choice\u0027 and " +
            `\u0027open-choice\u0027 items can have ${field}'`,
        severityOverride: 'error',
    });
}

function validateDisplayRestrictions(state: QuestionnaireItemValidationState): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { item, path, type } = state;

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
    if (type === 'display' && item?.readOnly !== undefined) {
        issues.push(createValidationIssue({
            code: 'questionnaire-invariant-que-9',
            path,
            resourceType: 'Questionnaire',
            customMessage:
                'Constraint failed: que-9: \'Read Only can\u0027t be specified ' +
                'for "display" items\'',
            severityOverride: 'error',
        }));
    }

    return issues;
}

function validateEnableWhenDefinition(state: QuestionnaireItemValidationState): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const enableWhen = state.item?.enableWhen;

    if (Array.isArray(enableWhen)) {
        for (let ewi = 0; ewi < enableWhen.length; ewi++) {
            const ew = enableWhen[ewi];
            if (ew?.operator === 'exists' && typeof ew?.answerBoolean !== 'boolean') {
                issues.push(createValidationIssue({
                    code: 'questionnaire-invariant-que-7',
                    path: `${state.path}.enableWhen[${ewi}]`,
                    resourceType: 'Questionnaire',
                    customMessage:
                        "Constraint failed: que-7: 'If the operator is " +
                        "\u0027exists\u0027, the value must be a boolean'",
                    severityOverride: 'error',
                }));
            }
        }
    }

    if (Array.isArray(enableWhen) && enableWhen.length > 1 && !state.item?.enableBehavior) {
        issues.push(createValidationIssue({
            code: 'questionnaire-invariant-que-12',
            path: state.path,
            resourceType: 'Questionnaire',
            customMessage:
                "Constraint failed: que-12: 'If there are more than one " +
                "enableWhen, enableBehavior must be specified'",
            severityOverride: 'error',
        }));
    }

    return issues;
}

function validateInitialAndLength(state: QuestionnaireItemValidationState): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { hasAnswerOption, hasInitial, item, path, type } = state;

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

    if (item?.maxLength !== undefined && !canHaveMaxLength(type)) {
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

    return issues;
}

function canHaveMaxLength(type: string | undefined): boolean {
    return !!type && ['boolean', 'decimal', 'integer', 'string', 'text', 'url', 'open-choice'].includes(type);
}
