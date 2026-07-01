import type { ValidationIssue } from '../types';
import type { ValidationGraph, ValidationGraphNode } from './validation-graph-types';

export function validateReferenceTarget(
  value: unknown,
  node: ValidationGraphNode,
  graph: ValidationGraph,
): ValidationIssue | undefined {
  if (node.type !== 'Reference' || !node.refers?.length || !isRecord(value)) {
    return undefined;
  }

  const reference = value.reference;
  if (typeof reference !== 'string') {
    return undefined;
  }

  const allowedTargets = getAllowedReferenceTargetTypes(node);
  const actualTarget = extractReferenceTargetType(reference);
  if (!allowedTargets || !actualTarget || allowedTargets.has(actualTarget)) {
    return undefined;
  }

  return {
    aspect: 'profile',
    severity: 'error',
    code: 'reference-target-type-invalid',
    path: node.path,
    expression: node.path,
    message: `Reference at '${node.path}' points at ${actualTarget} but allowed targets are ${Array.from(allowedTargets).sort().join(', ')}`,
    resourceType: graph.type,
    profile: graph.url,
    validationMethod: 'fhir-schema-graph',
    timestamp: new Date(),
  };
}

function getAllowedReferenceTargetTypes(node: ValidationGraphNode): Set<string> | null {
  if (node.referenceTargetTypes?.length) {
    return new Set(node.referenceTargetTypes);
  }
  return getCoreReferenceTargetTypes(node.refers ?? []);
}

function getCoreReferenceTargetTypes(refers: string[]): Set<string> | null {
  const allowed = new Set<string>();
  for (const canonical of refers) {
    const target = coreReferenceTargetType(canonical);
    if (target === null) {
      return null;
    }
    allowed.add(target);
  }
  return allowed.size > 0 ? allowed : null;
}

function coreReferenceTargetType(canonical: string): string | null {
  const stripped = canonical.split('|')[0];
  if (
    stripped === 'http://hl7.org/fhir/StructureDefinition/Resource' ||
    stripped === 'http://hl7.org/fhir/StructureDefinition/DomainResource'
  ) {
    return null;
  }

  const match = stripped.match(/^http:\/\/hl7\.org\/fhir\/StructureDefinition\/([A-Z][A-Za-z]+)$/);
  return match?.[1] ?? null;
}

function extractReferenceTargetType(reference: string): string | null {
  const relative = reference.match(/^([A-Z][A-Za-z]+)\/[A-Za-z0-9\-.]+(?:\/_history\/[A-Za-z0-9\-.]+)?$/);
  if (relative) {
    return relative[1];
  }

  const absolute = reference.match(/^https?:\/\/[^\s]+\/([A-Z][A-Za-z]+)\/[A-Za-z0-9\-.]+(?:\/_history\/[A-Za-z0-9\-.]+)?$/);
  return absolute?.[1] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
