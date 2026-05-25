import type { StructureDefinition } from '../core/structure-definition-types';

export interface ExtensionValidationContext {
  resource: any;
  profileSD: StructureDefinition;
  strictMode: boolean;
  fhirVersion: 'R4' | 'R5' | 'R6';
  profileUrl: string;
  getValueAtPath: (resource: any, path: string) => any;
}

export interface ExtensionDefinition {
  url: string;
  path: string;
  min: number;
  max: string;
  typeCodes?: string[];
  isModifier?: boolean;
  profileUrl?: string;
  sliceName?: string;
}
