import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import type { ReferenceResolver } from './slice-types.js';
import type { ProfileConformanceCheck } from './sd-fhirpath-profile-conformance.js';

export interface ExtensionValidationContext {
  resource: unknown;
  rootResource?: unknown;
  profileSD: StructureDefinition;
  strictMode: boolean;
  fhirVersion: 'R4' | 'R5' | 'R6';
  profileUrl: string;
  getValueAtPath: (resource: unknown, path: string) => unknown;
  referenceResolver?: ReferenceResolver | null;
  profileConformance?: ProfileConformanceCheck;
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
  /**
   * The extension definition that declares this nested slice. It names the
   * slice's own profile, so its package decides that profile's release.
   */
  ownerProfileUrl?: string;
  ownerProfileVersion?: string;
  sliceName?: string;
}
