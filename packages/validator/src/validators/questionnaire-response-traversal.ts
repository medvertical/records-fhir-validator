import type {
  QuestionnaireQuantity,
  QuestionnaireResponseAnswer,
  QuestionnaireResponseItem,
} from './questionnaire-types.js';

export type QuestionnaireResponseItemVisitor = (
  item: QuestionnaireResponseItem,
  path: string,
) => boolean | void;

/** Iterative QuestionnaireResponse traversal, including answer.item branches. */
export function visitQuestionnaireResponseItems(
  items: unknown[],
  basePath: string,
  visitor: QuestionnaireResponseItemVisitor,
): void {
  const pending = responseItemTasks(items, basePath);
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const { item, path, source } = pending.pop()!;
    if (visited.has(source)) continue;
    visited.add(source);
    if (visitor(item, path) === false) continue;

    if (Array.isArray(item.answer)) {
      for (let answerIndex = item.answer.length - 1; answerIndex >= 0; answerIndex--) {
        const answer = asRecord(item.answer[answerIndex]);
        const nested = answer?.item;
        if (Array.isArray(nested)) {
          pending.push(...responseItemTasks(
            nested,
            `${path}.answer[${answerIndex}].item`,
          ));
        }
      }
    }
    if (Array.isArray(item.item)) pending.push(...responseItemTasks(item.item, `${path}.item`));
  }
}

type ResponseItemTask = {
  item: QuestionnaireResponseItem;
  path: string;
  source: Record<string, unknown>;
};

function responseItemTasks(
  items: unknown[],
  basePath: string,
): ResponseItemTask[] {
  const tasks: ResponseItemTask[] = [];
  for (let index = items.length - 1; index >= 0; index--) {
    const source = asRecord(items[index]);
    if (source) {
      tasks.push({
        item: normalizeResponseItem(source),
        path: `${basePath}[${index}]`,
        source,
      });
    }
  }
  return tasks;
}

function normalizeResponseItem(source: Record<string, unknown>): QuestionnaireResponseItem {
  return {
    ...(typeof source.linkId === 'string' ? { linkId: source.linkId } : {}),
    ...(typeof source.text === 'string' ? { text: source.text } : {}),
    ...(Array.isArray(source.answer)
      ? { answer: source.answer.map(normalizeResponseAnswer) }
      : {}),
    ...(Array.isArray(source.item) ? { item: source.item } : {}),
  };
}

function normalizeResponseAnswer(value: unknown): QuestionnaireResponseAnswer {
  const source = asRecord(value);
  if (!source) return {};

  const coding = normalizeCoding(source.valueCoding);
  const quantity = normalizeQuantity(source.valueQuantity);
  const reference = normalizeReference(source.valueReference);
  return {
    ...(typeof source.valueBoolean === 'boolean' ? { valueBoolean: source.valueBoolean } : {}),
    ...(typeof source.valueDecimal === 'number' ? { valueDecimal: source.valueDecimal } : {}),
    ...(typeof source.valueInteger === 'number' ? { valueInteger: source.valueInteger } : {}),
    ...(typeof source.valueDate === 'string' ? { valueDate: source.valueDate } : {}),
    ...(typeof source.valueDateTime === 'string' ? { valueDateTime: source.valueDateTime } : {}),
    ...(typeof source.valueTime === 'string' ? { valueTime: source.valueTime } : {}),
    ...(typeof source.valueString === 'string' ? { valueString: source.valueString } : {}),
    ...(typeof source.valueUri === 'string' ? { valueUri: source.valueUri } : {}),
    ...(source.valueAttachment !== undefined ? { valueAttachment: source.valueAttachment } : {}),
    ...(coding ? { valueCoding: coding } : {}),
    ...(quantity ? { valueQuantity: quantity } : {}),
    ...(reference ? { valueReference: reference } : {}),
    ...(Array.isArray(source.item) ? { item: source.item } : {}),
  };
}

function normalizeCoding(value: unknown): QuestionnaireResponseAnswer['valueCoding'] | undefined {
  const source = asRecord(value);
  if (!source || typeof source.code !== 'string') return undefined;
  return {
    code: source.code,
    ...(typeof source.system === 'string' ? { system: source.system } : {}),
    ...(typeof source.display === 'string' ? { display: source.display } : {}),
  };
}

function normalizeQuantity(value: unknown): QuestionnaireQuantity | undefined {
  const source = asRecord(value);
  if (!source) return undefined;
  return {
    ...(typeof source.value === 'number' ? { value: source.value } : {}),
    ...(typeof source.unit === 'string' ? { unit: source.unit } : {}),
    ...(typeof source.system === 'string' ? { system: source.system } : {}),
    ...(typeof source.code === 'string' ? { code: source.code } : {}),
  };
}

function normalizeReference(value: unknown): QuestionnaireResponseAnswer['valueReference'] | undefined {
  const source = asRecord(value);
  return source && typeof source.reference === 'string'
    ? { reference: source.reference }
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
