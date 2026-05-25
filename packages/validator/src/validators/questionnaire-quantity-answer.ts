import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

export function validateQuestionnaireQuantityAnswer(
    quantity: Record<string, unknown>,
    extensions: Array<Record<string, unknown>>,
    answerPath: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const unitOptionUrl = 'http://hl7.org/fhir/StructureDefinition/questionnaire-unitOption';
    const minQuantityUrl = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-minQuantity';
    const maxQuantityUrl = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-maxQuantity';

    const unitOptions = extensions
        .filter(e => e?.url === unitOptionUrl)
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
                    `The value ${formatQuantityForMessage(quantity)} has a unit ` +
                    `that is not valid (allowed = ${allowed})`,
                severityOverride: 'error',
            }));
        }
    }

    for (const ext of extensions) {
        if (ext?.url !== minQuantityUrl && ext?.url !== maxQuantityUrl) continue;
        const bound = ext.valueQuantity as Record<string, unknown> | undefined;
        if (!bound) continue;
        issues.push(...compareQuantityBound(quantity, bound, ext.url === minQuantityUrl, answerPath));
    }

    return issues;
}

function formatQuantityForMessage(q: Record<string, unknown>): string {
    const value = q.value;
    const unit = q.unit ?? '';
    const code = q.code as string | undefined;
    const base = `${value} ${unit}`.trimEnd();
    return code ? `${base} (UCUM#${code})` : base;
}

function compareQuantityBound(
    actual: Record<string, unknown>,
    bound: Record<string, unknown>,
    isMin: boolean,
    answerPath: string,
): ValidationIssue[] {
    const label = isMin ? 'minimum' : 'maximum';
    const actualHasUcum = !!(actual.system && actual.code);
    const boundHasUcum = !!(bound.system && bound.code);

    if (!actualHasUcum || !boundHasUcum) {
        return [createValidationIssue({
            code: 'invariant',
            path: answerPath,
            resourceType: 'QuestionnaireResponse',
            customMessage:
                `The quantity ${formatQuantityForMessage(actual)} cannot be compared to the ` +
                `allowed ${label} of ${formatQuantityForMessage(bound)} ` +
                'because no formal units are specified',
            severityOverride: 'error',
        })];
    }

    const actualValue = typeof actual.value === 'number' ? actual.value : Number(actual.value);
    const boundValue = typeof bound.value === 'number' ? bound.value : Number(bound.value);
    if (!Number.isFinite(actualValue) || !Number.isFinite(boundValue)) return [];

    const converted = convertUcumValue(actualValue, actual.code as string, bound.code as string);
    if (converted === null) {
        return [createValidationIssue({
            code: 'invariant',
            path: answerPath,
            resourceType: 'QuestionnaireResponse',
            customMessage:
                `The quantity ${formatQuantityForMessage(actual)} cannot be compared to the ` +
                `allowed ${label} of ${formatQuantityForMessage(bound)}`,
            severityOverride: 'error',
        })];
    }

    const violates = isMin ? converted < boundValue : converted > boundValue;
    if (!violates) return [];

    const cmp = isMin ? 'less than' : 'greater than';
    return [createValidationIssue({
        code: 'invariant',
        path: answerPath,
        resourceType: 'QuestionnaireResponse',
        customMessage:
            `The quantity ${formatQuantityForMessage(actual)} is ${cmp} the ` +
            `allowed ${label} of ${formatQuantityForMessage(bound)}`,
        severityOverride: 'error',
    })];
}

function convertUcumValue(value: number, fromCode: string, toCode: string): number | null {
    if (fromCode === toCode) return value;
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
        const from = units[fromCode];
        const to = units[toCode];
        if (from !== undefined && to !== undefined) {
            return (value * from) / to;
        }
    }
    return null;
}
