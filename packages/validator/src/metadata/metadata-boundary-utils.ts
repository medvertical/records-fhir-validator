export type FhirObject = Record<string, unknown>;

export function isObjectRecord(value: unknown): value is FhirObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getStringField(value: unknown, field: string): string | undefined {
  if (!isObjectRecord(value)) return undefined;
  const fieldValue = value[field];
  return typeof fieldValue === 'string' && fieldValue.length > 0 ? fieldValue : undefined;
}

export function getMetadataEngine(settings: unknown): string {
  if (!isObjectRecord(settings) || !isObjectRecord(settings.aspects)) return 'local';
  const metadata = settings.aspects.metadata;
  if (!isObjectRecord(metadata)) return 'local';
  return typeof metadata.engine === 'string' ? metadata.engine : 'local';
}
