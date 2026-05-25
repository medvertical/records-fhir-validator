export const PRIMITIVE_TYPE_CODES = new Set<string>([
  'string', 'code', 'markdown', 'id', 'uri', 'url', 'canonical', 'oid', 'uuid', 'xhtml',
  'integer', 'unsignedInt', 'positiveInt', 'integer64',
  'decimal', 'boolean',
  'date', 'dateTime', 'instant', 'time',
  'base64Binary',
]);

export function matchesPrimitiveType(value: any, effectiveType: string): boolean | null {
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
      return typeof value === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value);

    case 'dateTime':
    case 'instant':
      if (typeof value === 'string' && value.includes('T') && !/[Z+-]/.test(value.split('T')[1] || '')) {
        return false;
      }
      return typeof value === 'string' && isValidDateTime(value);

    case 'time':
      return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?$/.test(value);

    case 'base64Binary':
      return typeof value === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value);

    default:
      return null;
  }
}

export function matchesComplexType(value: any, effectiveType: string): boolean {
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
      return typeof value === 'object' && value !== null;
    case 'Resource':
      return typeof value === 'object' && value !== null && typeof value.resourceType === 'string';
    default:
      return typeof value === 'object' && value !== null;
  }
}

export function getActualFhirType(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';

  const jsType = typeof value;
  if (jsType === 'object' && value.resourceType) {
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

export function isExtensionOnly(value: any): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(k => k === 'extension' || k === 'id');
}

function isValidDateTime(value: string): boolean {
  const fhirDateTimeRe = /^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?$/;
  if (!fhirDateTimeRe.test(value)) return false;

  const dayMatch = value.match(/^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])/);
  if (dayMatch) {
    const [, y, m, d] = dayMatch;
    const dt = new Date(`${y}-${m}-${d}T00:00:00Z`);
    if (dt.getUTCFullYear() !== Number(y)
      || (dt.getUTCMonth() + 1) !== Number(m)
      || dt.getUTCDate() !== Number(d)) {
      return false;
    }
  }
  return true;
}

function isCodeableConcept(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.coding !== undefined || value.text !== undefined);
}

function isCoding(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    value.code !== undefined &&
    value.rank === undefined &&
    !Array.isArray(value.coding);
}

function isReference(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.reference !== undefined || value.identifier !== undefined || value.display !== undefined);
}

function isIdentifier(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.system !== undefined || value.value !== undefined);
}

function isHumanName(value: any): boolean {
  if (typeof value !== 'object' || value === null) return false;
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

function isAddress(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.use !== undefined || value.type !== undefined || value.text !== undefined ||
      value.line !== undefined || value.city !== undefined || value.district !== undefined ||
      value.state !== undefined || value.postalCode !== undefined || value.country !== undefined ||
      value.period !== undefined);
}

function isContactPoint(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    value.code === undefined &&
    (value.rank !== undefined ||
      (value.system !== undefined && value.value !== undefined) ||
      (value.value !== undefined && (value.use !== undefined || value.period !== undefined)));
}

function isPeriod(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.start !== undefined || value.end !== undefined);
}

function isQuantity(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (typeof value.value === 'number' || value.unit !== undefined ||
      value.system !== undefined || value.code !== undefined);
}

function isRange(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.low !== undefined || value.high !== undefined);
}

function isRatio(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.numerator !== undefined || value.denominator !== undefined);
}

function isAttachment(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.contentType !== undefined || value.language !== undefined || value.data !== undefined ||
      value.url !== undefined || value.size !== undefined || value.hash !== undefined ||
      value.title !== undefined || value.creation !== undefined);
}

function isAnnotation(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.text !== undefined || value.authorReference !== undefined || value.authorString !== undefined || value.time !== undefined);
}

function isCodeableReference(value: any): boolean {
  return typeof value === 'object' &&
    value !== null &&
    (value.concept !== undefined || (value.reference !== undefined && typeof value.reference === 'object'));
}
