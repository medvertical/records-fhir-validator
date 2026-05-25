import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { QuestionnaireItem, QuestionnaireResponseAnswer, QuestionnaireResponseItem } from './questionnaire-types';

export function validateQuestionnaireSdcConstraints(
    items: QuestionnaireResponseItem[],
    questionMap: Map<string, QuestionnaireItem>,
    basePath: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const path = `${basePath}[${i}]`;
        const question = item.linkId ? questionMap.get(item.linkId) : undefined;

        if (question) {
            issues.push(...validateItemLevelSdcConstraints(item, question, path));

            if (Array.isArray(item.answer)) {
                for (let ai = 0; ai < item.answer.length; ai++) {
                    issues.push(...validateAnswerAgainstExtensions(
                        item.answer[ai],
                        question,
                        `${path}.answer[${ai}]`,
                    ));
                }
            }
        }

        if (Array.isArray(item.item)) {
            issues.push(...validateQuestionnaireSdcConstraints(item.item, questionMap, `${path}.item`));
        }
    }

    return issues;
}

function validateItemLevelSdcConstraints(
    item: QuestionnaireResponseItem,
    question: QuestionnaireItem,
    itemPath: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const qExt = (question as unknown as { extension?: Array<Record<string, unknown>> }).extension;
    const answerCount = Array.isArray(item.answer) ? item.answer.length : 0;

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

    issues.push(...validateTextAnswerConstraints(item, question, itemPath, qExt));
    issues.push(...validateMaxDecimalPlaces(item, itemPath, qExt));

    return issues;
}

function validateTextAnswerConstraints(
    item: QuestionnaireResponseItem,
    question: QuestionnaireItem,
    itemPath: string,
    qExt: Array<Record<string, unknown>> | undefined,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!Array.isArray(item.answer)) return issues;

    const minLen = getExtensionInteger(qExt, 'http://hl7.org/fhir/StructureDefinition/minLength');
    const maxLen = question.maxLength;
    const regex = getExtensionString(qExt, 'http://hl7.org/fhir/StructureDefinition/regex');
    const entryFmt = getExtensionString(qExt, 'http://hl7.org/fhir/StructureDefinition/entryFormat');

    for (let ai = 0; ai < item.answer.length; ai++) {
        const strVal = item.answer[ai].valueString ?? item.answer[ai].valueUri;
        if (strVal === undefined) continue;
        const answerPath = `${itemPath}.answer[${ai}].value`;

        if (typeof minLen === 'number' && strVal.length < minLen) {
            issues.push(createValidationIssue({
                code: 'questionnaire-sdc-minlength',
                path: answerPath,
                resourceType: 'QuestionnaireResponse',
                customMessage: `The answer '${strVal}' is shorter then the required minimum length of ${minLen}`,
                severityOverride: 'error',
            }));
        }
        if (typeof maxLen === 'number' && strVal.length > maxLen) {
            issues.push(createValidationIssue({
                code: 'questionnaire-sdc-maxlength',
                path: answerPath,
                resourceType: 'QuestionnaireResponse',
                customMessage: `The answer '${strVal}' is longer then the allowed maximum length of ${maxLen}`,
                severityOverride: 'error',
            }));
        }
        if (regex) {
            issues.push(...validateRegexAnswer(strVal, regex, entryFmt, answerPath));
        }
        if (question.type === 'string' && item.answer[ai].valueString !== undefined && /[\r\n]/.test(strVal)) {
            issues.push(createValidationIssue({
                code: 'questionnaire-sdc-string-newline',
                path: answerPath,
                resourceType: 'QuestionnaireResponse',
                customMessage: 'The answer should not contain new line characters',
                severityOverride: 'warning',
            }));
        }
    }

    return issues;
}

function validateRegexAnswer(
    value: string,
    regex: string,
    entryFormat: string | undefined,
    answerPath: string,
): ValidationIssue[] {
    try {
        if (new RegExp(regex).test(value)) return [];
        const hint = entryFormat ? ` '${entryFormat}'` : '';
        return [createValidationIssue({
            code: 'questionnaire-sdc-regex',
            path: answerPath,
            resourceType: 'QuestionnaireResponse',
            customMessage: `The answer '${value}' does not conform to the expected format${hint} (regex '${regex}')`,
            severityOverride: 'error',
        })];
    } catch {
        return [];
    }
}

