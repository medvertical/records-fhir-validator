import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateQuestionnaireAnswerTypes } from './questionnaire-answer-validator.js';
import { isQuestionnaireItemEnabled } from './questionnaire-enable-when.js';
import type {
  AnswerOption,
  EnableWhen,
  QuestionnaireExtension,
  QuestionnaireItem,
  QuestionnaireResponseAnswer,
  QuestionnaireResponseItem,
} from './questionnaire-types.js';
import type { ValueSetCache } from './valueset-cache.js';
import { visitQuestionnaireResponseItems } from './questionnaire-response-traversal.js';

export function buildQuestionnaireItemMap(
  items: unknown[],
): Map<string, QuestionnaireItem> {
  const map = new Map<string, QuestionnaireItem>();
  const pending: unknown[] = [...items].reverse();
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const source = asRecord(pending.pop());
    if (!source || visited.has(source)) continue;
    visited.add(source);
    const item = normalizeQuestionnaireItem(source);
    if (!item) continue;
    if (item.linkId) map.set(item.linkId, item);
    if (Array.isArray(item.item)) pending.push(...[...item.item].reverse());
  }
  return map;
}

export function validateQuestionnaireResponseItemsBasic(
  items: unknown[],
  basePath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  visitQuestionnaireResponseItems(items, basePath, (item, path) => {
    if (!item.linkId) {
      issues.push(createValidationIssue({
        code: 'qr-missing-linkid',
        path: `${path}.linkId`,
        resourceType: 'QuestionnaireResponse',
        customMessage: 'Response item must have a linkId',
        severityOverride: 'error',
      }));
    }
  });
  return issues;
}

export function validateQuestionnaireResponseItems(
  items: unknown[],
  questionMap: Map<string, QuestionnaireItem>,
  basePath: string,
  cache: ValueSetCache,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  visitQuestionnaireResponseItems(items, basePath, (item, path) => {
    if (!item.linkId) return false;

    const question = questionMap.get(item.linkId);
    if (!question) {
      issues.push(createValidationIssue({
        code: 'not-found',
        path: `${path}.linkId`,
        resourceType: 'QuestionnaireResponse',
        customMessage: `LinkId '${item.linkId}' not found in questionnaire`,
        severityOverride: 'error',
      }));
      return false;
    }

    if (question.type === 'display' && item.answer && item.answer.length > 0) {
      issues.push(createValidationIssue({
        code: 'structure',
        path,
        resourceType: 'QuestionnaireResponse',
        customMessage: "Items of type 'display' cannot have answers",
        severityOverride: 'error',
      }));
      return false;
    }

    if (question.type === 'group' && item.answer && item.answer.length > 0) {
      issues.push(createValidationIssue({
        code: 'structure',
        path,
        resourceType: 'QuestionnaireResponse',
        customMessage: "Items of type 'group' cannot have answers, only sub-items",
        severityOverride: 'error',
      }));
    }

    validateRequiredResponseItem(item, question, path, issues);

    if (!question.repeats && Array.isArray(item.answer) && item.answer.length > 1) {
      issues.push(createValidationIssue({
        code: 'qr-repeats-violation',
        path,
        resourceType: 'QuestionnaireResponse',
        customMessage: 'Only one response answer item with this linkId allowed',
        severityOverride: 'error',
      }));
    }

    if (Array.isArray(item.answer)) {
      issues.push(...validateQuestionnaireAnswerTypes(
        item.answer,
        question,
        `${path}.answer`,
        cache,
      ));
    }
  });
  return issues;
}

