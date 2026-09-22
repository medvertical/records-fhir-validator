import { ValidationCode } from './message-catalog.js';
import { interpolateMessageTemplate } from './message-template-interpolation.js';
import { MessageTemplates } from './message-templates.js';

export function formatMessage(
  code: string,
  params: Record<string, unknown> = {},
): string {
  const template = MessageTemplates[code as ValidationCode];
  if (!template) return params.message ? String(params.message) : `Validation issue: ${code}`;
  return interpolateMessageTemplate(template, params);
}

export const HumanReadableTemplates: Partial<Record<ValidationCode, string>> = {};

export function getHumanReadableMessage(
  code: string,
  params: Record<string, unknown> = {},
): string {
  const template = HumanReadableTemplates[code as ValidationCode]
    ?? MessageTemplates[code as ValidationCode];
  return template ? interpolateMessageTemplate(template, params) : formatMessage(code, params);
}
