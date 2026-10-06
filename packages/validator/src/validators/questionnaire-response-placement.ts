import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

type Level = { responseItems: unknown[]; questionItems: unknown[]; containerPath: string };

/**
 * The reference validator walks a response level by level against the
 * questionnaire (QuestionnaireValidator.validateQuestionannaireResponseItems):
 * an item whose linkId that level does not define is misplaced when the
 * questionnaire defines it elsewhere, the items of a level follow the
 * questionnaire's order, and only a repeating item occurs more than once.
 * Each is reported at the level's container.
 */
export function validateResponseItemPlacement(responseItems: unknown[], questionnaireItems: unknown[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const definitions = questionItemsByLinkId(questionnaireItems);
  const pending: Level[] = [{ responseItems, questionItems: questionnaireItems, containerPath: 'QuestionnaireResponse' }];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const { responseItems: items, questionItems, containerPath } = pending.pop()!;
    let lastIndex = -1;
    const occurrences = new Map<string, { question: Record<string, unknown>; count: number }>();
    items.forEach((value, position) => {
      const item = asRecord(value);
      if (!item || visited.has(item) || typeof item.linkId !== 'string' || item.linkId.length === 0) return;
      visited.add(item);
      const index = questionItems.findIndex(question => asRecord(question)?.linkId === item.linkId);
      let question = asRecord(questionItems[index]);
      if (index === -1) {
        question = definitions.get(item.linkId);
        if (!question) return;
        issues.push(placementIssue(containerPath, `Structural Error: item with linkid ${item.linkId} is in the wrong place`));
      } else {
        if (index < lastIndex) issues.push(placementIssue(containerPath, 'Structural Error: items are out of order'));
        lastIndex = index;
        const seen = occurrences.get(item.linkId);
        occurrences.set(item.linkId, { question: question!, count: (seen?.count ?? 0) + 1 });
      }
      pending.push(...childLevels(item, `${containerPath}.item[${position}]`, question));
    });
    for (const [linkId, { question, count }] of occurrences) {
      if (count > 1 && question.repeats !== true) {
        issues.push(placementIssue(containerPath, `Only one response item with the linkId ${linkId} allowed - found ${count} items`));
      }
    }
  }
  return issues;
}

/** A group's items and the items nested under each answer answer to the question's own items. */
function childLevels(item: Record<string, unknown>, itemPath: string, question: Record<string, unknown> | undefined): Level[] {
  const questionItems = Array.isArray(question?.item) ? question.item : [];
  const levels: Level[] = [];
  if (Array.isArray(item.item)) levels.push({ responseItems: item.item, questionItems, containerPath: itemPath });
  if (Array.isArray(item.answer)) {
    item.answer.forEach((answer, index) => {
      const nested = asRecord(answer)?.item;
      if (Array.isArray(nested)) levels.push({ responseItems: nested, questionItems, containerPath: `${itemPath}.answer[${index}]` });
    });
  }
  return levels;
}

function questionItemsByLinkId(items: unknown[]): Map<string, Record<string, unknown>> {
  const definitions = new Map<string, Record<string, unknown>>();
  const pending = [...items].reverse();
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const item = asRecord(pending.pop());
    if (!item || visited.has(item)) continue;
    visited.add(item);
    if (typeof item.linkId === 'string' && !definitions.has(item.linkId)) definitions.set(item.linkId, item);
    if (Array.isArray(item.item)) pending.push(...[...item.item].reverse());
  }
  return definitions;
}

function placementIssue(path: string, message: string): ValidationIssue {
  return createValidationIssue({
    code: 'structure',
    path,
    resourceType: 'QuestionnaireResponse',
    customMessage: message,
    severityOverride: 'error',
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
