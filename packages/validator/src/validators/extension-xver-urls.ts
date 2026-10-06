/**
 * Cross-version extension URL recognition, mirroring the HL7 Java validator's
 * XVerExtensionManager: URLs of the form
 * `http://hl7.org/fhir/<version>/StructureDefinition/extension-<Type>.<path>`
 * address elements of another FHIR release and are generated on demand by the
 * reference validator rather than shipped as StructureDefinitions, so normal
 * profile resolution can never find them.
 *
 * Plain extensions matching the pattern are treated as known. Modifier
 * extensions are only accepted when the addressed element is flagged
 * `"modifier": true` in the `hl7.fhir.xver-extensions#0.1.0` dataset
 * (`other/xver-paths-<version>.json`) — the same source the Java validator
 * consults — because an unrecognised modifier cannot be safely ignored.
 * Versions absent from that dataset's modifier flags stay unaccepted for
 * modifier use, matching the data-driven Java behaviour. Regenerate the sets
 * below from a newer xver-extensions package, keeping the space-joined
 * alphabetical encoding.
 */

const XVER_EXTENSION_URL_PATTERN =
  /^https?:\/\/hl7\.org\/fhir\/(1\.0|1\.4|3\.0|4\.0|5\.0)\/StructureDefinition\/extension-([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+(?:\[x\])?)+)$/;