function normalizeQuestionnaireItem(item: Record<string, unknown>): QuestionnaireItem | undefined {
  if (typeof item.linkId !== 'string' || !isQuestionnaireItemType(item.type)) return undefined;

  const answerOptions = Array.isArray(item.answerOption)
    ? item.answerOption.map(normalizeAnswerOption)
    : undefined;
  const enableWhen = Array.isArray(item.enableWhen)
    ? item.enableWhen.flatMap(entry => {
        const normalized = normalizeEnableWhen(entry);
        return normalized ? [normalized] : [];
      })
    : undefined;
  const extensions = Array.isArray(item.extension)
    ? item.extension.flatMap(entry => {
        const normalized = normalizeQuestionnaireExtension(entry);
        return normalized ? [normalized] : [];
      })
    : undefined;

  return {
    linkId: item.linkId,
    type: item.type,
    ...(typeof item.text === 'string' ? { text: item.text } : {}),
    ...(typeof item.required === 'boolean' ? { required: item.required } : {}),
    ...(typeof item.repeats === 'boolean' ? { repeats: item.repeats } : {}),
    ...(typeof item.readOnly === 'boolean' ? { readOnly: item.readOnly } : {}),
    ...(typeof item.maxLength === 'number' ? { maxLength: item.maxLength } : {}),
    ...(answerOptions ? { answerOption: answerOptions } : {}),
    ...(typeof item.answerValueSet === 'string' ? { answerValueSet: item.answerValueSet } : {}),
    ...(enableWhen ? { enableWhen } : {}),
    ...(item.enableBehavior === 'all' || item.enableBehavior === 'any'
      ? { enableBehavior: item.enableBehavior }
      : {}),
    ...(extensions ? { extension: extensions } : {}),
    ...(Array.isArray(item.item) ? { item: item.item } : {}),
  };
}

const QUESTIONNAIRE_ITEM_TYPES: ReadonlySet<string> = new Set([
  'group', 'display', 'boolean', 'decimal', 'integer', 'date', 'dateTime',
  'time', 'string', 'text', 'url', 'choice', 'open-choice', 'attachment',
  'reference', 'quantity',
]);

function isQuestionnaireItemType(value: unknown): value is QuestionnaireItem['type'] {
  return typeof value === 'string' && QUESTIONNAIRE_ITEM_TYPES.has(value);
}

function normalizeAnswerOption(value: unknown): AnswerOption {
  const option = asRecord(value);
  if (!option) return {};
  const coding = asRecord(option.valueCoding);
  const reference = asRecord(option.valueReference);
  const extensions = Array.isArray(option.extension)
    ? option.extension.flatMap(entry => {
        const extension = asRecord(entry);
        return extension && typeof extension.url === 'string'
          ? [{
              url: extension.url,
              ...(typeof extension.valueBoolean === 'boolean'
                ? { valueBoolean: extension.valueBoolean }
                : {}),
            }]
          : [];
      })
    : undefined;
  return {
    ...(typeof option.valueInteger === 'number' ? { valueInteger: option.valueInteger } : {}),
    ...(typeof option.valueDate === 'string' ? { valueDate: option.valueDate } : {}),
    ...(typeof option.valueTime === 'string' ? { valueTime: option.valueTime } : {}),
    ...(typeof option.valueString === 'string' ? { valueString: option.valueString } : {}),
    ...(coding && typeof coding.code === 'string'
      ? { valueCoding: {
          code: coding.code,
          ...(typeof coding.system === 'string' ? { system: coding.system } : {}),
          ...(typeof coding.display === 'string' ? { display: coding.display } : {}),
        } }
      : {}),
    ...(reference && typeof reference.reference === 'string'
      ? { valueReference: { reference: reference.reference } }
      : {}),
    ...(extensions ? { extension: extensions } : {}),
  };
}

