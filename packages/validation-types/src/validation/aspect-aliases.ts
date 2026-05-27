import type { ValidationAspect } from './enums';
import type { ValidationSettings, ValidationSettingsUpdate } from './settings';

export const CANONICAL_CUSTOM_RULE_ASPECT = 'custom_rule' as const;

const ASPECT_ALIASES: Record<string, ValidationAspect> = {
  structural: 'structural',
  profile: 'profile',
  terminology: 'terminology',
  reference: 'reference',
  invariant: 'invariant',
  custom_rule: 'custom_rule',
  metadata: 'metadata',
  anomaly: 'anomaly',
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toAspectLookupKey(aspect: string): string {
  return aspect.toLowerCase().replace(/[-\s]/g, '');
}

export function normalizeValidationAspect(aspect: string): ValidationAspect | string {
  return ASPECT_ALIASES[toAspectLookupKey(aspect)] ?? aspect;
}

export function normalizeValidationAspects<T>(aspects: T): T {
  if (!isObjectRecord(aspects)) {
    return aspects;
  }

  const normalized: Record<string, unknown> = { ...aspects };
  for (const [key, value] of Object.entries(aspects)) {
    const normalizedKey = normalizeValidationAspect(key);
    if (normalizedKey === key) continue;

    if (normalized[normalizedKey] === undefined) {
      normalized[normalizedKey] = value;
    }
    delete normalized[key];
  }

  return normalized as T;
}

export function normalizeValidationSettings<T>(settings: T): T {
  if (!isObjectRecord(settings)) {
    return settings;
  }

  const typedSettings = settings as Partial<ValidationSettings> | ValidationSettingsUpdate;
  return {
    ...typedSettings,
    aspects: normalizeValidationAspects(typedSettings.aspects),
  } as T;
}
