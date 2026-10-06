import { describe, expect, it } from 'vitest';
import { validateUriFormat } from '../uri-format-validator';

describe('validateUriFormat', () => {
  it('suggests urn:oid for bare OID values', () => {
    const issue = validateUriFormat(
      '2.16.840.1.113883.6.88',
      'Observation.identifier[0].system',
      'Observation',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      details: expect.objectContaining({
        value: '2.16.840.1.113883.6.88',
        suggestedUri: 'urn:oid:2.16.840.1.113883.6.88',
        fixHint: expect.stringContaining('urn:oid:2.16.840.1.113883.6.88'),
      }),
    }));
  });

  // 1.1 and 1.2 are syntactically well-formed but, like the reference
  // validator, treated as registration-authority roots rather than namespaces.
  it.each(['urn:oid:1', 'urn:oid:1.40.3', 'urn:oid:2.03.4', 'urn:oid:1.1', 'urn:oid:1.2'])(
    'rejects syntactically invalid OID URIs: %s',
    (value) => {
      expect(validateUriFormat(
        value,
        'DocumentReference.contained[1].identifier[0].system',
        'DocumentReference',
      )).toEqual(expect.objectContaining({
        code: 'structural-invalid-uri',
        severity: 'error',
        details: expect.objectContaining({
          value,
          expectedUriType: 'OID URN',
        }),
      }));
    },
  );

  it('accepts valid OID URIs', () => {
    expect(validateUriFormat(
      'urn:oid:1.2.840.10008.2.16.4',
      'DocumentReference.identifier[0].system',
      'DocumentReference',
    )).toBeNull();

    expect(validateUriFormat(
      'urn:oid:2.999.3',
      'DocumentReference.identifier[0].system',
      'DocumentReference',
    )).toBeNull();

    expect(validateUriFormat(
      'urn:oid:1.3.6',
      'DocumentReference.contained[1].identifier[0].system',
      'DocumentReference',
    )).toBeNull();
  });

  it.each([
    ['urn:uuid:questionnaire', 'Bundle.entry[0].fullUrl'],
    ['urn:uuid:questionnaire', 'Bundle.entry[2].resource.questionnaire'],
    ['urn:uuid:C757873D-EC9A-4326-A141-556F43239520', 'Observation.code.coding[0].system'],
  ])('rejects the urn:uuid %s at %s', (value, path) => {
    expect(validateUriFormat(value, path, 'Bundle')).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
      details: expect.objectContaining({ value, expectedUriType: 'UUID URN' }),
    }));
  });

  it.each([
    'urn:uuid:c757873d-ec9a-4326-a141-556f43239520',
    'urn:uuid:c757873d-ec9a-4326-a141-556f43239520#contained',
    'urn:uuid:c757873d-ec9a-4326-a141-556f43239520|1.0',
  ])('accepts the urn:uuid %s', (value) => {
    expect(validateUriFormat(value, 'QuestionnaireResponse.questionnaire', 'QuestionnaireResponse')).toBeNull();
  });

  it('does not hide invalid OIDs in Coding.system relative-URI paths', () => {
    expect(validateUriFormat(
      'urn:oid:1',
      'Observation.code.coding[0].system',
      'Observation',
    )).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
    }));
  });

  it('suggests an https URI for www-prefixed values without a scheme', () => {
    const issue = validateUriFormat(
      'www.uwearme.com/measures',
      'Observation.identifier[0].system',
      'Observation',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      details: expect.objectContaining({
        value: 'www.uwearme.com/measures',
        suggestedUri: 'https://www.uwearme.com/measures',
        fixHint: expect.stringContaining('https://www.uwearme.com/measures'),
      }),
    }));
  });

  it('keeps generic absolute URI guidance when there is no safe direct rewrite', () => {
    const issue = validateUriFormat(
      'any_data_to_fhir/tags',
      'Observation.identifier[0].system',
      'Observation',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      details: expect.objectContaining({
        value: 'any_data_to_fhir/tags',
        fixHint: expect.stringContaining('absolute URI'),
      }),
    }));
    expect(issue?.details).not.toHaveProperty('suggestedUri');
  });

  it('does not report structural invalid-uri for Coding.system values', () => {
    expect(validateUriFormat(
      'GPI',
      'Medication.code.coding[1].system',
      'Medication',
    )).toBeNull();

    expect(validateUriFormat(
      '357',
      'MedicationDispense.medication.concept.coding[0].system',
      'MedicationDispense',
    )).toBeNull();

    expect(validateUriFormat(
      'Custom',
      'Questionnaire.item[0].code[0].system',
      'Questionnaire',
    )).toBeNull();

    expect(validateUriFormat(
      'Custom',
      'Questionnaire.item[0].answerOption[0].valueCoding.system',
      'Questionnaire',
    )).toBeNull();

    expect(validateUriFormat(
      'docattr_documentsubtype',
      'DocumentReference.meta.tag[2].system',
      'DocumentReference',
    )).toBeNull();

    expect(validateUriFormat(
      'local-security-labels',
      'Patient.meta.security[0].system',
      'Patient',
    )).toBeNull();
  });

  it('allows relative type names and element paths in StructureDefinition.type', () => {
    expect(validateUriFormat(
      'Patient',
      'StructureDefinition.type',
      'StructureDefinition',
    )).toBeNull();

    expect(validateUriFormat(
      'Address.city',
      'StructureDefinition.type',
      'StructureDefinition',
    )).toBeNull();
  });

  it('allows relative uri values in ValueSet expansion parameters', () => {
    expect(validateUriFormat(
      'false',
      'ValueSet.expansion.parameter[0].value[x]',
      'ValueSet',
    )).toBeNull();
  });

  it('allows FHIR type names in operationdefinition-allowed-type extensions', () => {
    expect(validateUriFormat(
      'Questionnaire',
      'OperationDefinition.parameter[1].extension[0].value[x]',
      'OperationDefinition',
    )).toBeNull();

    expect(validateUriFormat(
      'Reference',
      'OperationDefinition.parameter[3].part[1].extension[0].value[x]',
      'OperationDefinition',
    )).toBeNull();
  });

  it('allows relative Expression.reference URI values', () => {
    expect(validateUriFormat(
      'cql/QuestionnaireLogicLibrary|1.0',
      'PlanDefinition.action[0].condition[0].expression.reference',
      'PlanDefinition',
    )).toBeNull();
  });

  it('allows known relative FHIR resource names in Reference.type fields', () => {
    expect(validateUriFormat(
      'Patient',
      'DocumentReference.context.related[0].type',
      'DocumentReference',
    )).toBeNull();
  });

  it('classifies unknown relative Reference.type values as reference warnings', () => {
    const issue = validateUriFormat(
      'vendor-defined',
      'DocumentReference.context.related[1].type',
      'DocumentReference',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'reference-type-unknown',
      aspect: 'reference',
      severity: 'warning',
      path: 'DocumentReference.context.related[1].type',
      details: expect.objectContaining({
        value: 'vendor-defined',
        referencedResourceType: 'vendor-defined',
      }),
    }));
  });

  it('does not treat DataRequirement.type values as Reference.type', () => {
    expect(validateUriFormat(
      'Coding',
      'EvidenceVariable.characteristic[0].definitionDataRequirement.type',
      'EvidenceVariable',
    )).toBeNull();

    expect(validateUriFormat(
      'Observation',
      'Library.dataRequirement[0].type',
      'Library',
    )).toBeNull();
  });

  it('allows relative FHIR type codes in action and trigger data requirements', () => {
    expect(validateUriFormat(
      'Patient',
      'PlanDefinition.action[0].input[0].type',
      'PlanDefinition',
    )).toBeNull();

    expect(validateUriFormat(
      'Coding',
      'TriggerDefinition.data[0].type',
      'SubscriptionTopic',
    )).toBeNull();
  });

  it('still rejects relative canonical values', () => {
    const issue = validateUriFormat(
      'Questionnaire/patient-create',
      'QuestionnaireResponse.questionnaire',
      'QuestionnaireResponse',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
      details: expect.objectContaining({
        expectedUriType: 'canonical URL',
        targetResourceType: 'Questionnaire',
        fixHint: expect.stringContaining('Questionnaire.url canonical'),
      }),
    }));
  });

  it('rejects canonical URLs that contain raw whitespace', () => {
    const issue = validateUriFormat(
      'http://h17.org.au/fhir/StructureDefinition/au-diagnostic request',
      'Task.meta.profile[0]',
      'Task',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
      message: expect.stringContaining('contains whitespace'),
      details: expect.objectContaining({
        value: 'http://h17.org.au/fhir/StructureDefinition/au-diagnostic request',
        fixHint: expect.stringContaining('without spaces'),
      }),
    }));
  });

  it('explains relative Library references in canonical library fields', () => {
    const issue = validateUriFormat(
      'Library/example',
      'PlanDefinition.library[0]',
      'PlanDefinition',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
      details: expect.objectContaining({
        value: 'Library/example',
        expectedUriType: 'canonical URL',
        targetResourceType: 'Library',
        fixHint: 'Use the target Library.url canonical, not the relative FHIR REST reference \'Library/example\'.',
      }),
    }));
  });

  it('explains relative definitional resources in RelatedArtifact.resource fields', () => {
    const issue = validateUriFormat(
      'ActivityDefinition/referralPrimaryCareMentalHealth',
      'PlanDefinition.relatedArtifact[1].resource',
      'PlanDefinition',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
      details: expect.objectContaining({
        expectedUriType: 'canonical URL',
        targetResourceType: 'ActivityDefinition',
        fixHint: expect.stringContaining('ActivityDefinition.url canonical'),
      }),
    }));
  });

  it('allows relative MessageDefinition eventUri references', () => {
    expect(validateUriFormat(
      '/EventDefinition/496974',
      'MessageDefinition.eventUri',
      'MessageDefinition',
    )).toBeNull();
  });

  it('rejects relative MessageDefinition canonical references', () => {
    const focusProfileIssue = validateUriFormat(
      'StructureDefinition/example',
      'MessageDefinition.focus[0].profile',
      'MessageDefinition',
    );

    expect(focusProfileIssue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
    }));

    const allowedResponseIssue = validateUriFormat(
      'MessageDefinition/external-admission-response',
      'MessageDefinition.allowedResponse[0].message',
      'MessageDefinition',
    );

    expect(allowedResponseIssue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
    }));
  });

  it('allows relative ValueSet expansion metadata URI values', () => {
    expect(validateUriFormat(
      'false',
      'ValueSet.expansion.parameter[0].valueUri',
      'ValueSet',
    )).toBeNull();

    expect(validateUriFormat(
      '1VIjyWcSttwwslSbQ1M09huH',
      'ValueSet.expansion.identifier',
      'ValueSet',
    )).toBeNull();

    expect(validateUriFormat(
      'codesystems/SNOMEDCT-CH/2022-06-07',
      'ValueSet.expansion.contains[0].system',
      'ValueSet',
    )).toBeNull();
  });

  it('allows FHIR resource names in TestScript operation resource fields', () => {
    expect(validateUriFormat(
      'Patient',
      'TestScript.setup.action[0].operation.resource',
      'TestScript',
    )).toBeNull();

    expect(validateUriFormat(
      'Observation',
      'TestScript.test[0].action[0].operation.resource',
      'TestScript',
    )).toBeNull();

    expect(validateUriFormat(
      'Encounter',
      'TestScript.teardown.action[0].operation.resource',
      'TestScript',
    )).toBeNull();
  });

  it('allows FHIR resource names in TestScript assert resource fields', () => {
    expect(validateUriFormat(
      'Patient',
      'TestScript.setup.action[0].assert.resource',
      'TestScript',
    )).toBeNull();

    expect(validateUriFormat(
      'Bundle',
      'TestScript.test[0].action[2].assert.resource',
      'TestScript',
    )).toBeNull();
  });

  it('allows relative TestReport detail and participant URI values observed in Java baselines', () => {
    expect(validateUriFormat(
      'Parameters/10918768-c4ed-4798-b8c4-3dbe557fcf15/_history/1',
      'TestReport.setup.action[0].operation.detail',
      'TestReport',
    )).toBeNull();

    expect(validateUriFormat(
      'Bundle/bfeccc8a-94df-4037-84f9-e73137059d40/_history/1',
      'TestReport.test[0].action[0].assert.detail',
      'TestReport',
    )).toBeNull();

    expect(validateUriFormat(
      'pandoraUrl',
      'TestReport.participant[0].uri',
      'TestReport',
    )).toBeNull();
  });

  it('allows relative URIs in extension valueUri values (Java parity)', () => {
    // PDex mTLS endpoint examples carry scheme-less IG references.
    expect(validateUriFormat(
      'hl7.org/fhir/us/davinci-pdex',
      "Endpoint.extension[url='http://hl7.org/fhir/us/davinci-pdex/StructureDefinition/base-ext-endpoint-usecase'].extension[url='standard'].valueUri",
      'Endpoint',
    )).toBeNull();

    expect(validateUriFormat(
      'hl7.org/fhir/us/davinci-pdex',
      'Endpoint.extension[0].extension[1].valueUri',
      'Endpoint',
    )).toBeNull();
  });

  it('allows relative ElementDefinition ids in Questionnaire item definitions', () => {
    expect(validateUriFormat(
      'Patient.birthDate',
      'Questionnaire.item[1].definition',
      'Questionnaire',
    )).toBeNull();

    expect(validateUriFormat(
      'a9e99fcf535a4c08a249c77754d5b07d',
      'Questionnaire.item[0].item[1].definition',
      'Questionnaire',
    )).toBeNull();
  });

  it('allows relative element-path tokens in ArtifactAssessment content paths', () => {
    expect(validateUriFormat(
      'overallSummary',
      'ArtifactAssessment.content[0].path[0]',
      'ArtifactAssessment',
    )).toBeNull();

    // content.component recurses content, so nested comment paths end in component.path
    expect(validateUriFormat(
      'identifier',
      'ArtifactAssessment.content[4].component[3].path[0]',
      'ArtifactAssessment',
    )).toBeNull();
  });

  it('allows relative policy identifiers in AuditEvent.agent.policy', () => {
    expect(validateUriFormat(
      '_5a6b51b7-cd3e-4629-aac8-9846cbc3cf84',
      'AuditEvent.agent[0].policy[0]',
      'AuditEvent',
    )).toBeNull();
  });

  it('keeps the absolute-URI requirement outside extension values', () => {
    expect(validateUriFormat(
      'hl7.org/fhir/us/davinci-pdex',
      'Questionnaire.url',
      'Questionnaire',
    )).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
    }));

    // valueCanonical stays a canonical slot even inside extensions.
    expect(validateUriFormat(
      'ValueSet/some-local-id',
      'Endpoint.extension[0].valueCanonical',
      'Endpoint',
    )).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
    }));
  });

  // smart-r4 ClinicalImpression/3689267: a plain uri may be relative.
  it.each([
    ['QuestionnaireResponse/3689263', 'ClinicalImpression.protocol[0]'],
    ['contracts/terms', 'Contract.url'],
  ])('accepts the relative uri %s at %s', (value, path) => {
    expect(validateUriFormat(value, path, path.split('.')[0])).toBeNull();
  });

  it.each([
    ['ValueSet/local', 'Questionnaire.item[0].answerValueSet', 'canonical'],
    ['length', 'Questionnaire.contained[0].url', 'uri'],
    ['ValueSet/local', 'Bundle.entry[1].resource.url', 'uri'],
  ] as const)('requires an absolute %s at %s', (value, path, primitiveType) => {
    expect(validateUriFormat(value, path, path.split('.')[0], undefined, primitiveType)).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      severity: 'error',
    }));
  });
});
