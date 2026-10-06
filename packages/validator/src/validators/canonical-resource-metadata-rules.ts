/**
 * Metadata rules the reference validator applies to every canonical resource:
 * its status agrees with the standards-status extension, its version holds no
 * '#', and one published under http://hl7.org/fhir/ names one known HL7 work
 * group whose publisher and committee page it carries. A missing nomination
 * is required only in the explicit publication policy (with the SID exception). Publisher and page are
 * compared leniently, so the official variants the core packages use
 * ("Health Level Seven International (Patient Administration)",
 * ".../pafm/index.cfm") pass.
 */

import type { ValidationIssue, ValidationSeverity } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

const WG_EXTENSION = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-wg';
const STANDARDS_STATUS_EXTENSION = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status';
const COMMITTEE_PAGES = 'http://www.hl7.org/Special/committees/';

/** The reference validator's HL7 work groups: name, alternative name, committee page. */
const HL7_WORK_GROUPS: Record<string, readonly [string, string | null, string]> = {
  aid: ['Application Implementation and Design', null, 'java'],
  arden: ['Arden Syntax', null, 'arden'],
  brr: ['Biomedical Research and Regulation', null, 'rcrim'],
  cbcc: ['Community Based Collaborative Care', null, 'cbcc'],
  cdamg: ['CDA Management Group', null, 'cdamg'],
  cds: ['Clinical Decision Support', null, 'dss'],
  cg: ['Clinical Genomics', null, 'clingenomics'],
  cgp: ['Cross-Group Projects', null, 'cgp'],
  cic: ['Clinical Interoperability Council', null, 'cic'],
  cimi: ['Clinical Information Modeling Initiative', null, 'cimi'],
  claims: ['Payer/Provider Information Exchange Work Group', null, 'claims'],
  cqi: ['Clinical Quality Information', null, 'cqi'],
  dev: ['Devices', null, 'healthcaredevices'],
  ehr: ['Electronic Health Records', null, 'ehr'],
  ec: ['Emergency Care', null, 'emergencycare'],
  fhir: ['FHIR Infrastructure', null, 'fiwg'],
  fmg: ['FHIR Management Group', null, 'fhirmg'],
  fm: ['Financial Management', null, 'fm'],
  hsi: ['Health Standards Integration', null, 'hsi'],
  hsswg: ['Human and Social Services', null, 'hsswg'],
  hta: ['Terminology Authority', null, 'termauth'],
  ictc: ['Conformance', null, 'ictc'],
  ii: ['Imaging Integration', null, 'imagemgt'],
  inm: ['Infrastructure And Messaging', null, 'inm'],
  its: ['Implementable Technology Specifications', null, 'xml'],
  lhs: ['Learning Health Systems', null, 'lhs'],
  mnm: ['Modeling and Methodology', null, 'mnm'],
  mobile: ['Mobile Health', null, 'mobile'],
  oo: ['Orders and Observations', null, 'orders'],
  pa: ['Patient Administration', null, 'pafm'],
  pe: ['Patient Empowerment', null, 'patientempowerment'],
  pc: ['Patient Care', null, 'patientcare'],
  pher: ['Public Health', null, 'pher'],
  phx: ['Pharmacy', null, 'medication'],
  sd: ['Structured Documents', null, 'structure'],
  sec: ['Security', null, 'secure'],
  soa: ['Services Oriented Architecture', null, 'soa'],
  ti: ['Terminology Infrastructure', 'Vocabulary', 'Vocab'],
  tsmg: ['Terminology Services Management Group (TSMG)', null, 'tsmg'],
  us: ['US Realm Steering Committee', null, 'usrealm'],
  v2: ['V2 Management Group', null, 'v2management'],
  vocab: ['Terminology Infrastructure', 'Vocabulary', 'Vocab'],
};

/** The publication statuses each standards status allows. */
const STANDARDS_STATUS_ALLOWS: Record<string, readonly string[]> = {
  draft: ['draft'],
  normative: ['active'],
  'trial-use': ['draft', 'active'],
  informative: ['draft', 'active', 'retired'],
  deprecated: ['retired'],
  withdrawn: ['retired'],
  external: ['draft', 'active', 'retired'],
};

const CANONICAL_RESOURCE_TYPES = new Set([
  'ActivityDefinition', 'ActorDefinition', 'CapabilityStatement', 'ChargeItemDefinition', 'Citation', 'CodeSystem',
  'CompartmentDefinition', 'ConceptMap', 'ConditionDefinition', 'EffectEvidenceSynthesis', 'EventDefinition',
  'Evidence', 'EvidenceReport', 'EvidenceVariable', 'ExampleScenario', 'GraphDefinition', 'ImplementationGuide',
  'Library', 'Measure', 'MessageDefinition', 'NamingSystem', 'ObservationDefinition', 'OperationDefinition',
  'PlanDefinition', 'Questionnaire', 'Requirements', 'ResearchDefinition', 'ResearchElementDefinition',
  'RiskEvidenceSynthesis', 'SearchParameter', 'SpecimenDefinition', 'StructureDefinition', 'StructureMap',
  'SubscriptionTopic', 'TerminologyCapabilities', 'TestPlan', 'TestScript', 'ValueSet',
]);

