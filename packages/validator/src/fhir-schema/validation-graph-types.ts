import type {
  FHIRSchemaBinding,
  FHIRSchemaConstraint,
  FHIRSchemaSlicing,
} from './fhir-schema-types';

export interface ValidationGraph {
  url: string;
  name: string;
  type: string;
  base?: string;
  nodes: ValidationGraphNode[];
  stats: ValidationGraphStats;
}

export interface ValidationGraphNode {
  path: string;
  schemaPath: string;
  name: string;
  type?: string;
  collection?: boolean;
  min?: number;
  max?: number | '*';
  required?: boolean;
  choices?: string[];
  fixed?: unknown;
  pattern?: unknown;
  binding?: FHIRSchemaBinding;
  constraints?: FHIRSchemaConstraint[];
  refers?: string[];
  referenceTargetTypes?: string[];
  slicing?: FHIRSchemaSlicing;
  sliceName?: string;
  children?: ValidationGraphNode[];
  source: {
    schemaUrl: string;
    schemaType: string;
  };
}

export interface ValidationGraphStats {
  nodeCount: number;
  sliceNodeCount: number;
  maxDepth: number;
  requiredCount: number;
  choiceCount: number;
  fixedPatternCount: number;
  bindingCount: number;
  referenceCount: number;
  constraintCount: number;
  slicingCount: number;
}
