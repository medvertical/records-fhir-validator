/**
 * StructureDefinition Types
 * 
 * Type definitions for StructureDefinition and related types.
 * Extracted from structure-definition-loader.ts to break circular dependencies.
 */

export interface StructureDefinition {
  resourceType: 'StructureDefinition';
  id?: string;
  url: string;
  version?: string;
  name: string;
  title?: string;
  status: string;
  kind: string;
  abstract: boolean;
  type: string;
  baseDefinition?: string;
  differential?: {
    element: ElementDefinition[];
  };
  snapshot?: {
    element: ElementDefinition[];
  };
}

export interface ElementDefinition {
  id?: string;
  path: string;
  short?: string;
  definition?: string;
  min?: number;
  max?: string;
  type?: ElementType[];
  constraint?: Constraint[];
  binding?: Binding;
  mustSupport?: boolean;
  isModifier?: boolean;
  sliceName?: string; // Name of the slice (if this element is part of a slice)
  slicing?: SlicingDefinition; // Slicing definition for this element
  // Additional properties used by deep-profile-validator
  maxLength?: number;
  // Fixed values (polymorphic - fixedString, fixedCode, etc.)
  [key: `fixed${string}`]: any;
  // Pattern values (polymorphic - patternCodeableConcept, etc.)
  [key: `pattern${string}`]: any;
  // Min/max values (polymorphic - minValueInteger, maxValueDecimal, etc.)
  [key: `minValue${string}`]: any;
  [key: `maxValue${string}`]: any;
}

export interface SlicingDefinition {
  discriminator?: SlicingDiscriminator[];
  rules?: 'closed' | 'open' | 'openAtEnd';
  ordered?: boolean;
  description?: string;
}

export interface SlicingDiscriminator {
  type: 'value' | 'pattern' | 'type' | 'profile' | 'exists';
  path: string;
}

export interface ElementType {
  code: string;
  profile?: string[];
  targetProfile?: string[];
}

export interface Constraint {
  key: string;
  severity: 'error' | 'warning';
  human: string;
  expression?: string; // FHIRPath expression
  xpath?: string;
  source?: string;
}

export interface Binding {
  strength: 'required' | 'extensible' | 'preferred' | 'example';
  valueSet?: string;
  description?: string;
}

