export interface FHIRSchema {
  url: string;
  name: string;
  base?: string;
  kind: 'resource' | 'complex-type' | 'primitive-type' | 'logical';
  type: string;
  elements?: Record<string, FHIRSchemaElement>;
  required?: string[];
  constraints?: FHIRSchemaConstraint[];
}

export interface FHIRSchemaElement {
  type?: string;
  collection?: boolean;
  required?: boolean;
  min?: number;
  max?: number | '*';
  elements?: Record<string, FHIRSchemaElement>;
  binding?: FHIRSchemaBinding;
  constraints?: FHIRSchemaConstraint[];
  pattern?: unknown;
  fixed?: unknown;
  choiceOf?: string;
  choices?: string[];
  refers?: string[];
  extensionUrl?: string;
  slicing?: FHIRSchemaSlicing;
  slices?: Record<string, FHIRSchemaSlice>;
}

export interface FHIRSchemaSlicing {
  discriminator: Array<{ type: string; path: string }>;
  rules: 'open' | 'closed' | 'openAtEnd';
  ordered?: boolean;
}

export interface FHIRSchemaSlice {
  type?: string;
  min?: number;
  max?: number | '*';
  match?: Record<string, unknown>;
  elements?: Record<string, FHIRSchemaElement>;
  binding?: FHIRSchemaBinding;
  constraints?: FHIRSchemaConstraint[];
  choices?: string[];
  refers?: string[];
  extensionUrl?: string;
  pattern?: unknown;
  fixed?: unknown;
}

export interface FHIRSchemaBinding {
  valueSet: string;
  strength: 'required' | 'extensional' | 'preferred' | 'example';
}

export interface FHIRSchemaConstraint {
  key: string;
  severity: 'error' | 'warning';
  human: string;
  expression?: string;
}

export interface SDElement {
  [key: string]: unknown;
  id?: string;
  path: string;
  min?: number;
  max?: string;
  type?: Array<{
    code: string;
    targetProfile?: string[];
    profile?: string[];
  }>;
  binding?: {
    strength: string;
    valueSet?: string;
  };
  constraint?: Array<{
    key: string;
    severity: string;
    human: string;
    expression?: string;
  }>;
  fixedString?: string;
  fixedCode?: string;
  fixedUri?: string;
  fixedBoolean?: boolean;
  patternCodeableConcept?: unknown;
  patternCoding?: unknown;
  patternIdentifier?: unknown;
  slicing?: unknown;
  sliceName?: string;
}

export interface StructureDefinition {
  [key: string]: unknown;
  url: string;
  name: string;
  type: string;
  kind: string;
  baseDefinition?: string;
  snapshot?: { element: SDElement[] };
  differential?: { element: SDElement[] };
}
