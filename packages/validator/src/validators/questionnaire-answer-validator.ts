import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { validateQuestionnaireQuantityAnswer } from './questionnaire-quantity-answer';
import type { AnswerOption, QuestionnaireItem, QuestionnaireResponseAnswer } from './questionnaire-types';
import { valueSetCache } from './valueset-cache';
import type { CodeSystem, CodeSystemConcept } from './valueset-types';

export function validateQuestionnaireAnswerTypes(
    answers: QuestionnaireResponseAnswer[],
    question: QuestionnaireItem,
    basePath: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const expectedType = question.type;
    const hasOptions = Array.isArray(question.answerOption) && question.answerOption.length > 0;

    for (let i = 0; i < answers.length; i++) {
        const answer = answers[i];
        const path = `${basePath}[${i}]`;
        const actualType = getAnswerType(answer);

        if (!isTypeCompatible(actualType, expectedType)) {
            if (expectedType === 'choice' && actualType === 'string'
                && !hasOptions && !question.answerValueSet) {
                issues.push(createValidationIssue({
                    code: 'qr-type-mismatch',
                    path,
                    resourceType: 'QuestionnaireResponse',
                    customMessage: 'Cannot validate string answer option because no option list is provided',
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

        if (hasOptions) {
            issues.push(...validateAnswerOption(answer, question, actualType, path));
        }

        if (answer.valueCoding) {
            issues.push(...validateCodingDisplayMatch(answer, question, path));
            if (!hasOptions && question.answerValueSet) {
                issues.push(...validateCodingInAnswerValueSet(answer, question, path));
            }
        }

        issues.push(...validateAnswerContentConstraints(answer, question, path));
    }

    if (hasOptions && answers.length > 1) {
        issues.push(...validateExclusiveOptions(answers, question, basePath));
    }

    return issues;
}

function validateAnswerContentConstraints(
    answer: QuestionnaireResponseAnswer,
    question: QuestionnaireItem,
    answerPath: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const exts = (question as unknown as { extension?: Array<Record<string, unknown>> }).extension;
    if (!Array.isArray(exts) || exts.length === 0) return issues;

    if (answer.valueAttachment !== undefined) {
        issues.push(...validateAttachmentAnswer(answer.valueAttachment, exts, answerPath));
    }
    if (answer.valueQuantity !== undefined) {
        issues.push(...validateQuestionnaireQuantityAnswer(
            answer.valueQuantity as Record<string, unknown>,
            exts,
            `${answerPath}.value.ofType(Quantity)`,
        ));
    }

    return issues;
}

function validateAttachmentAnswer(
    attachment: Record<string, unknown>,
    extensions: Array<Record<string, unknown>>,
    answerPath: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const mimeUrl = 'http://hl7.org/fhir/StructureDefinition/mimeType';
    const maxSizeUrl = 'http://hl7.org/fhir/StructureDefinition/maxSize';

    const allowedMimes = extensions
        .filter(e => e?.url === mimeUrl && typeof e.valueCode === 'string')
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

    const maxSizeExt = extensions.find(e => e?.url === maxSizeUrl);
    const maxSize = typeof maxSizeExt?.valueDecimal === 'number'
        ? maxSizeExt.valueDecimal as number
        : (typeof maxSizeExt?.valueInteger === 'number' ? maxSizeExt.valueInteger as number : undefined);
    const actualSize = typeof attachment.size === 'number' ? attachment.size : undefined;
    if (typeof maxSize === 'number' && typeof actualSize === 'number' && actualSize > maxSize) {
        issues.push(createValidationIssue({
            code: 'required',
            path: answerPath,
            resourceType: 'QuestionnaireResponse',
            customMessage: `The attachment is too large (allowed = ${maxSize}, found = ${actualSize})`,
            severityOverride: 'error',
        }));
    }

    return issues;
}

function validateAnswerOption(
    answer: QuestionnaireResponseAnswer,
    question: QuestionnaireItem,
    answerType: string,
    answerPath: string,
): ValidationIssue[] {
    const options = question.answerOption!;

    if (question.type === 'open-choice' && answerType === 'string') return [];

    if (options.some(opt => optionMatchesAnswer(opt, answer))) return [];

    const desc = describeAnswerValue(answer, answerType);
    return [createValidationIssue({
        code: 'qr-invalid-option',
        path: answerPath,
        resourceType: 'QuestionnaireResponse',
        customMessage: `The ${desc.typeName} ${desc.displayValue} is not in the set of permitted values`,
        severityOverride: 'error',
    })];
}

function validateCodingDisplayMatch(
    answer: QuestionnaireResponseAnswer,
    question: QuestionnaireItem,
    answerPath: string,
): ValidationIssue[] {
    const coding = answer.valueCoding;
    if (!coding || !coding.code || !coding.display) return [];

    const expectedDisplay = resolveExpectedCodingDisplay(coding, question);
    if (expectedDisplay === null || expectedDisplay === coding.display) return [];

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

function resolveExpectedCodingDisplay(
    coding: { system?: string; code: string; display?: string },
    question: QuestionnaireItem,
): string | null {
    if (Array.isArray(question.answerOption)) {
        for (const opt of question.answerOption) {
            const optCoding = opt.valueCoding;
            if (!optCoding) continue;
            const systemsMatch = optCoding.system === coding.system || optCoding.system === undefined;
            if (systemsMatch && optCoding.code === coding.code && typeof optCoding.display === 'string') {
                return optCoding.display;
            }
        }
    }

    if (!coding.system) return null;
    const codeSystem = resolveCachedCodeSystem(coding.system);
    if (!codeSystem) return null;

    const concept = findCodeSystemConcept(codeSystem.concept, coding.code);
    return concept?.display ?? null;
}

function resolveCachedCodeSystem(systemUrl: string): CodeSystem | null {
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

function validateCodingInAnswerValueSet(
    answer: QuestionnaireResponseAnswer,
    question: QuestionnaireItem,
    answerPath: string,
): ValidationIssue[] {
    const coding = answer.valueCoding;
    if (!coding?.code || !question.answerValueSet) return [];

    const valueSetUrl = question.answerValueSet;
    const expanded = valueSetCache.getExpandedCodes(valueSetUrl)
        ?? valueSetCache.getExpandedCodes(valueSetUrl.split('|')[0]);

    let notInSet = false;
    if (expanded && expanded.size > 0) {
        const fullCode = coding.system ? `${coding.system}|${coding.code}` : coding.code;
        notInSet = !(expanded.has(fullCode) || expanded.has(coding.code));
    }

    let wrongDisplay = false;
    if (!notInSet && typeof coding.display === 'string') {
        const expected = resolveExpectedCodingDisplay(coding, question);
        wrongDisplay = expected !== null && expected !== coding.display;
    }

    if (!notInSet && !wrongDisplay) return [];

    const valueSetName = valueSetUrl.split('/').pop()?.replace(/[-_]/g, ' ') ?? valueSetUrl;
    const system = coding.system ?? '';
    return [createValidationIssue({
        code: 'qr-code-not-in-valueset',
        path: answerPath,
        resourceType: 'QuestionnaireResponse',
        customMessage:
            `The code '${coding.code}' in the system '${system}' is not in ` +
            `the options value set (${valueSetName}) specified by the questionnaire`,
        severityOverride: 'error',
    })];
}

function findCodeSystemConcept(
    concepts: CodeSystemConcept[] | undefined,
    code: string,
): CodeSystemConcept | null {
    if (!concepts) return null;
    for (const concept of concepts) {
        if (concept.code === code) return concept;
        const nested = findCodeSystemConcept(concept.concept, code);
        if (nested) return nested;
    }
    return null;
}

function optionMatchesAnswer(
    opt: AnswerOption,
    answer: QuestionnaireResponseAnswer,
): boolean {
    if (opt.valueCoding && answer.valueCoding) {
        return opt.valueCoding.system === answer.valueCoding.system
            && opt.valueCoding.code === answer.valueCoding.code;
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

function describeAnswerValue(
    answer: QuestionnaireResponseAnswer,
    answerType: string,
): { typeName: string; displayValue: string } {
    if (answer.valueCoding) {
        const system = answer.valueCoding.system || '';
        return { typeName: 'code', displayValue: `${system}::${answer.valueCoding.code}` };
    }
    if (answer.valueInteger !== undefined) return { typeName: 'integer', displayValue: String(answer.valueInteger) };
    if (answer.valueDate !== undefined) return { typeName: 'date', displayValue: answer.valueDate };
    if (answer.valueTime !== undefined) return { typeName: 'time', displayValue: answer.valueTime };
    if (answer.valueString !== undefined) return { typeName: 'string', displayValue: answer.valueString };
    if (answer.valueReference) return { typeName: 'reference', displayValue: answer.valueReference.reference };
    return { typeName: answerType, displayValue: '(unknown)' };
}

function validateExclusiveOptions(
    answers: QuestionnaireResponseAnswer[],
    question: QuestionnaireItem,
    basePath: string,
): ValidationIssue[] {
    const exclusiveUrl = 'http://hl7.org/fhir/StructureDefinition/questionnaire-optionExclusive';
    const issues: ValidationIssue[] = [];
    const options = question.answerOption!;

    for (let i = 0; i < answers.length; i++) {
        const answer = answers[i];
        const matchingOpt = options.find(opt => optionMatchesAnswer(opt, answer));
        if (!matchingOpt) continue;

        const isExclusive = matchingOpt.extension?.some(
            ext => ext.url === exclusiveUrl && ext.valueBoolean === true,
        );
        if (isExclusive) {
            const desc = describeAnswerValue(answer, getAnswerType(answer));
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

function getAnswerType(answer: QuestionnaireResponseAnswer): string {
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

function isTypeCompatible(answerType: string, questionType: string): boolean {
    if (answerType === questionType) return true;
    if (questionType === 'choice' && answerType === 'coding') return true;
    if (questionType === 'open-choice' && (answerType === 'coding' || answerType === 'string')) return true;
    if (questionType === 'text' && answerType === 'string') return true;
    return false;
}
