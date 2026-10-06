const MIME_TYPES_VALUE_SET_URL = 'http://hl7.org/fhir/ValueSet/mimetypes';
const MIME_TYPE_SYSTEM = 'urn:ietf:bcp:13';
const SIMPLE_FHIR_FORMAT_CODES = new Set(['xml', 'json', 'ttl']);
const SIMPLE_FHIR_FORMAT_BINDING_PATHS = new Set([
  'CapabilityStatement.format',
  'Signature.targetFormat',
]);

export function isMimeTypesValueSet(valueSetUrl: string): boolean {
  return valueSetUrl.split('|')[0] === MIME_TYPES_VALUE_SET_URL;
}

export function validateMimeTypeBindingCode(code: string, system?: string, elementPath?: string): boolean {
  if (!system && elementPath && allowsSimpleFhirFormatCode(elementPath) && SIMPLE_FHIR_FORMAT_CODES.has(code)) {
    return true;
  }

  const systemMatches = !system || system === MIME_TYPE_SYSTEM;
  return systemMatches && isMediaTypeCode(code);
}

/**
 * The terminology server behind the reference validator checks only that the
 * media type before any `;` has a non-empty type and subtype. It does not
 * parse parameters: tx.fhir.org accepts `text/plain;base64` and
 * `text/plain; charset`, and rejects `text/`, `a/b/c` and `textplain`.
 */
function isMediaTypeCode(code: string): boolean {
  const parts = code.split(';')[0].split('/');
  return parts.length === 2 && parts.every(part => part.trim().length > 0);
}

function allowsSimpleFhirFormatCode(elementPath: string): boolean {
  const normalizedPath = elementPath.replace(/\[\d+\]/g, '');
  return SIMPLE_FHIR_FORMAT_BINDING_PATHS.has(normalizedPath);
}