function validateMaxDecimalPlaces(
    item: QuestionnaireResponseItem,
    itemPath: string,
    qExt: Array<Record<string, unknown>> | undefined,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const maxDp = getExtensionInteger(qExt, 'http://hl7.org/fhir/StructureDefinition/maxDecimalPlaces');
    if (typeof maxDp !== 'number' || !Array.isArray(item.answer)) return issues;

    for (let ai = 0; ai < item.answer.length; ai++) {
        const decimalCandidate = getDecimalPlacesCandidate(item.answer[ai]);
        if (decimalCandidate === undefined) continue;
        const decimalText = String(decimalCandidate);
        const dotIdx = decimalText.indexOf('.');
        const actualDp = dotIdx < 0 ? 0 : decimalText.length - dotIdx - 1;
        if (actualDp > maxDp) {
            issues.push(createValidationIssue({
                code: 'questionnaire-sdc-maxdecimalplaces',
                path: `${itemPath}.answer[${ai}].value`,
                resourceType: 'QuestionnaireResponse',
                customMessage: `The value ${decimalText} has too many decimal places (limit = ${maxDp})`,
                severityOverride: 'error',
            }));
        }
    }

    return issues;
}

function getDecimalPlacesCandidate(answer: QuestionnaireResponseAnswer): number | string | undefined {
    if (answer.valueDecimal !== undefined) return answer.valueDecimal;
    if (answer.valueQuantity?.value !== undefined) return answer.valueQuantity.value;
    return undefined;
}

function getExtensionInteger(
    extensions: Array<Record<string, unknown>> | undefined,
    url: string,
): number | undefined {
    if (!Array.isArray(extensions)) return undefined;
    const ext = extensions.find(e => e?.url === url);
    return typeof ext?.valueInteger === 'number' ? ext.valueInteger : undefined;
}

function getExtensionString(
    extensions: Array<Record<string, unknown>> | undefined,
    url: string,
): string | undefined {
    if (!Array.isArray(extensions)) return undefined;
    const ext = extensions.find(e => e?.url === url);
    return typeof ext?.valueString === 'string' ? ext.valueString : undefined;
}

function validateAnswerAgainstExtensions(
    answer: QuestionnaireResponseAnswer,
    question: QuestionnaireItem,
    answerPath: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const extensions = (question as unknown as { extension?: Array<Record<string, unknown>> }).extension;
    if (!Array.isArray(extensions) || extensions.length === 0) return issues;

    const minUrl = 'http://hl7.org/fhir/StructureDefinition/minValue';
    const maxUrl = 'http://hl7.org/fhir/StructureDefinition/maxValue';

    for (const ext of extensions) {
        if (ext?.url !== minUrl && ext?.url !== maxUrl) continue;

        const boundValue = extractExtensionValue(ext);
        if (boundValue === null) continue;

        const actual = extractAnswerValueForCompare(answer);
        if (actual === null) continue;

        const cmp = compareOrdinalValues(actual.value, boundValue.value);
        if (cmp === null) continue;

        if (ext.url === minUrl && cmp < 0) {
            issues.push(createValidationIssue({
                code: 'questionnaire-sdc-minvalue',
                path: answerPath,
                resourceType: 'QuestionnaireResponse',
                customMessage: `The value ${actual.value} is less than the allowed minimum of ${boundValue.value}`,
                severityOverride: 'error',
            }));
        } else if (ext.url === maxUrl && cmp > 0) {
            issues.push(createValidationIssue({
                code: 'questionnaire-sdc-maxvalue',
                path: answerPath,
                resourceType: 'QuestionnaireResponse',
                customMessage: `The value ${actual.value} is greater than the allowed maximum of ${boundValue.value}`,
                severityOverride: 'error',
            }));
        }
    }

    return issues;
}

function extractExtensionValue(ext: Record<string, unknown>): { type: string; value: any } | null {
    for (const key of Object.keys(ext)) {
        if (key.startsWith('value') && key !== 'value') {
            const type = key.slice('value'.length);
            return { type: type.toLowerCase(), value: ext[key] };
        }
    }
    return null;
}

function extractAnswerValueForCompare(answer: QuestionnaireResponseAnswer): { type: string; value: any } | null {
    if (answer.valueBoolean !== undefined) return { type: 'boolean', value: answer.valueBoolean };
    if (answer.valueDecimal !== undefined) return { type: 'decimal', value: answer.valueDecimal };
    if (answer.valueInteger !== undefined) return { type: 'integer', value: answer.valueInteger };
    if (answer.valueDate !== undefined) return { type: 'date', value: answer.valueDate };
    if (answer.valueDateTime !== undefined) return { type: 'datetime', value: answer.valueDateTime };
    if (answer.valueTime !== undefined) return { type: 'time', value: answer.valueTime };
    if (answer.valueString !== undefined) return { type: 'string', value: answer.valueString };
    if (answer.valueUri !== undefined) return { type: 'uri', value: answer.valueUri };
    if (answer.valueQuantity !== undefined) {
        const quantity = answer.valueQuantity as { value?: number };
        return { type: 'quantity', value: quantity?.value };
    }
    return null;
}

function compareOrdinalValues(a: any, b: any): number | null {
    if (typeof a === 'number' && typeof b === 'number') {
        return Math.sign(a - b);
    }
    if (typeof a === 'string' && typeof b === 'string') {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }
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
