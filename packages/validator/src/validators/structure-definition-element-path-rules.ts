import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { CHOICE_TYPE_BASES, VALID_CHOICE_TYPE_SUFFIXES } from './sd-wg-mappings.js';

export function validateStructureDefinitionElementNames(
  sd: StructureDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const elements = getDifferentialElements(sd);
  for (let index = 0; index < elements.length; index++) {
    const path = elements[index].path;
    if (typeof path !== 'string' || !path) continue;
    const parts = path.split('.');
    let eld19 = path.includes('..');
    let eld20 = false;
    for (const part of parts) {
      if (!part || part === '[x]' || part.endsWith('[x]')) continue;
      if (!eld19 && /[^a-zA-Z0-9_[\]]/.test(part)) eld19 = true;
      const clean = part.replace(/\[x\]$/, '');
      if (clean && !/^[A-Za-z0-9_]{1,64}$/.test(clean)) eld20 = true;
    }
    if (eld19) issues.push(createElementNameIssue('sd-eld-19-element-name', index, 'error'));
    if (eld20) issues.push(createElementNameIssue('sd-eld-20-element-name', index, 'warning'));
  }
  return issues;
}

export function validateStructureDefinitionDifferentialPaths(
  sd: StructureDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const baseType = sd.type;
  if (typeof baseType !== 'string' || !baseType) return issues;
  const knownChoicePaths = collectKnownChoicePaths(sd, baseType);

  for (const element of getDifferentialElements(sd)) {
    if (typeof element.path !== 'string' || !element.path) continue;
    if (element.path.includes('..')) {
      issues.push(createValidationIssue({
        code: 'sd-snapshot-error-bad-path',
        path: 'StructureDefinition',
        resourceType: 'StructureDefinition',
        customMessage:
          `Error generating Snapshot: Invalid path '${element.path}' in differential` +
          ` in ${sd.url || 'unknown'}: name portion missing ('..') ` +
          `(this usually arises from a problem in the differential)`,
        severityOverride: 'error',
      }));
    }
    if (!element.path.startsWith(`${baseType}.`)) continue;
    const subPath = element.path.slice(baseType.length + 1);
    if (subPath.includes('.')) continue;
    for (const base of CHOICE_TYPE_BASES) {
      if (!knownChoicePaths.has(`${baseType}.${base}[x]`)) continue;
      if (!subPath.startsWith(base) || subPath === base || subPath === `${base}[x]`) continue;
      const suffix = subPath.slice(base.length);
      if (suffix && !VALID_CHOICE_TYPE_SUFFIXES.has(suffix)) {
        issues.push(createValidationIssue({
          code: 'sd-snapshot-error-bad-choice',
          path: 'StructureDefinition',
          resourceType: 'StructureDefinition',
          customMessage:
            `Error generating Snapshot: The path must be '${baseType}.${base}[x]' ` +
            `not '${element.path}' when the type list is not constrained ` +
            `(this usually arises from a problem in the differential)`,
          severityOverride: 'error',
        }));
      }
    }
  }
  return issues;
}

function createElementNameIssue(
  code: 'sd-eld-19-element-name' | 'sd-eld-20-element-name',
  index: number,
  severity: 'error' | 'warning',
): ValidationIssue {
  const message = code === 'sd-eld-19-element-name'
    ? `Constraint failed: eld-19: 'Element names cannot include some special characters'`
    : `Constraint failed: eld-20: 'Element names should be simple alphanumerics with a max of 64 characters, or code generation tools may be broken'`;
  return createValidationIssue({
    code,
    path: `StructureDefinition.differential.element[${index}]`,
    resourceType: 'StructureDefinition',
    customMessage: message,
    severityOverride: severity,
  });
}

function collectKnownChoicePaths(sd: StructureDefinition, baseType: string): Set<string> {
  const paths = new Set<string>();
  for (const element of [...getElementArray(sd.snapshot), ...getElementArray(sd.differential)]) {
    if (typeof element.path === 'string' && element.path.includes('[x]')) paths.add(element.path);
  }
  if (baseType === 'Extension') paths.add('Extension.value[x]');
  if (baseType === 'Observation') paths.add('Observation.value[x]');
  return paths;
}

function getDifferentialElements(sd: StructureDefinition): ElementDefinition[] {
  return getElementArray(sd.differential);
}

function getElementArray(section: unknown): ElementDefinition[] {
  if (!isRecord(section) || !Array.isArray(section.element)) return [];
  return section.element.filter(isRecord) as ElementDefinition[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
