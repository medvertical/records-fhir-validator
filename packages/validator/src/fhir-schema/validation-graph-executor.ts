import type { ValidationIssue } from '@records-fhir/validation-types';
import { matchPatternWithDiagnostic } from './validation-graph-pattern-diagnostics.js';
import { getDirectValues, getParentValues, isChoiceProperty } from './validation-graph-path-values.js';
import { validateReferenceTarget } from './validation-graph-reference-targets.js';
import type { GraphReferenceResolver } from './validation-graph-resolved-slices.js';
import { validateSliceChildren } from './validation-graph-slice-execution.js';
import type { ValidationGraph, ValidationGraphNode } from './validation-graph-types.js';
import { graphValuesMatch } from './validation-graph-value-matching.js';
import { createValidationGraphIssue as createIssue, isGraphRecord as isRecord } from './validation-graph-issues.js';

export interface ValidateResourceWithGraphOptions {
  /**
   * Resolves reference targets for slice discriminators that depend on them.
   * Without it such slicing stays unverifiable instead of being declared missing.
   */
  resolveReference?: GraphReferenceResolver;
}

export function validateResourceWithGraph(
  resource: unknown,
  graph: ValidationGraph,
  options: ValidateResourceWithGraphOptions = {},
): ValidationIssue[] {
  if (!isRecord(resource)) {
    return [createIssue('structural-invalid-resource', graph.type, 'Resource must be a JSON object')];
  }

  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    validateNode(resource, node, graph, issues, new Set(), options.resolveReference);
  }
  return issues;
}

function validateNode(
  resource: Record<string, unknown>,
  node: ValidationGraphNode,
  graph: ValidationGraph,
  issues: ValidationIssue[],
  ancestors: Set<ValidationGraphNode>,
  resolveReference: GraphReferenceResolver | undefined,
): void {
  if (node.sliceName) {
    return;
  }

  const parentValues = getParentValues(resource, node);
  validateNodeForParents(parentValues, node, graph, issues, ancestors, resolveReference);
}

function validateNodeForParents(
  parentValues: unknown[],
  node: ValidationGraphNode,
  graph: ValidationGraph,
  issues: ValidationIssue[],
  ancestors: Set<ValidationGraphNode>,
  resolveReference: GraphReferenceResolver | undefined,
): void {
  if (parentValues.length === 0) {
    return;
  }
  if (ancestors.has(node)) {
    issues.push(createIssue(
      'structural-validation-graph-cycle',
      node.path,
      `Validation graph contains a cycle at '${node.path}'`,
      graph,
    ));
    return;
  }
  ancestors.add(node);
  const values = parentValues.flatMap(parent => getDirectValues(parent, node.name));
  const required = node.required || (node.min ?? 0) > 0;

  if (node.type === 'choice' || node.choices?.length) {
    validateChoiceNode(parentValues, node, graph, issues, ancestors, resolveReference);
  } else if (required) {
    const min = node.min ?? 1;
    for (const parent of parentValues) {
      const count = getDirectValues(parent, node.name).length;
      if (count < min) {
        issues.push(createIssue(
          'structural-required-element-missing',
          node.path,
          count === 0
            ? `Required element '${node.path}' is missing`
            : `Element '${node.path}' occurs ${count} times, minimum is ${min}`,
          graph,
        ));
      }
    }
  }

  if (node.max !== undefined && node.max !== '*') {
    const max = Number(node.max);
    if (Number.isFinite(max)) {
      for (const parent of parentValues) {
        const count = node.type === 'choice' || node.choices?.length
          ? getChoiceEntries(parent, node).length
          : getDirectValues(parent, node.name).length;
        if (count > max) {
          issues.push(createIssue(
            'structural-cardinality-max',
            node.path,
            `Element '${node.path}' occurs ${count} times, maximum is ${max}`,
            graph,
          ));
        }
      }
    }
  }

  for (const value of values) {
    if (node.fixed !== undefined && !graphValuesMatch(value, node.fixed)) {
      issues.push(createIssue(
        'profile-fixed-value-mismatch',
        node.path,
        `Element '${node.path}' does not match fixed value`,
        graph,
      ));
    }
    if (node.pattern !== undefined) {
      const pattern = matchPatternWithDiagnostic(value, node.pattern, node.path);
      if (!pattern.matches) {
        issues.push(createIssue(
          'profile-pattern-mismatch',
          pattern.path ?? node.path,
          pattern.message ?? `Element '${node.path}' does not match pattern`,
          graph,
        ));
      }
    }

    const referenceIssue = validateReferenceTarget(value, node, graph);
    if (referenceIssue) issues.push(referenceIssue);
  }

  const children = node.children ?? [];
  const sliceChildren = children.filter(child => child.sliceName);
  if (sliceChildren.length > 0 && node.type !== 'choice' && !node.choices?.length) {
    validateSliceChildren(
      values, node, sliceChildren, graph, issues, ancestors, resolveReference, validateNodeForParents,
    );
  }

  for (const child of children) {
    if (child.sliceName) {
      continue;
    }
    validateNodeForParents(values, child, graph, issues, ancestors, resolveReference);
  }
  ancestors.delete(node);
}


