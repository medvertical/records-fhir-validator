import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

type Entry = { item: Record<string, unknown>; path: string; order: number; end: number };

/**
 * The reference validator checks where each enableWhen points
 * (QuestionnaireValidator.validateQuestionnaireElement): at a question the
 * questionnaire has, neither one of the item's own items nor the item itself,
 * and one that comes before it — a later target only draws a warning.
 */
export function validateEnableWhenTargets(items: unknown[], basePath: string): ValidationIssue[] {
  const entries = preOrder(items, basePath);
  const firstByLinkId = new Map<string, Entry>();
  for (const entry of entries) {
    const linkId = entry.item.linkId;
    if (typeof linkId === 'string' && !firstByLinkId.has(linkId)) firstByLinkId.set(linkId, entry);
  }
  const issues: ValidationIssue[] = [];
  for (const entry of entries) {
    const conditions = Array.isArray(entry.item.enableWhen) ? entry.item.enableWhen : [];
    for (const condition of conditions) {
      const question = asRecord(condition)?.question;
      if (typeof question !== 'string') {
        issues.push(targetIssue(entry.path, 'error', 'Questions with an enableWhen must have a value for the question link'));
        continue;
      }
      // An item's own items follow it in pre-order, up to the end of its subtree.
      const inner = entries.some(other => other.order > entry.order && other.order < entry.end && other.item.linkId === question);
      const target = firstByLinkId.get(question);
      if (inner) {
        issues.push(targetIssue(entry.path, 'error', 'Questions with an enableWhen cannot refer to an inner question for its enableWhen condition'));
      } else if (!target) {
        issues.push(targetIssue(entry.path, 'error',
          `Unable to find an item with the linkId '${question}' which is referenced in the enableWhen for '${String(entry.item.linkId)}'`));
      } else if (target === entry) {
        issues.push(targetIssue(entry.path, 'error', "Target for this question enableWhen can't reference itself"));
      } else if (target.order > entry.order) {
        issues.push(targetIssue(entry.path, 'warning', `The target of this enableWhen rule (${question}) comes after the question itself`));
      }
    }
  }
  return issues;
}

/** Items in document order, each with the order just past its own subtree. */
function preOrder(items: unknown[], basePath: string): Entry[] {
  const entries: Entry[] = [];
  const pending: Array<{ value: unknown; path: string } | Entry> = items.map((value, index) => ({ value, path: `${basePath}[${index}]` })).reverse();
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const next = pending.pop()!;
    if ('order' in next) {
      next.end = entries.length;
      continue;
    }
    const item = asRecord(next.value);
    if (!item || visited.has(item)) continue;
    visited.add(item);
    const entry: Entry = { item, path: next.path, order: entries.length, end: entries.length + 1 };
    entries.push(entry);
    pending.push(entry);
    const children = Array.isArray(item.item) ? item.item : [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push({ value: children[index], path: `${next.path}.item[${index}]` });
  }
  return entries;
}

function targetIssue(path: string, severity: 'error' | 'warning', message: string): ValidationIssue {
  return createValidationIssue({
    code: 'questionnaire-enablewhen-target',
    path,
    resourceType: 'Questionnaire',
    customMessage: message,
    severityOverride: severity,
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
