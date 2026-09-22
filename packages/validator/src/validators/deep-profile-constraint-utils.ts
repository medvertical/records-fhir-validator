import type { Binding, ElementDefinition } from '../core/structure-definition-types.js';
import { constraintTypeMatchesElement } from './element-constraint-type.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUsableCoding(value: unknown): boolean {
    return isRecord(value) &&
        typeof value.system === 'string' &&
        value.system.length > 0 &&
        typeof value.code === 'string' &&
        value.code.length > 0;
}

export function extractFixedConstraint(
    elementDef: ElementDefinition,
): { key: string; value: unknown } | undefined {
    const key = Object.keys(elementDef).find(candidate =>
        candidate.startsWith('fixed') && constraintTypeMatchesElement(elementDef, candidate)
    );
    return key
        ? { key, value: elementDef[key] }
        : undefined;
}

export function extractPatternValue(elementDef: ElementDefinition): unknown {
    const key = Object.keys(elementDef).find(candidate =>
        candidate.startsWith('pattern') && constraintTypeMatchesElement(elementDef, candidate)
    );
    return key
        ? elementDef[key]
        : undefined;
}

function extractNumericConstraint(
    elementDef: ElementDefinition,
    prefix: 'minValue' | 'maxValue',
): number | undefined {
    const key = Object.keys(elementDef).find(candidate => candidate.startsWith(prefix));
    const value = key
        ? elementDef[key]
        : undefined;
    return typeof value === 'number' ? value : undefined;
}

export const extractMinValue = (elementDef: ElementDefinition): number | undefined =>
    extractNumericConstraint(elementDef, 'minValue');

export const extractMaxValue = (elementDef: ElementDefinition): number | undefined =>
    extractNumericConstraint(elementDef, 'maxValue');

export function hasRequiredBindingValue(value: unknown): boolean {
    if (isRecord(value)) {
        if (Array.isArray(value.coding) && value.coding.some(isUsableCoding)) return true;
        if (isUsableCoding(value)) return true;
    }
    return typeof value === 'string' && value.length > 0;
}

export function buildRequiredBindingDetails(
    value: unknown,
    binding: Binding,
): Record<string, unknown> {
    const valueSet = binding.valueSet;
    const details: Record<string, unknown> = valueSet ? { valueSet } : {};
    if (isRecord(value)) {
        if (typeof value.text === 'string' && value.text.trim().length > 0) {
            details.textValue = value.text;
            details.fixHint = valueSet
                ? `Replace text-only CodeableConcept '${value.text}' with a Coding from required ValueSet '${valueSet}'.`
                : `Replace text-only CodeableConcept '${value.text}' with a coded value from the required binding.`;
        } else {
            details.fixHint = valueSet
                ? `Add a Coding from required ValueSet '${valueSet}'.`
                : `Add a Coding from the required binding.`;
        }
        if (Array.isArray(value.coding)) details.codingCount = value.coding.length;
        return details;
    }
    if (typeof value === 'string') details.value = value;
    details.fixHint = valueSet
        ? `Use a code from required ValueSet '${valueSet}'.`
        : `Use a code from the required binding.`;
    return details;
}

export function formatProfileIssueValue(value: unknown): string {
    let raw: string | undefined;
    try {
        raw = typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
        raw = '[unserializable value]';
    }
    if (raw === undefined) return 'undefined';
    return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

export function describePatternMismatch(
    path: string,
    actualValue: unknown,
    expectedPattern: unknown,
): { message: string; details: Record<string, unknown> } {
    const expected = formatProfileIssueValue(expectedPattern);
    const actual = formatProfileIssueValue(actualValue);
    return {
        message: `Element ${path} does not match required pattern: expected ${expected}, found ${actual}`,
        details: { expectedPattern: expected, actualValue: actual },
    };
}