function normalizeEnableWhen(value: unknown): EnableWhen | undefined {
  const condition = asRecord(value);
  if (!condition || typeof condition.question !== 'string' || !isEnableWhenOperator(condition.operator)) {
    return undefined;
  }
  const coding = asRecord(condition.answerCoding);
  const quantity = asRecord(condition.answerQuantity);
  const reference = asRecord(condition.answerReference);
  return {
    question: condition.question,
    operator: condition.operator,
    ...(typeof condition.answerBoolean === 'boolean' ? { answerBoolean: condition.answerBoolean } : {}),
    ...(typeof condition.answerDecimal === 'number' ? { answerDecimal: condition.answerDecimal } : {}),
    ...(typeof condition.answerInteger === 'number' ? { answerInteger: condition.answerInteger } : {}),
    ...(typeof condition.answerDate === 'string' ? { answerDate: condition.answerDate } : {}),
    ...(typeof condition.answerDateTime === 'string' ? { answerDateTime: condition.answerDateTime } : {}),
    ...(typeof condition.answerTime === 'string' ? { answerTime: condition.answerTime } : {}),
    ...(typeof condition.answerString === 'string' ? { answerString: condition.answerString } : {}),
    ...(coding && typeof coding.code === 'string'
      ? { answerCoding: {
          code: coding.code,
          ...(typeof coding.system === 'string' ? { system: coding.system } : {}),
        } }
      : {}),
    ...(quantity && typeof quantity.value === 'number'
      ? { answerQuantity: {
          value: quantity.value,
          ...(typeof quantity.unit === 'string' ? { unit: quantity.unit } : {}),
        } }
      : {}),
    ...(reference && typeof reference.reference === 'string'
      ? { answerReference: { reference: reference.reference } }
      : {}),
  };
}

function isEnableWhenOperator(value: unknown): value is EnableWhen['operator'] {
  return value === 'exists' || value === '=' || value === '!=' || value === '>'
    || value === '<' || value === '>=' || value === '<=';
}

function normalizeQuestionnaireExtension(value: unknown): QuestionnaireExtension | undefined {
  const source = asRecord(value);
  if (!source) return undefined;
  const extension: QuestionnaireExtension = {};
  for (const [key, entry] of Object.entries(source)) {
    if (key !== 'url') extension[key] = entry;
  }
  if (typeof source.url === 'string') extension.url = source.url;
  return extension;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function validateRequiredQuestionnaireItems(
  responseItems: unknown[],
  questionMap: Map<string, QuestionnaireItem>,
  answerMap: Map<string, QuestionnaireResponseAnswer[]>,
): ValidationIssue[] {
  const presentLinkIds = collectPresentLinkIds(responseItems);
  const issues: ValidationIssue[] = [];
  for (const [linkId, question] of questionMap) {
    if (!question.required || presentLinkIds.has(linkId) || question.type === 'display') continue;
    if (!isQuestionnaireItemEnabled(question, answerMap)) continue;

    const isGroup = question.type === 'group';
    issues.push(createValidationIssue({
      code: isGroup ? 'qr-required-group' : 'required',
      path: `QuestionnaireResponse.item(linkId=${linkId})`,
      resourceType: 'QuestionnaireResponse',
      customMessage: isGroup
        ? 'No sub-items found for required group'
        : `No response answer found for required item '${linkId}'`,
      severityOverride: 'error',
    }));
  }
  return issues;
}

function validateRequiredResponseItem(
  item: QuestionnaireResponseItem,
  question: QuestionnaireItem,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!question.required || question.type === 'display') return;
  if (question.type === 'group') {
    if (!item.item || item.item.length === 0) {
      issues.push(createValidationIssue({
        code: 'qr-required-group',
        path,
        resourceType: 'QuestionnaireResponse',
        customMessage: 'No sub-items found for required group',
        severityOverride: 'error',
      }));
    }
    return;
  }
  if (!item.answer || item.answer.length === 0) {
    issues.push(createValidationIssue({
      code: 'required',
      path,
      resourceType: 'QuestionnaireResponse',
      customMessage: `No response answer found for required item '${item.linkId}'`,
      severityOverride: 'error',
    }));
  }
}

function collectPresentLinkIds(items: unknown[]): Set<string> {
  const present = new Set<string>();
  visitQuestionnaireResponseItems(items, 'QuestionnaireResponse.item', item => {
    if (item.linkId) present.add(item.linkId);
  });
  return present;
}
