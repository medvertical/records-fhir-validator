/**
 * Supplemental required-binding presence checks.
 *
 * ValueSet membership belongs to TerminologyExecutor. This validator checks
 * that present values at required binding paths contain a usable code.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import type {
    ElementDefinition,
    StructureDefinition,
} from '../core/structure-definition-types.js';
import { getValidationTargets } from '../business-rules/index.js';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';

type FhirRecord = Record<string, unknown>;

interface RequiredBindingElement {
    path: string;
    valueSet?: string;
    typeCodes: string[];
}

export interface DeepBindingContext {
    resource: unknown;
    resourceType: string;
    structureDef?: StructureDefinition;
}

export class DeepBindingValidator {
    validate(context: DeepBindingContext): ValidationIssue[] {
        const resourceType = getResourceType(context.resource, context.resourceType);
        if (!isRecord(context.resource) || !context.structureDef) return [];

        const bindings = getRequiredBindingElements(context.structureDef);
        logger.debug(
            `[DeepBindingValidator] Checking ${bindings.length} required bindings for ${resourceType}`,
        );

        const issues: ValidationIssue[] = [];
        for (const binding of bindings) {
            const targets = getValidationTargets(context.resource, binding.path)
                .filter(target => target.value !== null && target.value !== undefined);
            for (const target of targets) {
                const codeIssue = validatePresentBindingValue(
                    target.value,
                    target.fullPath,
                    binding,
                    resourceType,
                );
                if (codeIssue) issues.push(codeIssue);
            }
        }
        return issues;
    }
}

function getRequiredBindingElements(
    structureDef: StructureDefinition,
): RequiredBindingElement[] {
    const elements = Array.isArray(structureDef.snapshot?.element)
        ? structureDef.snapshot.element
        : [];
    const bindings: RequiredBindingElement[] = [];
    const seenPaths = new Set<string>();

    for (const candidate of elements) {
        const element = toElementDefinition(candidate);
        if (
            !element
            || isSliceScopedElement(element)
            || element.binding?.strength !== 'required'
            || seenPaths.has(element.path)
        ) continue;

        seenPaths.add(element.path);
        bindings.push({
            path: element.path,
            valueSet: typeof element.binding.valueSet === 'string'
                ? element.binding.valueSet
                : undefined,
            typeCodes: getTypeCodes(element),
        });
    }
    return bindings;
}

function validatePresentBindingValue(
    value: unknown,
    path: string,
    binding: RequiredBindingElement,
    resourceType: string,
): ValidationIssue | null {
    const record = isRecord(value) ? value : undefined;
    const targetTypeCodes = resolveTargetTypeCodes(binding, path);
    const isCodeableConcept =
        targetTypeCodes.includes('CodeableConcept')
        || Array.isArray(record?.coding);
    if (isCodeableConcept) {
        const codings = Array.isArray(record?.coding) ? record.coding : [];
        const hasCode = codings.some(coding => {
            const codingRecord = isRecord(coding) ? coding : undefined;
            return isNonEmptyString(codingRecord?.code);
        });
        return hasCode
            ? null
            : createMissingCodeIssue(
                'deep-binding-no-valid-coding',
                path,
                binding,
                resourceType,
                'No valid coding found',
            );
    }

    const isCoding =
        targetTypeCodes.includes('Coding')
        || record?.system !== undefined
        || record?.code !== undefined;
    if (isCoding) {
        return isNonEmptyString(record?.code)
            ? null
            : createMissingCodeIssue(
                'deep-binding-empty-code',
                path,
                binding,
                resourceType,
                'Code is empty or missing',
            );
    }

    if (targetTypeCodes.includes('code') && value === '') {
        return createMissingCodeIssue(
            'deep-binding-empty-code',
            path,
            binding,
            resourceType,
            'Code is empty',
        );
    }

    return null;
}

function resolveTargetTypeCodes(
    binding: RequiredBindingElement,
    targetPath: string,
): string[] {
    const choiceSegment = binding.path.split('.').at(-1);
    if (!choiceSegment?.endsWith('[x]')) return binding.typeCodes;

    const choiceBase = choiceSegment.slice(0, -3);
    const targetSegment = targetPath.replace(/\[\d+\]/g, '').split('.').at(-1);
    if (!targetSegment?.startsWith(choiceBase)) return binding.typeCodes;

    const selectedSuffix = targetSegment.slice(choiceBase.length);
    const selectedType = binding.typeCodes.find(typeCode =>
        `${typeCode.charAt(0).toUpperCase()}${typeCode.slice(1)}` === selectedSuffix
    );
    return selectedType ? [selectedType] : binding.typeCodes;
}

function createMissingCodeIssue(
    code: string,
    path: string,
    binding: RequiredBindingElement,
    resourceType: string,
    reason: string,
): ValidationIssue {
    const valueSet = binding.valueSet ?? '(declared ValueSet)';
    return createValidationIssue({
        code,
        path,
        resourceType,
        customMessage: `Required binding ${valueSet}: ${reason}`,
        severityOverride: 'error',
        details: {
            bindingStrength: 'required',
            valueSet: binding.valueSet,
        },
    });
}

function isSliceScopedElement(element: ElementDefinition): boolean {
    return typeof element.sliceName === 'string'
        || (typeof element.id === 'string' && element.id.includes(':'));
}

function getTypeCodes(element: ElementDefinition): string[] {
    if (!Array.isArray(element.type)) return [];
    return element.type.flatMap(candidate => {
        const record = isRecord(candidate) ? candidate : undefined;
        return typeof record?.code === 'string' ? [record.code] : [];
    });
}

function toElementDefinition(value: unknown): ElementDefinition | undefined {
    return isRecord(value)
        && typeof value.path === 'string'
        && value.path.length > 0
        ? value as ElementDefinition
        : undefined;
}

function getResourceType(resource: unknown, fallback: string): string {
    const resourceType = isRecord(resource) ? resource.resourceType : undefined;
    if (isNonEmptyString(resourceType)) return resourceType;
    return fallback.length > 0 ? fallback : 'Resource';
}

function isRecord(value: unknown): value is FhirRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

export const deepBindingValidator = new DeepBindingValidator();
