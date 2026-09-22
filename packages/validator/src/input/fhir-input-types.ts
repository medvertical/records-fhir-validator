export interface FhirInputLocation {
  line: number;
  column: number;
}

/**
 * A defect in the serialisation itself rather than in the resource it encodes.
 * Stray element text and undefined attributes are dropped by the conversion to
 * an object, so an object-based validator cannot see them afterwards — the
 * adapter has to say so while it still can.
 */
export interface FhirInputDiagnostic {
  code: 'xml-text-not-allowed' | 'xml-attribute-undefined' | 'xml-attribute-empty';
  path: string;
  message: string;
  location?: FhirInputLocation;
}

export interface ParsedFhirInput {
  format: 'xml' | 'ndjson';
  resources: Array<Record<string, unknown>>;
  sourceMap: Record<string, FhirInputLocation>;
  diagnostics?: FhirInputDiagnostic[];
}

export interface FhirInputLimits {
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxRecords?: number;
  maxLineBytes?: number;
}
