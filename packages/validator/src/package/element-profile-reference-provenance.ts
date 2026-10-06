interface ElementType { code: string; profile?: string[]; targetProfile?: string[] }
interface ProfileSource { url?: string; version?: string }
interface TypeProfileOrigin { code: string; references: readonly string[]; source: ProfileSource }
const origins = new WeakMap<ElementType, TypeProfileOrigin>();
function issuedOrigin(type: ElementType): TypeProfileOrigin | undefined {
  const origin = origins.get(type);
  return origin && type.code === origin.code && Array.isArray(type.profile) && type.profile.length === origin.references.length
    && type.profile.every((reference, index) => reference === origin.references[index]) ? origin : undefined;
}
export function recordElementTypeProfileSource(type: ElementType, source: ProfileSource): void {
  if (typeof type.code !== 'string' || !Array.isArray(type.profile)
    || !type.profile.every(reference => typeof reference === 'string') || issuedOrigin(type)) return;
  origins.set(type, { code: type.code, references: [...type.profile], source });
}
export function elementTypeProfileSource(type: ElementType): ProfileSource | undefined {
  return issuedOrigin(type)?.source;
}
export function copyElementTypeProfileSource(original: ElementType, copy: ElementType): void {
  const origin = issuedOrigin(original);
  if (!origin) return;
  origins.set(copy, origin);
  if (!issuedOrigin(copy)) origins.delete(copy);
}
const targetOrigins = new WeakMap<ElementType, TypeProfileOrigin>();
function issuedTargetOrigin(type: ElementType): TypeProfileOrigin | undefined {
  const origin = targetOrigins.get(type);
  return origin && type.code === origin.code && Array.isArray(type.targetProfile) && type.targetProfile.length === origin.references.length
    && type.targetProfile.every((reference, index) => reference === origin.references[index]) ? origin : undefined;
}
export function recordElementTypeTargetProfileSource(type: ElementType, source: ProfileSource): void {
  if (typeof type.code !== 'string' || !Array.isArray(type.targetProfile)
    || !type.targetProfile.every(reference => typeof reference === 'string') || issuedTargetOrigin(type)) return;
  targetOrigins.set(type, { code: type.code, references: [...type.targetProfile], source });
}
export function elementTypeTargetProfileSource(type: ElementType): ProfileSource | undefined {
  return issuedTargetOrigin(type)?.source;
}
export function copyElementTypeTargetProfileSource(original: ElementType, copy: ElementType): void {
  const origin = issuedTargetOrigin(original);
  if (!origin) return;
  targetOrigins.set(copy, origin);
  if (!issuedTargetOrigin(copy)) targetOrigins.delete(copy);
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function elementType(value: unknown): ElementType | undefined {
  const type = object(value);
  return type && typeof type.code === 'string' && (type.profile === undefined
    || Array.isArray(type.profile) && type.profile.every(reference => typeof reference === 'string')) ? type as unknown as ElementType : undefined;
}
/** Detached profile copies retain issued element origins without trusting JSON-supplied metadata. */
export function copyNestedElementProfileSources(original: unknown, copy: unknown): void {
  const originalProfile = object(original); const copiedProfile = object(copy);
  if (!originalProfile || !copiedProfile) return;
  for (const section of ['snapshot', 'differential']) {
    const originals = object(originalProfile[section])?.element;
    const copies = object(copiedProfile[section])?.element;
    if (!Array.isArray(originals) || !Array.isArray(copies)) continue;
    for (let index = 0; index < originals.length; index++) {
      const originalElement = object(originals[index]); const copiedElement = object(copies[index]);
      if (!originalElement || !copiedElement || originalElement.id !== copiedElement.id || originalElement.path !== copiedElement.path) continue;
      const originalTypes = originalElement.type; const copiedTypes = copiedElement.type;
      if (!Array.isArray(originalTypes) || !Array.isArray(copiedTypes)) continue;
      for (let typeIndex = 0; typeIndex < originalTypes.length; typeIndex++) {
        const sourceType = elementType(originalTypes[typeIndex]); const targetType = elementType(copiedTypes[typeIndex]);
        if (sourceType && targetType) {
          copyElementTypeProfileSource(sourceType, targetType);
          copyElementTypeTargetProfileSource(sourceType, targetType);
        }
      }
    }
  }
}
