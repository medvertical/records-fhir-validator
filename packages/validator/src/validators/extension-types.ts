import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';

export interface ExtensionValidationContext {
  resource: unknown;
  profileSD: StructureDefinition;
  strictMode: boolean;
  fhirVersion: 'R4' | 'R5' | 'R6';
  profileUrl: string;
  getValueAtPath: (resource: unknown, path: string) => unknown;
}

export interface ExtensionDefinition {
  url: string;
  path: string;
  elementId?: string;
  min: number;
  max: string;
  typeCodes?: string[];
  isModifier?: boolean;
  profileUrl?: string;
  /**
   * The value[x] rule declared inline below a complex-extension slice.
   * Complex extensions such as US Core ethnicity do not give each nested
   * slice its own StructureDefinition; their type, cardinality, and binding
   * live on `Extension.extension:slice.value[x]` in the parent profile.
   */
  inlineValueElement?: ElementDefinition;
  ownerProfileUrl?: string;
  sliceName?: string;
}