function validateChoiceNode(
  parentValues: unknown[],
  node: ValidationGraphNode,
  graph: ValidationGraph,
  issues: ValidationIssue[],
  ancestors: Set<ValidationGraphNode>,
  resolveReference: GraphReferenceResolver | undefined,
): void {
  const required = node.required || (node.min ?? 0) > 0;

  for (const parent of parentValues) {
    const presentEntries = getChoiceEntries(parent, node);
    const present = Array.from(new Set(presentEntries.map(entry => entry.name)));

    if (required && present.length === 0) {
      issues.push(createIssue(
        'structural-required-element-missing',
        node.path,
        `Required choice element '${node.path}' is missing`,
        graph,
      ));
    }

    if (present.length > 1) {
      issues.push(createIssue(
        'structural-choice-multiple',
        node.path,
        `Choice element '${node.path}' has multiple values: ${present.join(', ')}`,
        graph,
      ));
    }

    const choiceValues = presentEntries.map(entry => entry.value);
    for (const value of choiceValues) {
      if (node.fixed !== undefined && !graphValuesMatch(value, node.fixed)) {
        issues.push(createIssue('profile-fixed-value-mismatch', node.path, `Choice '${node.path}' does not match fixed value`, graph));
      }
      if (node.pattern !== undefined) {
        const pattern = matchPatternWithDiagnostic(value, node.pattern, node.path);
        if (!pattern.matches) {
          issues.push(createIssue(
            'profile-pattern-mismatch',
            pattern.path ?? node.path,
            pattern.message ?? `Choice '${node.path}' does not match pattern`,
            graph,
          ));
        }
      }
    }

    for (const entry of presentEntries) {
      const choiceSlice = (node.children ?? []).find(child => child.sliceName === entry.name);
      if (choiceSlice?.pattern !== undefined) {
        const pattern = matchPatternWithDiagnostic(entry.value, choiceSlice.pattern, choiceSlice.path);
        if (!pattern.matches) {
          issues.push(createIssue(
            'profile-pattern-mismatch',
            pattern.path ?? choiceSlice.path,
            pattern.message ?? `Choice slice '${choiceSlice.path}' does not match pattern`,
            graph,
          ));
        }
      }
      if (choiceSlice?.fixed !== undefined && !graphValuesMatch(entry.value, choiceSlice.fixed)) {
        issues.push(createIssue(
          'profile-fixed-value-mismatch',
          choiceSlice.path,
          `Choice slice '${choiceSlice.path}' does not match fixed value`,
          graph,
        ));
      }
      const choiceChildren = choiceSlice?.children ?? (node.children ?? []).filter(child => !child.sliceName);
      for (const child of choiceChildren) {
        if (child.sliceName) {
          continue;
        }
        validateNodeForParents([entry.value], child, graph, issues, ancestors, resolveReference);
      }
    }
  }
}

function getChoiceEntries(parent: unknown, node: ValidationGraphNode): Array<{ name: string; value: unknown }> {
  if (!isRecord(parent)) {
    return [];
  }

  const configuredChoices = node.choices ?? [];
  const names = configuredChoices.length > 0
    ? configuredChoices
    : Object.keys(parent).filter(key => isChoiceProperty(key, node.name));

  return names.flatMap(name => getDirectValues(parent, name).map(value => ({ name, value })));
}
