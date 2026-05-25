import type { EnableWhen, QuestionnaireItem, QuestionnaireResponseAnswer, QuestionnaireResponseItem } from './questionnaire-types';

export function buildQuestionnaireAnswerMap(
    items: QuestionnaireResponseItem[],
    map: Map<string, QuestionnaireResponseAnswer[]>,
): void {
    for (const item of items) {
        if (item.linkId && item.answer) {
            map.set(item.linkId, item.answer);
        }
        if (item.item) {
            buildQuestionnaireAnswerMap(item.item, map);
        }
    }
}

export function isQuestionnaireItemEnabled(
    question: QuestionnaireItem,
    answerMap: Map<string, QuestionnaireResponseAnswer[]>,
): boolean {
    if (!question.enableWhen || question.enableWhen.length === 0) {
        return true;
    }

    const behavior = question.enableBehavior || 'all';
    const results = question.enableWhen.map(ew => evaluateSingleEnableWhen(ew, answerMap));

    return behavior === 'all'
        ? results.every(Boolean)
        : results.some(Boolean);
}

function evaluateSingleEnableWhen(
    ew: EnableWhen,
    answerMap: Map<string, QuestionnaireResponseAnswer[]>,
): boolean {
    const answers = answerMap.get(ew.question);
    const hasAnswer = !!answers && answers.length > 0;

    if (ew.operator === 'exists') {
        const expectedExists = ew.answerBoolean ?? true;
        return hasAnswer === expectedExists;
    }

    if (!hasAnswer) {
        return false;
    }

    const expectedValue = getEnableWhenValue(ew);
    if (expectedValue === undefined) {
        return false;
    }

    return answers.some(answer => compareValues(
        getAnswerValue(answer),
        ew.operator,
        expectedValue,
    ));
}

function getEnableWhenValue(ew: EnableWhen): any {
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

function getAnswerValue(answer: QuestionnaireResponseAnswer): any {
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

function compareValues(actual: any, operator: EnableWhen['operator'], expected: any): boolean {
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
