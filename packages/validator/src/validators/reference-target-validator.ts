/**
 * Reference Target Type Validator
 * -------------------------------
 *
 * For every element declared as `Reference(Type1|Type2|...)` in the
 * active StructureDefinition, verify that the actual reference points
 * at a resource of one of the permitted types. This closes the Phase A
 * corpus miss for `reference-wrong-target-type.json` — Records used to
 * only check reference-string *format*, never the target-type
 * semantics.
 *
 * Scope (Phase B.1):
 *   - Relative references (`Patient/123`) — extract type from the
 *     first path segment and match against the element's targetProfile
 *     canonical set.
 *   - Absolute references (`https://fhir.example.com/Patient/123`) —
 *     extract type from the penultimate segment.
 *
 * Phase B.2 (partial):
 *   - Contained references (`#id`, `#`) — resolved against
 *     `resource.contained` and checked with the same base-type logic.
 *   - URN (`urn:uuid:`) / cross-bundle references — resolved via an
 *     optional reference resolver (the enclosing Bundle's fullUrl/relative
 *     index) so their target type can be checked too.
 *
 * Still deferred:
 *   - Full targetProfile *profile* conformance — only the base resource
 *     type is enforced, not that the target conforms to the named profile
 *     (needs a recursive profile-validation pass).
 *   - Logical references (`identifier` only, no `reference`) — no
 *     target-type check is meaningful.
 */

import type { ValidationIssue } from '../types';
import type { StructureDefinition } from '../core/structure-definition-types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

const RESOURCE_URL_RE = /^https?:\/\/[^\s]+\/([A-Z][A-Za-z]+)\/[A-Za-z0-9\-.]+(?:\/_history\/[A-Za-z0-9\-.]+)?$/;
const RELATIVE_RE = /^([A-Z][A-Za-z]+)\/[A-Za-z0-9\-.]+(?:\/_history\/[A-Za-z0-9\-.]+)?$/;

// Canonical URLs that mean "unrestricted target" — skip the check.
const UNRESTRICTED_TARGET_CANONICALS = new Set<string>([
  'http://hl7.org/fhir/StructureDefinition/Resource',
  'http://hl7.org/fhir/StructureDefinition/DomainResource',
]);