const XVER_MODIFIER_PATHS: Record<string, string> = {
  '1.0':
    'Account.status Address.use AllergyIntolerance.status Appointment.status AppointmentResponse.participantStatus Basic.code CarePlan.activity.detail.prohibited CarePlan.activity.detail.status CarePlan.status ClinicalImpression.status Communication.status CommunicationRequest.status Composition.confidentiality Composition.section.mode Composition.status ConceptMap.element.target.equivalence ConceptMap.status Condition.clinicalStatus Condition.verificationStatus Conformance.status ContactPoint.use Coverage.subscriber DataElement.status Device.status DeviceUseRequest.status DiagnosticOrder.status DiagnosticReport.status DocumentManifest.status DocumentReference.relatesTo DocumentReference.status Encounter.status EpisodeOfCare.status FamilyMemberHistory.status Flag.status Goal.status Group.characteristic.exclude HumanName.use Identifier.use Immunization.status Immunization.wasNotGiven ImplementationGuide.status List.entry.deleted List.mode List.status Location.mode Location.status MedicationAdministration.status MedicationAdministration.wasNotGiven MedicationDispense.status MedicationOrder.status MedicationStatement.status MedicationStatement.wasNotTaken MessageHeader.event MessageHeader.response MessageHeader.response.code NamingSystem.status NutritionOrder.status Observation.status OperationDefinition.status OperationOutcome.issue.severity OrderResponse.orderStatus Organization.active Patient.active Patient.animal Patient.deceased[x] Patient.link Patient.link.other Patient.link.type Person.active Procedure.notPerformed Procedure.status ProcedureRequest.status Quantity.comparator Questionnaire.status QuestionnaireResponse.status ReferralRequest.status Resource.implicitRules SearchParameter.status Specimen.status StructureDefinition.status Subscription.status SupplyDelivery.status SupplyRequest.status TestScript.status ValueSet.status',
  '3.0':
    'Account.status ActivityDefinition.experimental ActivityDefinition.status Address.use AllergyIntolerance.clinicalStatus AllergyIntolerance.verificationStatus Appointment.status AppointmentResponse.participantStatus Basic.code BodySite.active CapabilityStatement.experimental CapabilityStatement.status CarePlan.activity.detail.prohibited CarePlan.activity.detail.status CarePlan.intent CarePlan.status CareTeam.status ChargeItem.status Claim.status ClaimResponse.status ClinicalImpression.status CodeSystem.experimental CodeSystem.status Communication.notDone Communication.status CommunicationRequest.status CompartmentDefinition.experimental CompartmentDefinition.status Composition.confidentiality Composition.section.mode Composition.status ConceptMap.experimental ConceptMap.group.element.target.equivalence ConceptMap.status Condition.clinicalStatus Condition.verificationStatus Consent.status ContactPoint.use Contract.status Coverage.status DataElement.experimental DataElement.status DetectedIssue.status Device.status DeviceRequest.intent DeviceRequest.status DeviceUseStatement.status DiagnosticReport.status DocumentManifest.status DocumentReference.relatesTo DocumentReference.status EligibilityRequest.status EligibilityResponse.status Encounter.status Endpoint.status EnrollmentRequest.status EnrollmentResponse.status EpisodeOfCare.status ExpansionProfile.experimental ExpansionProfile.status ExplanationOfBenefit.status FamilyMemberHistory.estimatedAge FamilyMemberHistory.notDone FamilyMemberHistory.status Flag.status Goal.status GraphDefinition.experimental GraphDefinition.status Group.characteristic.exclude GuidanceResponse.status HealthcareService.active HumanName.use Identifier.use Immunization.notGiven Immunization.status ImplementationGuide.experimental ImplementationGuide.status Library.experimental Library.status List.entry.deleted List.mode List.status Location.mode Location.status Measure.experimental Measure.status MeasureReport.status MedicationAdministration.notGiven MedicationAdministration.status MedicationDispense.status MedicationRequest.intent MedicationRequest.status MedicationRequest.substitution.allowed MedicationStatement.status MedicationStatement.taken MessageDefinition.experimental MessageDefinition.status NamingSystem.status NutritionOrder.status Observation.status OperationDefinition.experimental OperationDefinition.status OperationOutcome.issue.severity Organization.active Patient.active Patient.animal Patient.deceased[x] Patient.link PaymentNotice.status PaymentReconciliation.status Person.active PlanDefinition.experimental PlanDefinition.status Procedure.notDone Procedure.status ProcedureRequest.doNotPerform ProcedureRequest.intent ProcedureRequest.status ProcessRequest.status ProcessResponse.status Quantity.comparator Questionnaire.experimental Questionnaire.item.enableWhen Questionnaire.status QuestionnaireResponse.status ReferralRequest.intent ReferralRequest.status RelatedPerson.active RequestGroup.intent RequestGroup.status ResearchStudy.status ResearchSubject.status Schedule.active SearchParameter.experimental SearchParameter.status ServiceDefinition.experimental ServiceDefinition.status Specimen.status StructureDefinition.experimental StructureDefinition.status StructureMap.experimental StructureMap.status Subscription.status SupplyDelivery.status SupplyRequest.status TestReport.status TestScript.experimental TestScript.status ValueSet.compose.include.filter ValueSet.experimental ValueSet.status VisionPrescription.status',
  '5.0':
    'Account.status ActivityDefinition.doNotPerform ActivityDefinition.status ActorDefinition.status Address.use AdministrableProductDefinition.status AdverseEvent.actuality AdverseEvent.status AllergyIntolerance.clinicalStatus AllergyIntolerance.verificationStatus Appointment.status AppointmentResponse.participantStatus Basic.code BodyStructure.active CanonicalResource.status CapabilityStatement.status CarePlan.intent CarePlan.status CareTeam.status ChargeItem.status ChargeItemDefinition.status Citation.status Claim.status ClaimResponse.status ClinicalImpression.status CodeSystem.status Communication.status CommunicationRequest.doNotPerform CommunicationRequest.intent CommunicationRequest.status CompartmentDefinition.status Composition.status ConceptMap.group.element.target.relationship ConceptMap.group.unmapped.relationship ConceptMap.status Condition.clinicalStatus Condition.verificationStatus ConditionDefinition.status Consent.decision Consent.status ContactPoint.use Contract.status Contract.term.action.doNotPerform Coverage.status CoverageEligibilityRequest.status CoverageEligibilityResponse.status DetectedIssue.status Device.name.display Device.status DeviceDispense.status DeviceRequest.doNotPerform DeviceRequest.intent DeviceRequest.status DeviceUsage.status DiagnosticReport.status DocumentReference.status DomainResource.modifierExtension Encounter.status EncounterHistory.status Endpoint.status EnrollmentRequest.status EnrollmentResponse.status EpisodeOfCare.status EventDefinition.status Evidence.status EvidenceReport.status EvidenceVariable.status ExampleScenario.status ExplanationOfBenefit.status FamilyMemberHistory.status Flag.status FormularyItem.status GenomicStudy.status Goal.lifecycleStatus GraphDefinition.status Group.active GuidanceResponse.status HealthcareService.active HumanName.use Identifier.use ImagingSelection.status ImagingStudy.status Immunization.isSubpotent Immunization.status ImmunizationEvaluation.status ImmunizationRecommendation.recommendation.forecastStatus ImplementationGuide.status Ingredient.status InsurancePlan.status InventoryReport.countType InventoryReport.status Invoice.status Library.status List.entry.deleted List.mode List.status Location.status ManufacturedItemDefinition.status Measure.status MeasureReport.dataUpdateType MeasureReport.improvementNotation MeasureReport.scoring MeasureReport.status Medication.status MedicationAdministration.status MedicationDispense.status MedicationKnowledge.status MedicationRequest.doNotPerform MedicationRequest.intent MedicationRequest.status MedicationStatement.status MedicinalProductDefinition.status MessageDefinition.status NamingSystem.status NutritionIntake.status NutritionOrder.intent NutritionOrder.status NutritionProduct.status Observation.status ObservationDefinition.status OperationDefinition.status Organization.active PackagedProductDefinition.status Patient.active Patient.deceased[x] Patient.link PaymentNotice.status PaymentReconciliation.status Permission.combining Permission.rule.type Person.active PlanDefinition.status Practitioner.active Procedure.status Quantity.comparator Questionnaire.item.enableWhen Questionnaire.status QuestionnaireResponse.status RelatedPerson.active RequestOrchestration.intent RequestOrchestration.status Requirements.status ResearchStudy.status ResearchSubject.status Resource.implicitRules Schedule.active SearchParameter.status ServiceRequest.doNotPerform ServiceRequest.intent ServiceRequest.status Specimen.status SpecimenDefinition.status StructureDefinition.status StructureMap.status Subscription.status SubscriptionStatus.type SubscriptionTopic.status Substance.instance Substance.status SupplyDelivery.status SupplyRequest.status Task.doNotPerform Task.status TerminologyCapabilities.status TestPlan.status TestReport.status TestScript.status Transport.status ValueSet.status VisionPrescription.status',
};

