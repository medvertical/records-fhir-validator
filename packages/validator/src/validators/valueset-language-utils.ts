export function isLanguageBinding(valueSetUrl: string, system: string | undefined): boolean {
  return valueSetUrl.includes('all-languages') ||
    valueSetUrl === 'http://hl7.org/fhir/ValueSet/languages' ||
    system === 'urn:ietf:bcp:47';
}

export function validateBCP47(code: string): boolean {
  return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$/.test(code);
}