/** Known FHIR R4 resource types for canonical → type resolution */
const KNOWN_RESOURCE_TYPES = new Set([
  'Account', 'ActivityDefinition', 'AdverseEvent', 'AllergyIntolerance', 'Appointment',
  'AppointmentResponse', 'AuditEvent', 'Basic', 'Binary', 'BiologicallyDerivedProduct',
  'BodyStructure', 'Bundle', 'CapabilityStatement', 'CarePlan', 'CareTeam', 'CatalogEntry',
  'ChargeItem', 'ChargeItemDefinition', 'Claim', 'ClaimResponse', 'ClinicalImpression',
  'CodeSystem', 'Communication', 'CommunicationRequest', 'CompartmentDefinition',
  'Composition', 'ConceptMap', 'Condition', 'Consent', 'Contract', 'Coverage',
  'CoverageEligibilityRequest', 'CoverageEligibilityResponse', 'DetectedIssue', 'Device',
  'DeviceDefinition', 'DeviceMetric', 'DeviceRequest', 'DeviceUseStatement',
  'DiagnosticReport', 'DocumentManifest', 'DocumentReference', 'EffectEvidenceSynthesis',
  'Encounter', 'Endpoint', 'EnrollmentRequest', 'EnrollmentResponse', 'EpisodeOfCare',
  'EventDefinition', 'Evidence', 'EvidenceVariable', 'ExampleScenario',
  'ExplanationOfBenefit', 'FamilyMemberHistory', 'Flag', 'Goal', 'GraphDefinition',
  'Group', 'GuidanceResponse', 'HealthcareService', 'ImagingStudy', 'Immunization',
  'ImmunizationEvaluation', 'ImmunizationRecommendation', 'ImplementationGuide',
  'InsurancePlan', 'Invoice', 'Library', 'Linkage', 'List', 'Location', 'Measure',
  'MeasureReport', 'Media', 'Medication', 'MedicationAdministration',
  'MedicationDispense', 'MedicationKnowledge', 'MedicationRequest',
  'MedicationStatement', 'MedicinalProduct', 'MedicinalProductAuthorization',
  'MedicinalProductContraindication', 'MedicinalProductIndication',
  'MedicinalProductIngredient', 'MedicinalProductInteraction',
  'MedicinalProductManufactured', 'MedicinalProductPackaged',
  'MedicinalProductPharmaceutical', 'MedicinalProductUndesirableEffect',
  'MessageDefinition', 'MessageHeader', 'MolecularSequence', 'NamingSystem',
  'NutritionOrder', 'Observation', 'ObservationDefinition', 'OperationDefinition',
  'OperationOutcome', 'Organization', 'OrganizationAffiliation', 'Parameters',
  'Patient', 'PaymentNotice', 'PaymentReconciliation', 'Person', 'PlanDefinition',
  'Practitioner', 'PractitionerRole', 'Procedure', 'Provenance', 'Questionnaire',
  'QuestionnaireResponse', 'RelatedPerson', 'RequestGroup', 'ResearchDefinition',
  'ResearchElementDefinition', 'ResearchStudy', 'ResearchSubject', 'RiskAssessment',
  'RiskEvidenceSynthesis', 'Schedule', 'SearchParameter', 'ServiceRequest', 'Slot',
  'Specimen', 'SpecimenDefinition', 'StructureDefinition', 'StructureMap',
  'Subscription', 'Substance', 'SubstanceNucleicAcid', 'SubstancePolymer',
  'SubstanceProtein', 'SubstanceReferenceInformation', 'SubstanceSourceMaterial',
  'SubstanceSpecification', 'SupplyDelivery', 'SupplyRequest', 'Task',
  'TerminologyCapabilities', 'TestReport', 'TestScript', 'ValueSet',
  'VerificationResult', 'VisionPrescription',
]);

/** Callback to resolve a profile canonical URL to its base resource type from the SD cache */
export type ProfileTypeResolver = (canonicalUrl: string) => string | null;

/** Callback to resolve a reference string to its target resource (contained / bundle entry). */
export type ReferenceResolver = (reference: string) => any;

function extractResourceTypeFromCanonical(canonical: string, profileTypeResolver?: ProfileTypeResolver): string | null {
  // Canonical form: http://hl7.org/fhir/StructureDefinition/<ResourceType>
  // Profile canonicals may have a version suffix (|4.0.1).
  const stripped = canonical.split('|')[0];
  const m = stripped.match(/\/([A-Z][A-Za-z]+)$/);
  if (!m) return null;
  const candidate = m[1];
  // If it's a known FHIR resource type, return directly.
  if (KNOWN_RESOURCE_TYPES.has(candidate)) return candidate;
  // Otherwise it's a profiled canonical (e.g. ISiKPatient) — try to
  // resolve via the SD cache to find its base resource type.
  if (profileTypeResolver) {
    const resolved = profileTypeResolver(stripped);
    if (resolved && KNOWN_RESOURCE_TYPES.has(resolved)) return resolved;
  }
  return null;
}

function extractTargetTypeFromReference(reference: string): string | null {
  const rel = reference.match(RELATIVE_RE);
  if (rel) return rel[1];
  const abs = reference.match(RESOURCE_URL_RE);
  if (abs) return abs[1];
  return null; // contained / urn / logical — handled separately
}

/**
 * A targetProfile is "profiled" (worth a conformance pass) when it does not
 * name a bare core resource type — i.e. its last segment is not a known FHIR
 * resource type (`.../StructureDefinition/us-core-patient`, not `.../Patient`).
 */
