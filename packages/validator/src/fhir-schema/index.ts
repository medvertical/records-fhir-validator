/**
 * FHIR Schema Boundary
 *
 * Experimental StructureDefinition → FHIRSchema converter and validation graph.
 * This surface is for evidence, dual-path comparison, and representation
 * experiments. It is not the default runtime validation path.
 */

export {
    convertToFHIRSchema,
    mergeDifferentialWithBase,
    extractAllBindings,
    extractExtensionDefs,
    summarizeConversion,
} from './sd-to-fhir-schema.js';
export { compileFHIRSchemaToValidationGraph, summarizeGraph } from './validation-graph-compiler.js';
export { validateResourceWithGraph } from './validation-graph-executor.js';
export {
    FHIR_SCHEMA_RUNTIME_POLICY,
    isFhirSchemaDefaultRuntimeEnabled,
} from './runtime-policy.js';

export type {
    FHIRSchema,
    FHIRSchemaElement,
    FHIRSchemaSlicing,
    FHIRSchemaSlice,
    FHIRSchemaBinding,
    FHIRSchemaConstraint,
    BaseResolver,
    SDElement,
    StructureDefinition,
} from './sd-to-fhir-schema.js';
export type {
    ValidationGraph,
    ValidationGraphNode,
    ValidationGraphStats,
} from './validation-graph-types.js';
export type {
    FhirSchemaPromotionRequirement,
    FhirSchemaRuntimeMode,
    FhirSchemaRuntimePolicy,
} from './runtime-policy.js';