type FhirRecord = Record<string, unknown>;

export function validateCanonicalResourceMetadata(
  resource: FhirRecord,
  options: { forPublication?: boolean } = {},
): ValidationIssue[] {
  const resourceType = resource.resourceType;
  if (typeof resourceType !== 'string' || !CANONICAL_RESOURCE_TYPES.has(resourceType)) return [];
  const issues: ValidationIssue[] = [];
  const report = (code: string, message: string, severity: ValidationSeverity) => {
    issues.push(createValidationIssue({ code, path: resourceType, resourceType, customMessage: message, severityOverride: severity }));
  };

  const standardsStatus = extensionsOf(resource, STANDARDS_STATUS_EXTENSION)[0]?.valueCode;
  const allowed = typeof standardsStatus === 'string' ? STANDARDS_STATUS_ALLOWS[standardsStatus] : undefined;
  if (allowed && typeof resource.status === 'string' && resource.status && !allowed.includes(resource.status)) {
    report('business-rule-sd-status-consistency',
      `The resource status '${resource.status}' and the standards status '${standardsStatus}' are not consistent`, 'warning');
  }
  if (typeof resource.version === 'string' && resource.version.includes('#')) {
    report('business-rule-version-hash', `Version '${resource.version}' contains a '#', which is problematic, as this `
      + 'character is used in some URLs to separate the version and the fragment id', 'warning');
  }
  if (typeof resource.url === 'string' && resource.url.startsWith('http://hl7.org/fhir/')) {
    workGroupFindings(resource, options.forPublication === true).forEach(([code, message, severity]) => report(code, message, severity));
  }
  return issues;
}

function workGroupFindings(resource: FhirRecord, forPublication: boolean): Array<[string, string, ValidationSeverity]> {
  const findings: Array<[string, string, ValidationSeverity]> = [];
  const nominations = extensionsOf(resource, WG_EXTENSION);
  if (nominations.length > 1) {
    findings.push(['business-rule-wg-multiple', `This resource has more than one workgroup extension (${WG_EXTENSION})`, 'error']);
  }
  const wg = nominations[0]?.valueCode;
  if (typeof wg !== 'string') {
    // HL7 publication policy is stricter than the extension's FHIR min=0.
    if (forPublication && !(typeof resource.url === 'string' && resource.url.includes('http://hl7.org/fhir/sid'))) {
      findings.push(['business-rule-wg-missing',
        `When HL7 is publishing a resource, it must declare its work group using ${WG_EXTENSION}`, 'error']);
    }
    return findings;
  }
  const group = Object.hasOwn(HL7_WORK_GROUPS, wg) ? HL7_WORK_GROUPS[wg] : undefined;
  if (!group) return [...findings, ['business-rule-wg-unknown', `The nominated WG '${wg}' is unknown`, 'error']];

  const [name, alternative, page] = group;
  const publishers = [name, alternative].filter((value): value is string => value !== null)
    .map(value => `HL7 International / ${value}`);
  const publisher = typeof resource.publisher === 'string' ? resource.publisher : '';
  if (!publisher) {
    findings.push(['business-rule-wg-publisher-missing',
      `When HL7 is publishing a resource, the publisher must be provided, and for WG '${wg}' it should be '${publishers[0]}'`, 'warning']);
  } else if (!publishers.some(expected => normalizePublisher(expected) === normalizePublisher(publisher))) {
    const expectation = publishers.length > 1 ? `either '${publishers.join("' or '")}'` : `'${publishers[0]}'`;
    // One that names an HL7 group ("… / …") and gets it wrong is an error.
    findings.push(['business-rule-wg-publisher',
      `The nominated WG '${wg}' means that the publisher should be ${expectation} but '${publisher}' was found`,
      publisher.includes('/') ? 'error' : 'warning']);
  }
  const committeePage = `${COMMITTEE_PAGES}${page}`;
  if (!contactUrls(resource.contact).some(url => isCommitteePage(url, committeePage))) {
    findings.push(['business-rule-wg-contact',
      `The nominated WG '${wg}' means that the contact url should be '${committeePage}' but it was not found`, 'warning']);
  }
  return findings;
}

function extensionsOf(resource: FhirRecord, url: string): FhirRecord[] {
  return records(resource.extension).filter(extension => extension.url === url);
}

function contactUrls(contacts: unknown): string[] {
  return records(contacts).flatMap(contact => records(contact.telecom))
    .filter(telecom => telecom.system === 'url' && typeof telecom.value === 'string')
    .map(telecom => telecom.value as string);
}

function normalizePublisher(value: string): string {
  return value.toLowerCase()
    .replace(/\bhealth\s+level\s+seven\b/g, 'hl7')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isCommitteePage(actual: string, expected: string): boolean {
  const normalizedActual = normalizePage(actual);
  const normalizedExpected = normalizePage(expected);
  return normalizedActual === normalizedExpected || normalizedActual.startsWith(`${normalizedExpected}/`);
}

function normalizePage(value: string): string {
  return value.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/index\.(cfm|html?)$/, '')
    .replace(/\/$/, '');
}

function records(value: unknown): FhirRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is FhirRecord => typeof item === 'object' && item !== null && !Array.isArray(item))
    : [];
}