function isProfiledCanonical(canonical: string): boolean {
  if (UNRESTRICTED_TARGET_CANONICALS.has(canonical)) return false;
  const stripped = canonical.split('|')[0];
  const last = stripped.match(/\/([A-Za-z][A-Za-z0-9-]*)$/)?.[1];
  return last !== undefined && !KNOWN_RESOURCE_TYPES.has(last);
}

/** A reference hit together with the profiled targetProfiles its element declares. */
export interface ProfiledTargetHit {
  path: string;
  reference: string;
  profiles: string[];
}

/**
 * Resolve a reference's target type via an injected resolver (bundle fullUrl /
 * relative / contained index). Returns null when no resolver is supplied or the
 * reference does not resolve — fail open.
 */
function resolveTargetTypeViaResolver(
  reference: string,
  resolveReference?: ReferenceResolver,
): string | null {
  if (!resolveReference) return null;
  const target = resolveReference(reference);
  return target && typeof target.resourceType === 'string' ? target.resourceType : null;
}

/**
 * Resolve the resource type of a contained reference against the container's
 * `contained` array. `#` (bare fragment) refers to the container resource
 * itself. Returns null when the id cannot be resolved — fail open, never flag
 * a reference we cannot positively type.
 */
function resolveContainedTargetType(reference: string, rootResource: any): string | null {
  if (!reference.startsWith('#')) return null;
  const id = reference.slice(1);
  if (id === '') {
    return typeof rootResource?.resourceType === 'string' ? rootResource.resourceType : null;
  }
  const contained = Array.isArray(rootResource?.contained) ? rootResource.contained : [];
  const match = contained.find((c: any) => c && c.id === id);
  return match && typeof match.resourceType === 'string' ? match.resourceType : null;
}

/**
 * Cache of allowed target types per element path, keyed by SD url.
 * Built once per SD to avoid walking type arrays on every resource.
 */
interface AllowedTargetsIndex {
  // Map<elementPath, Set<allowedResourceType> | null>
  // null means "any target type allowed" (unrestricted)
  byPath: Map<string, Set<string> | null>;
}

function buildAllowedTargetsIndex(sd: StructureDefinition, profileTypeResolver?: ProfileTypeResolver): AllowedTargetsIndex {
  const byPath = new Map<string, Set<string> | null>();
  for (const el of sd.snapshot?.element ?? []) {
    if (!el.type || el.type.length === 0) continue;
    const referenceTypes = el.type.filter(t => t.code === 'Reference');
    if (referenceTypes.length === 0) continue;

    let unrestricted = false;
    const allowed = new Set<string>();
    for (const t of referenceTypes) {
      const targetProfiles: string[] = (t as any).targetProfile || [];
      if (targetProfiles.length === 0) {
        // No targetProfile declared → any resource allowed.
        unrestricted = true;
        break;
      }
      for (const canonical of targetProfiles) {
        if (UNRESTRICTED_TARGET_CANONICALS.has(canonical)) {
          unrestricted = true;
          break;
        }
        const rt = extractResourceTypeFromCanonical(canonical, profileTypeResolver);
        if (rt) {
          allowed.add(rt);
        } else {
          // Profiled canonical not in SD cache — can't determine base type.
          // Treat as unrestricted to avoid false positives.
          unrestricted = true;
          break;
        }
      }
      if (unrestricted) break;
    }
    byPath.set(el.path, unrestricted ? null : allowed);
  }
  return { byPath };
}

export class ReferenceTargetValidator {
  private profileTypeResolver?: ProfileTypeResolver;

  /** Inject an optional resolver that maps profile canonical URLs to base resource types */
  setProfileTypeResolver(resolver: ProfileTypeResolver): void {
    this.profileTypeResolver = resolver;
  }

  /**
   * Validate that every Reference in `resource` points at a resource
   * type the StructureDefinition permits for that path.
   */
  validate(
    resource: any,
    structureDef: StructureDefinition,
    resolveReference?: ReferenceResolver,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!structureDef?.snapshot?.element) return issues;

