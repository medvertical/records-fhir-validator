import { createValidationGraphIssue as createIssue } from './validation-graph-issues.js';
import { patternStrictlyContains } from './validation-graph-pattern-containment.js';
import {
  isSliceMatchableByValue,
  matchesSliceForParent,
  shouldReportUnmatchableRequiredSlice,
} from './validation-graph-slice-matching.js';
import {
  matchResolvedSlice,
  usesTargetDependentDiscriminator,
  type GraphReferenceResolver,
} from './validation-graph-resolved-slices.js';
import type { ValidationGraph, ValidationGraphNode } from './validation-graph-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

/** Recurses into a slice's own children; supplied by the executor to avoid a cycle. */
export type ValidateNodeForParents = (
  parentValues: unknown[],
  node: ValidationGraphNode,
  graph: ValidationGraph,
  issues: ValidationIssue[],
  ancestors: Set<ValidationGraphNode>,
  resolveReference: GraphReferenceResolver | undefined,
) => void;

export function validateSliceChildren(
  values: unknown[],
  parentNode: ValidationGraphNode,
  sliceNodes: ValidationGraphNode[],
  graph: ValidationGraph,
  issues: ValidationIssue[],
  ancestors: Set<ValidationGraphNode>,
  resolveReference: GraphReferenceResolver | undefined,
  validateNodeForParents: ValidateNodeForParents,
): void {
  if (usesTargetDependentDiscriminator(parentNode)) {
    validateTargetDependentSlices(values, parentNode, sliceNodes, graph, issues, resolveReference);
    return;
  }
  const enforceableSlices = sliceNodes.filter(slice => isSliceMatchableByValue(parentNode, slice));
  const unmatchableRequiredSlices = sliceNodes.filter(slice =>
    !enforceableSlices.includes(slice) &&
    shouldReportUnmatchableRequiredSlice(parentNode, slice)
  );
  if (enforceableSlices.length === 0 && unmatchableRequiredSlices.length === 0) {
    return;
  }

  const matchCounts = new Map<ValidationGraphNode, number>();
  const allowedSlices = enforceableSlices.filter(slice => slice.max !== 0);
  for (const slice of enforceableSlices) {
    const matchedValues = values.filter(value =>
      matchesSliceForParent(value, parentNode, slice) &&
      !isShadowedForbiddenSliceMatch(value, parentNode, slice, allowedSlices)
    );
    matchCounts.set(slice, matchedValues.length);
    for (const child of slice.children ?? []) {
      if (child.sliceName) {
        continue;
      }
      validateNodeForParents(matchedValues, child, graph, issues, ancestors, resolveReference);
    }
  }

  for (const slice of [...enforceableSlices, ...unmatchableRequiredSlices]) {
    const count = matchCounts.get(slice) ?? 0;
    const min = slice.min ?? 0;
    if (min > 0 && count < min) {
      issues.push(createIssue(
        'profile-slice-min-cardinality',
        parentNode.path,
        `Slice '${slice.path}' has ${count} matches, minimum is ${min}`,
        graph,
      ));
    }

    if (slice.max !== undefined && slice.max !== '*') {
      const max = Number(slice.max);
      if (Number.isFinite(max) && count > max) {
        issues.push(createIssue(
          'profile-slice-max-cardinality',
          parentNode.path,
          `Slice '${slice.path}' has ${count} matches, maximum is ${max}`,
          graph,
        ));
      }
    }
  }

  if (parentNode.slicing?.rules !== 'closed') {
    return;
  }

  for (const value of values) {
    const hasAllowedMatch = allowedSlices.some(slice => matchesSliceForParent(value, parentNode, slice));
    if (!hasAllowedMatch) {
      issues.push(createIssue(
        'profile-pattern-mismatch',
        parentNode.path,
        `Element '${parentNode.path}' does not match any allowed slice`,
        graph,
      ));
    }
  }
}

/**
 * Counts slice membership by dereferencing instead of declaring every
 * resolve()-discriminated required slice unmatchable. A single unresolvable
 * target makes the whole slicing unverifiable, so nothing is reported: missing
 * evidence must not become a finding.
 */
function validateTargetDependentSlices(
  values: unknown[],
  parentNode: ValidationGraphNode,
  sliceNodes: ValidationGraphNode[],
  graph: ValidationGraph,
  issues: ValidationIssue[],
  resolveReference: GraphReferenceResolver | undefined,
): void {
  const matchCounts = new Map<ValidationGraphNode, number>();
  const unmatchedValues = new Set<unknown>(values);

  for (const slice of sliceNodes) {
    let count = 0;
    for (const value of values) {
      const match = matchResolvedSlice(value, slice, resolveReference);
      if (match === 'unresolved') return;
      if (match !== 'match') continue;
      count += 1;
      if (slice.max !== 0) unmatchedValues.delete(value);
    }
    matchCounts.set(slice, count);
  }

  for (const slice of sliceNodes) {
    const count = matchCounts.get(slice) ?? 0;
    issues.push(...sliceCardinalityIssues(slice, parentNode, count, graph));
  }

  if (parentNode.slicing?.rules !== 'closed') return;
  for (let index = 0; index < unmatchedValues.size; index++) {
    issues.push(createIssue(
      'profile-pattern-mismatch',
      parentNode.path,
      `Element '${parentNode.path}' does not match any allowed slice`,
      graph,
    ));
  }
}

function sliceCardinalityIssues(
  slice: ValidationGraphNode,
  parentNode: ValidationGraphNode,
  count: number,
  graph: ValidationGraph,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const min = slice.min ?? 0;
  if (min > 0 && count < min) {
    issues.push(createIssue(
      'profile-slice-min-cardinality',
      parentNode.path,
      `Slice '${slice.path}' has ${count} matches, minimum is ${min}`,
      graph,
    ));
  }
  if (slice.max !== undefined && slice.max !== '*') {
    const max = Number(slice.max);
    if (Number.isFinite(max) && count > max) {
      issues.push(createIssue(
        'profile-slice-max-cardinality',
        parentNode.path,
        `Slice '${slice.path}' has ${count} matches, maximum is ${max}`,
        graph,
      ));
    }
  }
  return issues;
}

function isShadowedForbiddenSliceMatch(
  value: unknown,
  parentNode: ValidationGraphNode,
  slice: ValidationGraphNode,
  allowedSlices: ValidationGraphNode[],
): boolean {
  if (slice.max !== 0 || slice.pattern === undefined) {
    return false;
  }

  return allowedSlices.some(allowedSlice =>
    allowedSlice.pattern !== undefined &&
    patternStrictlyContains(allowedSlice.pattern, slice.pattern) &&
    matchesSliceForParent(value, parentNode, allowedSlice)
  );
}
