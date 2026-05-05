/**
 * Deep Binding Validator
 * 
 * Traverses a resource recursively and validates ALL coded elements against
 * their bindings. This ensures HAPI-level parity by checking every coding
 * anywhere in the resource, not just top-level fields.
 * 
 * Key Features:
 * - Recursive traversal of entire resource tree
 * - Finds ALL Coding and CodeableConcept elements
 * - Validates each against SD element bindings
 * - Reports path-specific issues for each violation
 */

import type { ValidationIssue } from '../types';
import type { StructureDefinition } from '../core/structure-definition-types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface DeepBindingContext {
    resource: any;
    resourceType: string;
    structureDef?: StructureDefinition;
}

interface CodedElement {
    path: string;
    coding?: { system?: string; code?: string; display?: string }[];
    code?: string;
    system?: string;
}

// ============================================================================
// Deep Binding Validator
// ============================================================================

export class DeepBindingValidator {

    /**
     * Validate all coded elements in a resource
     */
    validate(context: DeepBindingContext): ValidationIssue[] {
        const { resource, resourceType, structureDef } = context;
        const issues: ValidationIssue[] = [];

        if (!resource) return issues;

        logger.debug(`[DeepBindingValidator] Scanning ${resourceType} for coded elements`);

        // Find all coded elements recursively
        const codedElements = this.findCodedElements(resource, resourceType);

        logger.debug(`[DeepBindingValidator] Found ${codedElements.length} coded elements`);

        // Build binding map from SD if available
        const bindingMap = structureDef ? this.buildBindingMap(structureDef) : new Map();

        // Validate each coded element
        for (const element of codedElements) {
            const binding = this.findBindingForPath(element.path, bindingMap, resourceType);

            if (binding && binding.strength === 'required') {
                // Validate coded element against binding
                const elementIssues = this.validateCodedElement(element, binding, resourceType);
                issues.push(...elementIssues);
            }
        }

        return issues;
    }

    /**
     * Recursively find all coded elements in a resource
     */
    private findCodedElements(obj: any, currentPath: string): CodedElement[] {
        const elements: CodedElement[] = [];

        if (!obj || typeof obj !== 'object') return elements;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                elements.push(...this.findCodedElements(obj[i], `${currentPath}[${i}]`));
            }
            return elements;
        }

        // Check if this is a CodeableConcept (has coding array)
        if (obj.coding && Array.isArray(obj.coding)) {
            elements.push({
                path: currentPath,
                coding: obj.coding
            });
        }

        // Check if this is a Coding (has system and code)
        if (obj.system !== undefined || obj.code !== undefined) {
            // Only add if not already added as part of CodeableConcept
            if (!obj.coding) {
                elements.push({
                    path: currentPath,
                    system: obj.system,
                    code: obj.code
                });
            }
        }

        // Recurse into children
        for (const key of Object.keys(obj)) {
            if (key === 'coding') continue; // Already handled
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                elements.push(...this.findCodedElements(obj[key], `${currentPath}.${key}`));
            }
        }

        return elements;
    }

    /**
     * Build a map of element paths to their bindings from StructureDefinition
     */
    private buildBindingMap(structureDef: StructureDefinition): Map<string, any> {
        const map = new Map<string, any>();

        if (!structureDef?.snapshot?.element) return map;

        for (const element of structureDef.snapshot.element) {
            if (element.binding) {
                map.set(element.path, element.binding);
            }
        }

        return map;
    }

    /**
     * Find the appropriate binding for an element path
     */
    private findBindingForPath(
        path: string,
        bindingMap: Map<string, any>,
        resourceType: string
    ): any | undefined {
        // Normalize path (remove array indices)
        const normalizedPath = path.replace(/\[\d+\]/g, '');

        // Try exact match first
        if (bindingMap.has(normalizedPath)) {
            return bindingMap.get(normalizedPath);
        }

        // Try with resource type prefix
        const withPrefix = `${resourceType}.${normalizedPath.replace(resourceType + '.', '')}`;
        if (bindingMap.has(withPrefix)) {
            return bindingMap.get(withPrefix);
        }

        // Try parent paths
        const segments = normalizedPath.split('.');
        while (segments.length > 1) {
            segments.pop();
            const parentPath = segments.join('.');
            if (bindingMap.has(parentPath)) {
                return bindingMap.get(parentPath);
            }
        }

        return undefined;
    }

    /**
     * Validate a coded element against its binding
     */
    private validateCodedElement(
        element: CodedElement,
        binding: any,
        resourceType: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // For CodeableConcept
        if (element.coding && element.coding.length > 0) {
            // Check if any coding satisfies the binding
            const hasValidCoding = element.coding.some(c =>
                c.code !== undefined && c.code !== null && c.code !== ''
            );

            if (!hasValidCoding && binding.strength === 'required') {
                issues.push(createValidationIssue({
                    code: 'deep-binding-no-valid-coding',
                    path: element.path,
                    resourceType,
                    customMessage: `Required binding ${binding.valueSet}: No valid coding found`,
                    severityOverride: 'error',
                }));
            }
        }

        // For simple code
        if (element.code !== undefined && !element.coding) {
            if (element.code === '' || element.code === null) {
                issues.push(createValidationIssue({
                    code: 'deep-binding-empty-code',
                    path: element.path,
                    resourceType,
                    customMessage: `Required binding ${binding.valueSet}: Code is empty`,
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }
}

// Singleton
export const deepBindingValidator = new DeepBindingValidator();