    let index: AllowedTargetsIndex;
    try {
      index = buildAllowedTargetsIndex(structureDef, this.profileTypeResolver);
    } catch (err) {
      logger.debug('[ReferenceTargetValidator] index build failed:', err);
      return issues;
    }
    if (index.byPath.size === 0) return issues;

    const resourceType = resource?.resourceType || 'Unknown';

    for (const [elementPath, allowed] of index.byPath) {
      if (allowed === null) continue; // unrestricted
      if (allowed.size === 0) continue; // no concrete types parsed — skip silently

      // elementPath is dotted: `Encounter.subject`, `Observation.subject`, …
      // Walk the resource tree to find all reference(s) at that path.
      const hits = this.collectReferencesAtPath(resource, elementPath);
      for (const hit of hits) {
        const targetType =
          extractTargetTypeFromReference(hit.reference) ??
          resolveTargetTypeViaResolver(hit.reference, resolveReference) ??
          resolveContainedTargetType(hit.reference, resource);
        if (!targetType) {
          // Logical / unresolvable reference — no meaningful type check.
          continue;
        }
        if (!allowed.has(targetType)) {
          const allowedList = [...allowed].sort().join(', ');
          issues.push(createValidationIssue({
            code: 'reference-target-type-invalid',
            path: hit.path,
            resourceType,
            profile: structureDef.url,
            customMessage:
              `Reference at ${hit.path} points at ${targetType}/… but the profile restricts ` +
              `this element to Reference(${allowedList}). ` +
              `Either change the target type or use a different Reference slot.`,
            details: {
              actualTarget: targetType,
              allowedTargets: [...allowed],
              reference: hit.reference,
            },
            severityOverride: 'error',
          }));
        }
      }
    }

    return issues;
  }

  /**
   * Enumerate reference hits whose element declares one or more *profiled*
   * targetProfiles (e.g. `us-core-patient`, not bare `Patient`). Used by the
   * opt-in target-profile-conformance pass — base-type-only references are
   * already covered by {@link validate}.
   */
  collectProfiledTargetHits(resource: any, structureDef: StructureDefinition): ProfiledTargetHit[] {
    const out: ProfiledTargetHit[] = [];
    for (const el of structureDef.snapshot?.element ?? []) {
      const referenceTypes = (el.type ?? []).filter(t => t.code === 'Reference');
      if (referenceTypes.length === 0) continue;

      const profiles = new Set<string>();
      for (const t of referenceTypes) {
        for (const canonical of ((t as any).targetProfile as string[] | undefined) ?? []) {
          if (isProfiledCanonical(canonical)) profiles.add(canonical.split('|')[0]);
        }
      }
      if (profiles.size === 0) continue;

      for (const hit of this.collectReferencesAtPath(resource, el.path)) {
        out.push({ path: hit.path, reference: hit.reference, profiles: [...profiles] });
      }
    }
    return out;
  }

  /**
   * Walk the resource for every Reference object at the given
   * element definition path. Returns each reference with its concrete
   * path (including array indices).
   */
  private collectReferencesAtPath(resource: any, elementPath: string): Array<{ path: string; reference: string }> {
    const out: Array<{ path: string; reference: string }> = [];
    const segments = elementPath.split('.').slice(1); // drop resource-type root

    interface Frame { obj: any; path: string; }
    let frames: Frame[] = [{ obj: resource, path: resource?.resourceType || '' }];

    for (const seg of segments) {
      const next: Frame[] = [];
      for (const frame of frames) {
        if (frame.obj === null || frame.obj === undefined) continue;
        const v = frame.obj[seg];
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            if (v[i] !== undefined && v[i] !== null) {
              next.push({ obj: v[i], path: `${frame.path}.${seg}[${i}]` });
            }
          }
        } else {
          next.push({ obj: v, path: `${frame.path}.${seg}` });
        }
      }
      frames = next;
    }

    for (const frame of frames) {
      if (frame.obj && typeof frame.obj === 'object' && typeof frame.obj.reference === 'string') {
        out.push({ path: frame.path, reference: frame.obj.reference });
      }
    }
    return out;
  }
}
