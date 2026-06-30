/**
 * FHIR Schema Boundary
 *
 * Prototype StructureDefinition → FHIRSchema converter. Internal to the
 * OSS validator for now (not exposed via package.json `exports`); will
 * become public once a consumer materialises in the validator runtime.
 */

export {
    convertToFHIRSchema,
    mergeDifferentialWithBase,
    extractAllBindings,
    extractExtensionDefs,
    summarizeConversion,
} from './sd-to-fhir-schema';
export { compileFHIRSchemaToValidationGraph, summarizeGraph } from './validation-graph-compiler';
export { validateResourceWithGraph } from './validation-graph-executor';

export type {
    FHIRSchema,
    FHIRSchemaElement,
    FHIRSchemaSlicing,
    FHIRSchemaSlice,
    FHIRSchemaBinding,
    FHIRSchemaConstraint,
    BaseResolver,
} from './sd-to-fhir-schema';
export type {
    ValidationGraph,
    ValidationGraphNode,
    ValidationGraphStats,
} from './validation-graph-types';
