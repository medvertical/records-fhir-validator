export const PRIMITIVE_TYPE_CODES = new Set<string>([
  'string', 'code', 'markdown', 'id', 'uri', 'url', 'canonical', 'oid', 'uuid', 'xhtml',
  'integer', 'unsignedInt', 'positiveInt', 'integer64',
  'decimal', 'boolean',
  'date', 'dateTime', 'instant', 'time',
  'base64Binary',
]);

type FhirObject = Record<string, unknown>;

function isFhirObject(value: unknown): value is FhirObject {
  return typeof value === 'object' && value !== null;
}

export function matchesPrimitiveType(value: unknown, effectiveType: string): boolean | null {
  switch (effectiveType) {
    case 'string':
    case 'code':
    case 'markdown':
    case 'id':
    case 'uri':
    case 'url':
    case 'canonical':
    case 'oid':
    case 'uuid':
    case 'xhtml':
      return typeof value === 'string';

    case 'integer':
    case 'unsignedInt':
    case 'positiveInt':
      return Number.isInteger(value);

    case 'integer64':
      if (typeof value === 'string') {
        return /^-?\d+$/.test(value) && !Number.isNaN(parseInt(value, 10));
      }
      return Number.isInteger(value);

    case 'decimal':
      return typeof value === 'number';

    case 'boolean':
      return typeof value === 'boolean';

    case 'date':
      return typeof value === 'string';

    case 'dateTime':
    case 'instant':
      return typeof value === 'string';

    case 'time':
      return typeof value === 'string';

    case 'base64Binary':
      return typeof value === 'string';

    default:
      return null;
  }
}

export function matchesComplexType(value: unknown, effectiveType: string): boolean {
  switch (effectiveType) {
    case 'CodeableConcept':
      return isCodeableConcept(value);
    case 'Coding':
      return isCoding(value);
    case 'Reference':
      return isReference(value);
    case 'Identifier':
      return isIdentifier(value);
    case 'HumanName':
      return isHumanName(value);
    case 'Address':
      return isAddress(value);
    case 'ContactPoint':
      return isContactPoint(value);
    case 'Period':
      return isPeriod(value);
    case 'Quantity':
    case 'SimpleQuantity':
      return isQuantity(value);
    case 'Range':
      return isRange(value);
    case 'Ratio':
      return isRatio(value);
    case 'Attachment':
      return isAttachment(value);
    case 'Annotation':
      return isAnnotation(value);
    case 'CodeableReference':
      return isCodeableReference(value);
    case 'BackboneElement':
    case 'Element':
      return isFhirObject(value);
    case 'Resource':
      return isFhirObject(value) && typeof value.resourceType === 'string';
    default:
      return isFhirObject(value);
  }
}

export function getActualFhirType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';

  const jsType = typeof value;
  if (isFhirObject(value) && typeof value.resourceType === 'string') {
    return value.resourceType;
  }

  if (isHumanName(value)) return 'HumanName';
  if (isAddress(value)) return 'Address';
  if (isCodeableConcept(value)) return 'CodeableConcept';
  if (isCoding(value)) return 'Coding';
  if (isContactPoint(value)) return 'ContactPoint';
  if (isIdentifier(value)) return 'Identifier';
  if (isCodeableReference(value)) return 'CodeableReference';
  if (isReference(value)) return 'Reference';
  if (isPeriod(value)) return 'Period';
  if (isQuantity(value)) return 'Quantity';
  if (isRange(value)) return 'Range';
  if (isRatio(value)) return 'Ratio';
  if (isAttachment(value)) return 'Attachment';
  if (isAnnotation(value)) return 'Annotation';

  return jsType;
}

export function isExtensionOnly(value: unknown): boolean {
  if (!isFhirObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(k => k === 'extension' || k === 'id');
}

function isCodeableConcept(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.coding !== undefined || value.text !== undefined);
}

function isCoding(value: unknown): boolean {
  return isFhirObject(value) &&
    value.code !== undefined &&
    value.rank === undefined &&
    !Array.isArray(value.coding);
}

function isReference(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.reference !== undefined || value.identifier !== undefined || value.display !== undefined);
}

function isIdentifier(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.system !== undefined || value.value !== undefined);
}

function isHumanName(value: unknown): boolean {
  if (!isFhirObject(value)) return false;
  if (value.family !== undefined || value.given !== undefined ||
      value.prefix !== undefined || value.suffix !== undefined) {
    return true;
  }
  if (value.line !== undefined || value.city !== undefined ||
      value.state !== undefined || value.postalCode !== undefined ||
      value.country !== undefined || value.district !== undefined) {
    return false;
  }
  if (value.system !== undefined && value.value !== undefined) return false;
  if (value.rank !== undefined) return false;
  return value.text !== undefined || value.use !== undefined || value.period !== undefined;
}

function isAddress(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.use !== undefined || value.type !== undefined || value.text !== undefined ||
      value.line !== undefined || value.city !== undefined || value.district !== undefined ||
      value.state !== undefined || value.postalCode !== undefined || value.country !== undefined ||
      value.period !== undefined);
}

function isContactPoint(value: unknown): boolean {
  return isFhirObject(value) &&
    value.code === undefined &&
    (value.rank !== undefined ||
      (value.system !== undefined && value.value !== undefined) ||
      (value.value !== undefined && (value.use !== undefined || value.period !== undefined)));
}

function isPeriod(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.start !== undefined || value.end !== undefined);
}

function isQuantity(value: unknown): boolean {
  return isFhirObject(value) &&
    (typeof value.value === 'number' || value.unit !== undefined ||
      value.system !== undefined || value.code !== undefined);
}

function isRange(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.low !== undefined || value.high !== undefined);
}

function isRatio(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.numerator !== undefined || value.denominator !== undefined);
}

function isAttachment(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.contentType !== undefined || value.language !== undefined || value.data !== undefined ||
      value.url !== undefined || value.size !== undefined || value.hash !== undefined ||
      value.title !== undefined || value.creation !== undefined);
}

function isAnnotation(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.text !== undefined || value.authorReference !== undefined || value.authorString !== undefined || value.time !== undefined);
}

function isCodeableReference(value: unknown): boolean {
  return isFhirObject(value) &&
    (value.concept !== undefined || isFhirObject(value.reference));
}
