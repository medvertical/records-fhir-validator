import { logger } from './logger.js';
import { validationFailureMetadata } from './utils/validation-execution-failure.js';
import { terminologyTargetMetadata } from './utils/sensitive-logging-metadata.js';

type ValueSetLoader = (url: string) => Promise<unknown>;

export function collectQuestionnaireAnswerValueSets(
  questionnaire: unknown,
): string[] {
  const root = asRecord(questionnaire);
  if (!root) return [];

  const urls = new Set<string>();
  const pending: unknown[] = [root.item];
  const visitedArrays = new WeakSet<unknown[]>();

  while (pending.length > 0) {
    const items = pending.pop();
    if (!Array.isArray(items) || visitedArrays.has(items)) continue;
    visitedArrays.add(items);

    for (const item of items) {
      const candidate = asRecord(item);
      if (!candidate) continue;
      if (
        typeof candidate.answerValueSet === 'string'
        && candidate.answerValueSet.length > 0
      ) {
        urls.add(candidate.answerValueSet);
      }
      pending.push(candidate.item);
    }
  }

  return [...urls];
}

export async function prewarmQuestionnaireAnswerValueSets(
  questionnaire: unknown,
  loadValueSet: ValueSetLoader,
): Promise<void> {
  for (const url of collectQuestionnaireAnswerValueSets(questionnaire)) {
    try {
      await loadValueSet(url);
    } catch (error: unknown) {
      logger.debug(
        '[QuestionnaireValueSetPrewarm] Could not prewarm ValueSet',
        {
          ...terminologyTargetMetadata(url),
          ...validationFailureMetadata(error),
        },
      );
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