const modifierPathSets = new Map<string, Set<string>>();

function modifierPathsFor(version: string): Set<string> {
  let paths = modifierPathSets.get(version);
  if (!paths) {
    // Choice elements are listed as `Patient.deceased[x]` in the dataset but
    // addressed without the marker in xver URLs, so store them stripped.
    paths = new Set(
      (XVER_MODIFIER_PATHS[version] ?? '')
        .split(' ')
        .filter(Boolean)
        .map(path => path.replace(/\[x\]$/, '')),
    );
    modifierPathSets.set(version, paths);
  }
  return paths;
}

/** The releases the xver-extensions dataset describes; its `other/xver-paths-<version>.json` files. */
const XVER_DATASET_RELEASES = new Set(['1.0', '1.4', '3.0', '4.0', '5.0']);
const XVER_URL_SHAPE = /^http:\/\/hl7\.org\/fhir\/(\d\.\d)\/StructureDefinition\/extension-./;

/**
 * The release a cross-version extension URL names when the dataset has no
 * paths for it (`6.0`, `4.3`): the Java validator reports such a URL as
 * invalid instead of looking for its definition.
 */
export function unsupportedCrossVersionRelease(url: string): string | undefined {
  const release = XVER_URL_SHAPE.exec(url)?.[1];
  return release && !XVER_DATASET_RELEASES.has(release) ? release : undefined;
}

export function isKnownCrossVersionExtensionUrl(
  url: string,
  extensionType: 'extension' | 'modifierExtension',
): boolean {
  const match = XVER_EXTENSION_URL_PATTERN.exec(url);
  if (!match) return false;
  if (extensionType === 'extension') return true;
  const [, version, elementPath] = match;
  return modifierPathsFor(version).has(elementPath.replace(/\[x\]$/, ''));
}
