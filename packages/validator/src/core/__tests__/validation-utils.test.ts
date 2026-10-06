import { describe, expect, it } from "vitest";
import {
  dedupeIssues,
  getValueAtPath,
  suppressRedundantBindingWarnings,
} from "../validation-utils";
import { validationIssue as issue } from "./validation-issue-test-builders";

describe("dedupeIssues", () => {
  it("keeps terminology missing-system issues over duplicate profile copies", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "profile",
        code: "terminology-coding-missing-system",
        severity: "warning",
        path: "Organization.meta.tag[0]",
        resourceType: "Organization",
        message: "Coding has no system",
      }),
      issue({
        aspect: "terminology",
        code: "terminology-coding-missing-system",
        severity: "warning",
        path: "meta.tag[0]",
        resourceType: "Organization",
        message: "Coding has no system",
        details: {
          fieldPath: "meta.tag[0]",
          code: "0057-Claims-Firely-Revamp-June04",
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].aspect).toBe("terminology");
  });

  it("suppresses metadata tag code-without-system info when terminology already reports the missing system", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "terminology",
        code: "terminology-coding-missing-system",
        severity: "warning",
        path: "Coverage.meta.tag[0]",
        resourceType: "Coverage",
        message: "Coding has no system",
        details: {
          fieldPath: "Coverage.meta.tag[0]",
          code: "0057-Claims-Firely-Revamp-June04",
        },
      }),
      issue({
        aspect: "profile",
        code: "metadata-tag-code-without-system",
        severity: "information",
        path: "meta.tag[0]",
        resourceType: "Coverage",
        message: "Tag has code without system at index 0",
        details: {
          fieldPath: "meta.tag[0]",
          index: 0,
          code: "0057-Claims-Firely-Revamp-June04",
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      aspect: "terminology",
      code: "terminology-coding-missing-system",
      path: "Coverage.meta.tag[0]",
    });
  });

  it("prefers profile display mismatch issues over duplicate generic terminology copies", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "terminology",
        code: "terminology-display-mismatch",
        severity: "warning",
        path: "relationship.coding[0]",
        resourceType: "Coverage",
        message: "Display should be Common",
        details: {
          fieldPath: "relationship.coding[0]",
          system:
            "http://terminology.hl7.org/CodeSystem/subscriber-relationship",
          code: "common",
          display: "Common",
          provenance: { sourceExecutor: "terminology" },
        },
      }),
      issue({
        aspect: "profile",
        code: "terminology-display-mismatch",
        severity: "error",
        path: "Coverage.relationship.coding[0].display",
        resourceType: "Coverage",
        message: "Display should be Common",
        details: {
          fieldPath: "Coverage.relationship.coding[0].display",
          system:
            "http://terminology.hl7.org/CodeSystem/subscriber-relationship",
          code: "common",
          display: "Common",
          provenance: { sourceExecutor: "profile" },
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      aspect: "profile",
      severity: "error",
      path: "Coverage.relationship.coding[0].display",
    });
  });
  it("dedupes display mismatch issues when resourceType is only available from the path", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "profile",
        code: "terminology-display-mismatch",
        severity: "error",
        path: "Coverage.relationship.coding[0].display",
        message: "Wrong Display Name Common",
        details: {
          resourceType: "Coverage",
          system:
            "http://terminology.hl7.org/CodeSystem/subscriber-relationship",
          code: "common",
          display: "Common",
        },
      }),
      issue({
        aspect: "profile",
        code: "terminology-display-mismatch",
        severity: "warning",
        path: "Coverage.relationship.coding[0].display",
        message: "Wrong Display Name Common",
        details: {
          system:
            "http://terminology.hl7.org/CodeSystem/subscriber-relationship",
          code: "common",
          display: "Common",
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      severity: "error",
      path: "Coverage.relationship.coding[0].display",
    });
  });

  it("keeps display mismatch issues on distinct coding positions", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "terminology",
        code: "terminology-display-mismatch",
        severity: "warning",
        path: "relationship.coding[0]",
        resourceType: "Coverage",
        message: "Display should be Common",
        details: {
          system:
            "http://terminology.hl7.org/CodeSystem/subscriber-relationship",
          code: "common",
          display: "Common",
        },
      }),
      issue({
        aspect: "terminology",
        code: "terminology-display-mismatch",
        severity: "warning",
        path: "relationship.coding[1]",
        resourceType: "Coverage",
        message: "Display should be Other",
        details: {
          fieldPath: "relationship.coding[1]",
          system:
            "http://terminology.hl7.org/CodeSystem/subscriber-relationship",
          code: "common",
          display: "Other",
        },
      }),
    ]);

    expect(deduped).toHaveLength(2);
  });

  it("dedupes generic and concrete choice-type paths on resources", () => {
    const deduped = dedupeIssues([
      issue({
        code: "terminology-coding-missing-system",
        path: "MedicationRequest.medication[x].coding",
        resourceType: "MedicationRequest",
        message: "Coding has no system",
      }),
      issue({
        code: "terminology-coding-missing-system",
        path: "MedicationRequest.medicationCodeableConcept.coding",
        resourceType: "MedicationRequest",
        message: "Coding has no system",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].path).toBe("MedicationRequest.medication[x].coding");
  });

  it("dedupes generic and concrete choice-type paths in bundle entries", () => {
    const deduped = dedupeIssues([
      issue({
        code: "terminology-coding-missing-system",
        path: "Bundle.entry.resource/*MedicationDispense/d1*/.medication[x].coding",
        resourceType: "Bundle",
        message: "Coding has no system",
      }),
      issue({
        code: "terminology-coding-missing-system",
        path: "Bundle.entry.resource/*MedicationDispense/d1*/.medicationCodeableConcept.coding",
        resourceType: "Bundle",
        message: "Coding has no system",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].path).toBe(
      "Bundle.entry.resource/*MedicationDispense/d1*/.medication[x].coding",
    );
  });

  it("suppresses generic constraint issues when a specific constraint issue exists", () => {
    const deduped = dedupeIssues([
      issue({
        code: "constraint-violation-us-core-7",
        path: "Procedure",
        resourceType: "Procedure",
        message: "Procedure performed is required",
      }),
      issue({
        code: "profile-constraint-violation",
        path: "Procedure",
        resourceType: "Procedure",
        message: "Constraint 'us-core-7' failed",
        ruleId: "us-core-7",
        details: { constraintKey: "us-core-7" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("constraint-violation-us-core-7");
  });

  it("suppresses generic profile constraints when a specific invariant violation code exists", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "invariant",
        code: "pat-1-violation",
        severity: "error",
        path: "Patient.contact[0]",
        resourceType: "Patient",
        message:
          "pat-1: contact SHALL have at least one of name, telecom, address, or organization",
      }),
      issue({
        aspect: "profile",
        code: "profile-constraint-violation",
        severity: "error",
        path: "Patient.contact[0]",
        resourceType: "Patient",
        message: "Constraint 'pat-1' failed",
        ruleId: "pat-1",
        details: { constraintKey: "pat-1", fieldPath: "Patient.contact[0]" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("pat-1-violation");
  });

  it("suppresses generic warning constraints when a specific constraint issue exists", () => {
    const deduped = dedupeIssues([
      issue({
        code: "constraint-violation-us-core-1",
        severity: "warning",
        path: "Condition",
        resourceType: "Condition",
        message: "Condition category should be US Core",
        ruleId: "us-core-1",
      }),
      issue({
        code: "profile-constraint-warning",
        severity: "information",
        path: "Condition",
        resourceType: "Condition",
        message: "Constraint 'us-core-1' failed",
        ruleId: "us-core-1",
        details: { constraintKey: "us-core-1" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("constraint-violation-us-core-1");
  });

  it("suppresses generic dom-6 root warnings when the concrete dom-6 issue exists", () => {
    const deduped = dedupeIssues([
      issue({
        code: "dom-6",
        severity: "info",
        path: "Patient.text",
        resourceType: "Patient",
        message: "A resource should have narrative for robust management",
      }),
      issue({
        code: "profile-constraint-warning",
        severity: "info",
        path: "Patient",
        resourceType: "Patient",
        message:
          "Constraint 'dom-6' failed: A resource should have narrative for robust management",
        ruleId: "dom-6",
        details: { constraintKey: "dom-6" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("dom-6");
  });

  it("preserves dom-6 findings with different rule metadata without actual owner receipts", () => {
    const findings = [
      issue({
        code: "dom-6",
        severity: "info",
        path: "Patient.text",
        resourceType: "Patient",
        message: "A resource should have narrative for robust management",
        ruleId: "dom-6",
        details: { constraintKey: "dom-6" },
      }),
      issue({
        code: "dom-6",
        severity: "info",
        path: "Patient.text",
        resourceType: "Patient",
        message: "A resource should have narrative for robust management",
        tags: ["best-practice", "narrative"],
      }),
    ];
    const before = JSON.stringify(findings);
    const deduped = dedupeIssues(findings);

    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toBe(findings[0]);
    expect(deduped[1]).toBe(findings[1]);
    expect(JSON.stringify(findings)).toBe(before);
  });

  it("dedupes exact dom-6 repeats while retaining the first whole finding", () => {
    const first = issue({
      code: "dom-6", severity: "information", path: "Patient.text",
      resourceType: "Patient", profile: "http://hl7.org/fhir/StructureDefinition/Patient",
      message: "A resource should have narrative for robust management",
      ruleId: "dom-6", details: { constraintKey: "dom-6", expression: "text.`div`.exists()" },
    });
    const repeated = { ...structuredClone(first), id: "repeated-dom6" };
    const before = JSON.stringify([first, repeated]);
    const deduped = dedupeIssues([first, repeated]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toBe(first);
    expect(JSON.stringify([first, repeated])).toBe(before);
  });

  it("keeps generic dom-6 warnings for distinct bundle entries", () => {
    const deduped = dedupeIssues([
      issue({
        code: "dom-6",
        severity: "info",
        path: "Bundle.entry.resource/*Patient/p1*/.text",
        resourceType: "Bundle",
        message: "A resource should have narrative for robust management",
      }),
      issue({
        code: "profile-constraint-warning",
        severity: "info",
        path: "Bundle.entry.resource/*Patient/p1*/",
        resourceType: "Bundle",
        message:
          "Constraint 'dom-6' failed: A resource should have narrative for robust management",
        ruleId: "dom-6",
        details: { constraintKey: "dom-6" },
      }),
      issue({
        code: "profile-constraint-warning",
        severity: "info",
        path: "Bundle.entry.resource/*Condition/c1*/",
        resourceType: "Bundle",
        message:
          "Constraint 'dom-6' failed: A resource should have narrative for robust management",
        ruleId: "dom-6",
        details: { constraintKey: "dom-6" },
      }),
    ]);

    expect(deduped.map((i) => i.path)).toEqual([
      "Bundle.entry.resource/*Patient/p1*/.text",
      "Bundle.entry.resource/*Condition/c1*/",
    ]);
  });

  it("dedupes specific constraint issues when ruleId is missing on one copy", () => {
    const deduped = dedupeIssues([
      issue({
        code: "constraint-violation-us-core-1",
        severity: "warning",
        path: "Condition",
        resourceType: "Condition",
        message: "Condition category should be US Core",
        ruleId: "us-core-1",
      }),
      issue({
        code: "constraint-violation-us-core-1",
        severity: "warning",
        path: "Condition",
        resourceType: "Condition",
        message: "Condition category should be US Core",
        ruleId: undefined,
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].ruleId).toBe("us-core-1");
  });

  it("dedupes generic profile warnings when an invariant-specific issue owns the same constraint key", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "questionnaire-invariant-que-0",
        severity: "warning",
        path: "Questionnaire",
        resourceType: "Questionnaire",
        message: "Constraint failed: que-0",
      }),
      issue({
        aspect: "profile",
        code: "profile-constraint-warning",
        severity: "information",
        path: "Questionnaire",
        resourceType: "Questionnaire",
        message: "Constraint que-0 failed",
        details: { constraintKey: "que-0" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("questionnaire-invariant-que-0");
  });

  it("keeps the canonical cnl-0 warning over the fallback questionnaire que-0 warning", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "questionnaire-invariant-que-0",
        severity: "warning",
        path: "Questionnaire",
        resourceType: "Questionnaire",
        message:
          "Constraint failed: que-0: Name should be usable as an identifier",
      }),
      issue({
        aspect: "structural",
        code: "constraint-violation-cnl-0",
        severity: "warning",
        path: "Questionnaire",
        resourceType: "Questionnaire",
        message:
          "Name should be usable as an identifier for the module by machine processing applications such as code generation",
        ruleId: "cnl-0",
        details: { constraintKey: "cnl-0" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("constraint-violation-cnl-0");
  });

  it("suppresses the weaker que-1b warning when the questionnaire que-1 error exists", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "questionnaire-invariant-que-1",
        severity: "error",
        path: "Questionnaire.item[0]",
        resourceType: "Questionnaire",
        message:
          "Constraint failed: que-1: 'Group items must have nested items, display items cannot have nested items'",
      }),
      issue({
        aspect: "structural",
        code: "constraint-violation-que-1b",
        severity: "warning",
        path: "Questionnaire.item[0]",
        resourceType: "Questionnaire",
        message: "Groups should have items",
        details: {
          constraintKey: "que-1b",
          fieldPath: "Questionnaire.item[0]",
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("questionnaire-invariant-que-1");
  });

  it("suppresses answerOption value cardinality rows under the same item as que-5", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "questionnaire-invariant-que-5",
        path: "Questionnaire.item[2]",
        resourceType: "Questionnaire",
        message:
          "Only answer-capable Questionnaire item types can have answerOption",
        details: { fieldPath: "Questionnaire.item[2]" },
      }),
      issue({
        aspect: "structural",
        code: "structural-cardinality-min",
        path: "Questionnaire.item[2].answerOption[0].value[x]",
        resourceType: "Questionnaire",
        message:
          "Element Questionnaire.item[2].answerOption[0].value[x] has too few values",
        details: {
          fieldPath: "Questionnaire.item[2].answerOption[0].value[x]",
        },
      }),
      issue({
        aspect: "structural",
        code: "structural-cardinality-min",
        path: "Questionnaire.item[3].answerOption[0].value[x]",
        resourceType: "Questionnaire",
        message:
          "Element Questionnaire.item[3].answerOption[0].value[x] has too few values",
        details: {
          fieldPath: "Questionnaire.item[3].answerOption[0].value[x]",
        },
      }),
    ]);

    expect(deduped.map((item) => item.path)).toEqual([
      "Questionnaire.item[2]",
      "Questionnaire.item[3].answerOption[0].value[x]",
    ]);
  });

  it("prefers the explicit German gender extension issue over mii-pat-1 constraints", () => {
    const deduped = dedupeIssues([
      issue({
        code: "constraint-violation-mii-pat-1",
        path: "Patient",
        resourceType: "Patient",
      }),
      issue({
        code: "profile-constraint-violation",
        path: "Patient",
        resourceType: "Patient",
        ruleId: "mii-pat-1",
        details: { constraintKey: "mii-pat-1" },
      }),
      issue({
        code: "profile-extension-missing",
        path: "Patient.gender",
        resourceType: "Patient",
        details: {
          expectedExtension:
            "http://fhir.de/StructureDefinition/gender-amtlich-de",
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("profile-extension-missing");
  });

  it("suppresses required and mustSupport copies when cardinality min already reports the same path", () => {
    const deduped = dedupeIssues([
      issue({
        code: "structural-cardinality-min",
        path: "Patient.identifier.system",
        resourceType: "Patient",
        details: { fieldPath: "Patient.identifier.system" },
      }),
      issue({
        code: "structural-required-element-missing",
        path: "Patient.identifier[0].system",
        resourceType: "Patient",
        details: { fieldPath: "Patient.identifier[0].system" },
      }),
      issue({
        code: "structural-required-element-missing",
        path: "Patient.identifier[0]:memberid.system",
        resourceType: "Patient",
        details: { fieldPath: "Patient.identifier[0]:memberid.system" },
      }),
      issue({
        code: "required-element-missing",
        path: "Patient.identifier.system",
        resourceType: "Patient",
        details: { fieldPath: "Patient.identifier.system" },
      }),
      issue({
        code: "profile-mustsupport-missing",
        path: "Patient.identifier.system",
        resourceType: "Patient",
        details: { fieldPath: "Patient.identifier.system" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("structural-cardinality-min");
  });

  it("keeps questionnaire missing status over generic cardinality min on the same path", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "questionnaire-missing-status",
        path: "Questionnaire.status",
        resourceType: "Questionnaire",
        details: { fieldPath: "Questionnaire.status" },
        message: "Questionnaire.status is required",
      }),
      issue({
        aspect: "structural",
        code: "structural-cardinality-min",
        path: "Questionnaire.status",
        resourceType: "Questionnaire",
        details: { fieldPath: "Questionnaire.status" },
        message: "Element Questionnaire.status has too few values",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("questionnaire-missing-status");
  });

  it("keeps questionnaire response missing status over generic cardinality min on the same path", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "qr-missing-status",
        path: "QuestionnaireResponse.status",
        resourceType: "QuestionnaireResponse",
        details: { fieldPath: "QuestionnaireResponse.status" },
        message: "QuestionnaireResponse.status is required",
      }),
      issue({
        aspect: "structural",
        code: "structural-cardinality-min",
        path: "QuestionnaireResponse.status",
        resourceType: "QuestionnaireResponse",
        details: { fieldPath: "QuestionnaireResponse.status" },
        message: "Element QuestionnaireResponse.status has too few values",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("qr-missing-status");
  });

  it("dedupes generic constraints when a canonical-resource invariant owns the same key", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "canonical-resource-invariant-vsd-0",
        severity: "warning",
        path: "ValueSet",
        resourceType: "ValueSet",
        message:
          "Constraint failed: vsd-0: 'Name should be usable as an identifier for the module by machine processing applications such as code generation'",
      }),
      issue({
        aspect: "profile",
        code: "constraint-violation-vsd-0",
        severity: "warning",
        path: "ValueSet",
        resourceType: "ValueSet",
        ruleId: "vsd-0",
        details: { constraintKey: "vsd-0" },
        message:
          "Name should be usable as an identifier for the module by machine processing applications such as code generation",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("canonical-resource-invariant-vsd-0");
  });

  it("keeps narrative missing div over the generic required text.div row", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-required-element-missing",
        path: "Condition.text.div",
        resourceType: "Condition",
        details: { fieldPath: "Condition.text.div" },
        message: "Required element Condition.text.div is missing",
      }),
      issue({
        aspect: "structural",
        code: "narrative-missing-div",
        path: "Condition.text",
        resourceType: "Condition",
        message:
          "Narrative text must have a div element when status is not empty",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("narrative-missing-div");
  });

  it("retains an independent unowned dom-6 beside narrative missing div", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "profile",
        code: "dom-6",
        severity: "info",
        path: "Encounter.text",
        resourceType: "Encounter",
        message: "A resource should have narrative for robust management",
      }),
      issue({
        aspect: "structural",
        code: "narrative-missing-div",
        severity: "error",
        path: "Encounter.text",
        resourceType: "Encounter",
        message:
          "Narrative text must have a div element when status is not empty",
      }),
    ]);

    expect(deduped.map(row => row.code)).toEqual(["dom-6", "narrative-missing-div"]);
  });

  it("suppresses best-practice presence hints when cardinality min owns the same path", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-cardinality-min",
        severity: "error",
        path: "Encounter.class",
        resourceType: "Encounter",
        details: { fieldPath: "Encounter.class" },
        message: "Element Encounter.class has too few values",
      }),
      issue({
        aspect: "structural",
        code: "best-practice-encounter-class",
        severity: "info",
        path: "Encounter.class",
        resourceType: "Encounter",
        message: "Encounter should have class indicating the type of encounter",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("structural-cardinality-min");
  });
  it("prefers profile extension minimum issues over generic structural extension cardinality", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-cardinality-min",
        path: "ServiceRequest.extension",
        resourceType: "ServiceRequest",
        details: { fieldPath: "ServiceRequest.extension" },
      }),
      issue({
        aspect: "profile",
        code: "profile-extension-min-cardinality",
        path: "ServiceRequest.extension",
        resourceType: "ServiceRequest",
        message:
          "extension 'http://hl7.org.au/fhir/ereq/StructureDefinition/au-erequesting-displaysequence' requires at least 1 instance(s), found 0",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("profile-extension-min-cardinality");
  });

  it("suppresses MustSupport hints when profile extension cardinality owns the same path", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "profile",
        code: "profile-extension-min-cardinality",
        severity: "error",
        path: "Claim.supportingInfo.extension",
        resourceType: "Claim",
        message:
          "Extension 'http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-documentInformation' requires at least 1 instance(s), found 0",
      }),
      issue({
        aspect: "structural",
        code: "profile-mustsupport-missing",
        severity: "info",
        path: "Claim.supportingInfo.extension",
        resourceType: "Claim",
        message:
          "MustSupport element is not populated; verify support or availability when applicable: Claim.supportingInfo.extension",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("profile-extension-min-cardinality");
  });

  it("keeps bdl-10 over duplicate timestamp cardinality rows", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "bdl-10-violation",
        severity: "error",
        path: "Bundle.timestamp",
        resourceType: "Bundle",
        message: "bdl-10: Document Bundle SHALL have a timestamp",
      }),
      issue({
        aspect: "structural",
        code: "structural-cardinality-min",
        severity: "error",
        path: "Bundle.timestamp",
        resourceType: "Bundle",
        details: { fieldPath: "Bundle.timestamp" },
        message:
          "Element Bundle.timestamp has too few values: expected at least 1, found 0",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("bdl-10-violation");
  });

  it("keeps bdl-9 over duplicate identifier presence hints", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "bdl-9-violation",
        severity: "error",
        path: "Bundle.identifier",
        resourceType: "Bundle",
        message:
          "bdl-9: Document Bundle SHALL have an identifier with both system and value",
      }),
      issue({
        aspect: "profile",
        code: "profile-mustsupport-missing",
        severity: "info",
        path: "Bundle.identifier",
        resourceType: "Bundle",
        details: { fieldPath: "Bundle.identifier" },
        message:
          "MustSupport element is not populated; verify support or availability when applicable: Bundle.identifier",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("bdl-9-violation");
  });

  it("keeps resource-specific name invariant over generic canonical name invariants", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "canonical-resource-invariant-cnl-0",
        severity: "warning",
        path: "MessageDefinition",
        resourceType: "MessageDefinition",
        message:
          "Constraint failed: cnl-0: 'Name should be usable as an identifier for the module by machine processing applications such as code generation'",
      }),
      issue({
        aspect: "structural",
        code: "constraint-violation-msd-0",
        severity: "warning",
        path: "MessageDefinition",
        resourceType: "MessageDefinition",
        message:
          "Name should be usable as an identifier for the module by machine processing applications such as code generation",
        details: { fieldPath: "MessageDefinition", constraintKey: "msd-0" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("constraint-violation-msd-0");

    const cliStyleDeduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "canonical-resource-invariant-cnl-0",
        severity: "warning",
        path: "MessageDefinition",
        resourceType: "MessageDefinition",
        message:
          "Constraint failed: cnl-0: 'Name should be usable as an identifier for the module by machine processing applications such as code generation'",
      }),
      issue({
        aspect: "structural",
        code: "profile-constraint-warning",
        severity: "info",
        path: "MessageDefinition",
        resourceType: "MessageDefinition",
        ruleId: "msd-0",
        message:
          "Constraint 'msd-0' failed: Name should be usable as an identifier for the module by machine processing applications such as code generation",
        details: { fieldPath: "MessageDefinition", constraintKey: "msd-0" },
      }),
    ]);

    expect(cliStyleDeduped.map((i) => i.code)).toEqual([
      "profile-constraint-warning",
    ]);

    const searchParameterDeduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "canonical-resource-invariant-spd-0",
        severity: "warning",
        path: "SearchParameter",
        resourceType: "SearchParameter",
        message:
          "Constraint failed: spd-0: 'Name should be usable as an identifier for the module by machine processing applications such as code generation'",
      }),
      issue({
        aspect: "structural",
        code: "constraint-violation-cnl-0",
        severity: "warning",
        path: "SearchParameter",
        resourceType: "SearchParameter",
        message:
          "Name should be usable as an identifier for the module by machine processing applications such as code generation",
        details: { fieldPath: "SearchParameter", constraintKey: "cnl-0" },
      }),
    ]);

    expect(searchParameterDeduped.map((i) => i.code)).toEqual([
      "constraint-violation-cnl-0",
    ]);
  });

  it("keeps duplicate fullUrl diagnostics over generic bdl-7 profile constraints", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "profile",
        code: "profile-constraint-violation",
        severity: "error",
        path: "Bundle",
        resourceType: "Bundle",
        ruleId: "bdl-7",
        details: { constraintKey: "bdl-7", fieldPath: "Bundle" },
        message:
          "Constraint 'bdl-7' failed: FullUrl must be unique in a bundle",
      }),
      issue({
        aspect: "reference",
        code: "reference-bundle-duplicate-fullurl",
        severity: "error",
        path: "Bundle",
        resourceType: "Bundle",
        message:
          "Duplicate fullUrl 'Observation/example' found in entries: 0, 1",
      }),
      issue({
        aspect: "profile",
        code: "profile-constraint-violation",
        severity: "error",
        path: "Bundle",
        resourceType: "Bundle",
        ruleId: "bdl-11",
        details: { constraintKey: "bdl-11", fieldPath: "Bundle" },
        message:
          "Constraint 'bdl-11' failed: A document must have a Composition as the first resource",
      }),
    ]);

    expect(deduped.map((i) => i.code)).toEqual([
      "reference-bundle-duplicate-fullurl",
      "profile-constraint-violation",
    ]);
    expect(deduped[1].ruleId).toBe("bdl-11");
  });

  it("prefers profile slice minimum issues over generic structural cardinality", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-cardinality-min",
        path: "Bundle.entry[0].resource/*Composition*/.section",
        resourceType: "Bundle",
        details: {
          fieldPath: "Bundle.entry[0].resource/*Composition*/.section",
        },
      }),
      issue({
        aspect: "profile",
        code: "profile-slice-min-cardinality",
        path: "Bundle.entry[0].resource/*Composition*/.section",
        resourceType: "Bundle",
        details: {
          fieldPath: "Bundle.entry[0].resource/*Composition*/.section",
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("profile-slice-min-cardinality");
  });

  it("prefers ref-1 invariant errors over duplicate structural reference format warnings", () => {
    const path = "Bundle.entry[7].resource/*Claim/c1*/.provider.reference";
    const deduped = dedupeIssues([
      issue({
        aspect: "invariant",
        code: "ref-1-violation",
        severity: "error",
        path,
        resourceType: "Claim",
        details: { fieldPath: path },
      }),
      issue({
        aspect: "structural",
        code: "reference-invalid-format",
        severity: "warning",
        path,
        resourceType: "Claim",
        details: { fieldPath: path, reference: "provider-1" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("ref-1-violation");
  });

  it("keeps structural reference format issues over generic reference parser copies for the same reference", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "reference",
        code: "invalid-reference-format",
        path: "",
        resourceType: "Patient",
        message: "Invalid reference format: Organization / 675844",
        details: { reference: "Organization / 675844" },
      }),
      issue({
        aspect: "structural",
        code: "reference-invalid-format",
        path: "Patient.identifier[0].assigner.reference",
        resourceType: "Patient",
        message: "Invalid reference format: 'Organization / 675844'",
        details: {
          fieldPath: "Patient.identifier[0].assigner.reference",
          reference: "Organization / 675844",
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("reference-invalid-format");
  });

  it("keeps invalid reference format issues over unresolved bundle copies for the same malformed reference", () => {
    const malformedReference = "Practitioner/0345^ATTEND^SMITH^J";
    const validMissingReference = "Patient/1105";
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "reference-invalid-format",
        severity: "error",
        path: "Bundle.entry[0].resource.author[0].reference",
        resourceType: "Bundle",
        message: `Invalid reference format: '${malformedReference}'`,
        details: {
          fieldPath: "Bundle.entry[0].resource.author[0].reference",
          reference: malformedReference,
        },
      }),
      issue({
        aspect: "structural",
        code: "bundle-cross-entry-reference-missing",
        severity: "error",
        path: "Bundle.entry[0].resource.author[0]",
        resourceType: "Bundle",
        message: `Can't find '${malformedReference}' in the bundle (Composition[0]).`,
        details: {
          fieldPath: "Bundle.entry[0].resource.author[0]",
          reference: malformedReference,
        },
      }),
      issue({
        aspect: "reference",
        code: "reference-bundle-unresolved",
        severity: "error",
        path: "Bundle.entry[0]",
        resourceType: "Bundle",
        message: `Reference '${malformedReference}' in entry[0].author[0].reference not found in Bundle`,
        details: { reference: malformedReference },
      }),
      issue({
        aspect: "structural",
        code: "bundle-cross-entry-reference-missing",
        severity: "error",
        path: "Bundle.entry[3].resource.patient",
        resourceType: "Bundle",
        message: `Can't find '${validMissingReference}' in the bundle (AllergyIntolerance[3]).`,
        details: {
          fieldPath: "Bundle.entry[3].resource.patient",
          reference: validMissingReference,
        },
      }),
    ]);

    expect(deduped.map((i) => i.code)).toEqual([
      "reference-invalid-format",
      "bundle-cross-entry-reference-missing",
    ]);
    expect(
      deduped.map((i) =>
        i.details && typeof i.details === "object" && "reference" in i.details ? i.details.reference : undefined,
      ),
    ).toEqual([malformedReference, validMissingReference]);
  });

  it("keeps structural reference target issues over generic reference type mismatch copies", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "reference",
        code: "reference-type-mismatch",
        path: "Observation.performer[0]",
        resourceType: "Observation",
        message:
          "Reference type 'Encounter' not allowed for Observation.performer",
        details: { reference: "Encounter/example", actualType: "Encounter" },
      }),
      issue({
        aspect: "structural",
        code: "reference-target-type-invalid",
        path: "Observation.performer[0]",
        resourceType: "Observation",
        message:
          "Reference at Observation.performer[0] points at Encounter/...",
        details: { reference: "Encounter/example", actualTarget: "Encounter" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("reference-target-type-invalid");
  });

  it("keeps bundle request missing-url issues over generic required request.url rows for the same entry", () => {
    const path = "Bundle.entry[3].request.url";
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "reference-bundle-request-missing-url",
        path,
        resourceType: "Bundle",
        message: "Entry[3] request missing required 'url'",
        details: { fieldPath: path },
      }),
      issue({
        aspect: "structural",
        code: "structural-required-element-missing",
        path,
        resourceType: "Bundle",
        message: "Required element Bundle.entry[3].request.url is missing",
        details: { fieldPath: path },
      }),
      issue({
        aspect: "structural",
        code: "structural-required-element-missing",
        path: "Bundle.entry[4].request.url",
        resourceType: "Bundle",
        message: "Required element Bundle.entry[4].request.url is missing",
        details: { fieldPath: "Bundle.entry[4].request.url" },
      }),
    ]);

    expect(deduped.map((i) => i.code)).toEqual([
      "reference-bundle-request-missing-url",
      "structural-required-element-missing",
    ]);
    expect(deduped.map((i) => i.path)).toEqual([
      "Bundle.entry[3].request.url",
      "Bundle.entry[4].request.url",
    ]);
  });

  it("keeps precise bundle cross-entry reference issues over generic unresolved bundle reference copies", () => {
    const reference = "Patient/2745d583-e3d1-3f88-8b21-7b59adb60779";
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "bundle-cross-entry-reference-missing",
        severity: "error",
        path: "Bundle.entry[0].resource.subject",
        resourceType: "Bundle",
        message: `Can't find '${reference}' in the bundle (Composition[0]).`,
        details: {
          fieldPath: "Bundle.entry[0].resource.subject",
          reference,
        },
      }),
      issue({
        aspect: "reference",
        code: "reference-bundle-unresolved",
        severity: "error",
        path: "Bundle.entry[0]",
        resourceType: "Bundle",
        message: `Reference '${reference}' in entry[0].subject.reference not found in Bundle`,
        details: { reference },
      }),
      issue({
        aspect: "reference",
        code: "reference-bundle-unresolved",
        severity: "error",
        path: "Bundle.entry[4]",
        resourceType: "Bundle",
        message: `Reference '${reference}' in entry[4].patient.reference not found in Bundle`,
        details: { reference },
      }),
    ]);

    expect(deduped.map((i) => i.code)).toEqual([
      "bundle-cross-entry-reference-missing",
      "reference-bundle-unresolved",
    ]);
    expect(deduped.map((i) => i.path)).toEqual([
      "Bundle.entry[0].resource.subject",
      "Bundle.entry[4]",
    ]);
  });

  it("prefers structural invalid URI issues over duplicate terminology CodeSystem-unresolvable warnings on the same system path", () => {
    const path = "Condition.clinicalStatus.coding[0].system";
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-invalid-uri",
        severity: "error",
        path,
        resourceType: "Condition",
        details: { fieldPath: path, value: "idk" },
      }),
      issue({
        aspect: "terminology",
        code: "terminology-codesystem-unresolvable",
        severity: "warning",
        path,
        resourceType: "Condition",
        details: { fieldPath: path },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("structural-invalid-uri");
  });

  it("prefers invalid Coding.system issues over duplicate terminology CodeSystem-unresolvable warnings on the same system path", () => {
    const path = "Device.type[0].coding[0].system";
    const deduped = dedupeIssues([
      issue({
        aspect: "terminology",
        code: "terminology-code-invalid",
        severity: "error",
        path,
        resourceType: "Device",
        details: {
          code: "33894003",
          system: " http://snomed.info/sct",
          reason: "system-whitespace",
          fieldPath: path,
        },
      }),
      issue({
        aspect: "terminology",
        code: "terminology-codesystem-unresolvable",
        severity: "warning",
        path,
        resourceType: "Device",
        details: { fieldPath: path },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("terminology-code-invalid");
  });

  it("matches structural invalid URI and terminology CodeSystem-unresolvable across choice-type path aliases", () => {
    const structuralPath =
      "MedicationRequest.medicationCodeableConcept.coding[0].system";
    const terminologyPath = "MedicationRequest.medication[x].coding[0].system";
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-invalid-uri",
        severity: "error",
        path: structuralPath,
        resourceType: "MedicationRequest",
        details: { fieldPath: structuralPath, value: "Metaformin" },
      }),
      issue({
        aspect: "terminology",
        code: "terminology-codesystem-unresolvable",
        severity: "warning",
        path: terminologyPath,
        resourceType: "MedicationRequest",
        details: { fieldPath: terminologyPath },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("structural-invalid-uri");
  });

  it("dedupes invalid URI rows for generic and concrete definition choice paths", () => {
    const value = "ActivityDefinition/1001754";
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-invalid-uri",
        severity: "error",
        path: "PlanDefinition.action[0].definition[x]",
        resourceType: "PlanDefinition",
        details: {
          fieldPath: "PlanDefinition.action[0].definition[x]",
          value,
        },
      }),
      issue({
        aspect: "structural",
        code: "structural-invalid-uri",
        severity: "error",
        path: "PlanDefinition.action[0].definitionCanonical",
        resourceType: "PlanDefinition",
        details: {
          fieldPath: "PlanDefinition.action[0].definitionCanonical",
          value,
          expectedUriType: "canonical URL",
          targetResourceType: "ActivityDefinition",
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].path).toBe(
      "PlanDefinition.action[0].definitionCanonical",
    );
  });

  it("suppresses unresolved QuestionnaireResponse questionnaire warnings when the canonical value is structurally invalid", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-invalid-uri",
        severity: "error",
        path: "QuestionnaireResponse.questionnaire",
        resourceType: "QuestionnaireResponse",
        details: {
          fieldPath: "QuestionnaireResponse.questionnaire",
          value: "Questionnaire/24322-0-x",
          expectedUriType: "canonical URL",
        },
      }),
      issue({
        aspect: "structural",
        code: "questionnaire-reference-not-resolved",
        severity: "warning",
        path: "QuestionnaireResponse.questionnaire",
        resourceType: "QuestionnaireResponse",
        details: { questionnaire: "Questionnaire/24322-0-x" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("structural-invalid-uri");
  });

  it("suppresses unresolved profile warnings when meta.profile is structurally invalid", () => {
    const profile =
      "http://h17.org.au/fhir/StructureDefinition/au-diagnostic request";
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-invalid-uri",
        severity: "error",
        path: "Task.meta.profile[0]",
        resourceType: "Task",
        details: {
          fieldPath: "Task.meta.profile[0]",
          value: profile,
          expectedUriType: "canonical URL",
        },
      }),
      issue({
        aspect: "profile",
        code: "profile-not-resolved",
        severity: "warning",
        path: "meta.profile",
        resourceType: "Task",
        details: { profile },
      }),
      issue({
        aspect: "metadata",
        code: "metadata-profile-invalid-url",
        severity: "warning",
        path: "meta.profile[0]",
        resourceType: "Task",
        details: { value: profile },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("structural-invalid-uri");
  });

  it("dedupes invalid URI rows for generic and profiled extension value paths", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "structural-invalid-uri",
        severity: "error",
        path: "Questionnaire.extension[0].value[x]",
        resourceType: "Questionnaire",
        details: {
          fieldPath: "Questionnaire.extension[0].value[x]",
          value: "Library/phq-9-logic",
        },
      }),
      issue({
        aspect: "profile",
        code: "structural-invalid-uri",
        severity: "error",
        path: "Questionnaire.extension[url='http://hl7.org/fhir/StructureDefinition/cqf-library'].valueCanonical",
        resourceType: "Questionnaire",
        details: {
          fieldPath:
            "Questionnaire.extension[url='http://hl7.org/fhir/StructureDefinition/cqf-library'].valueCanonical",
          value: "Library/phq-9-logic",
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].aspect).toBe("profile");
    expect(deduped[0].path).toContain(
      "extension[url='http://hl7.org/fhir/StructureDefinition/cqf-library']",
    );
  });

  it("keeps the stronger contained-resource invariant over contained-unreferenced warnings", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "invalid",
        severity: "error",
        path: "Patient.contained[0]",
        resourceType: "Patient",
        message:
          "The contained resource 'covert' is not referenced to from elsewhere in the containing resource",
        details: { fieldPath: "Patient.contained[0]" },
      }),
      issue({
        aspect: "invariant",
        code: "contained-unreferenced",
        severity: "warning",
        path: "Patient.contained",
        resourceType: "Patient",
        message: "Contained resource 'covert' is not referenced",
        details: { fieldPath: "Patient.contained" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("invalid");
  });

  it("keeps the concrete contained-resource invalid error over a generic profile dom-3 copy", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "profile",
        code: "profile-constraint-violation",
        severity: "error",
        path: "CarePlan",
        resourceType: "CarePlan",
        message:
          "Constraint 'dom-3' failed: contained resource must be referenced",
        ruleId: "dom-3",
        details: {
          constraintKey: "dom-3",
          containedId: "org1",
          fieldPath: "CarePlan",
        },
      }),
      issue({
        aspect: "structural",
        code: "invalid",
        severity: "error",
        path: "CarePlan.contained[0]",
        resourceType: "CarePlan",
        message:
          "The contained resource 'org1' is not referenced to from elsewhere in the containing resource nor does it refer to the containing resource",
        details: { fieldPath: "CarePlan.contained[0]" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("invalid");
  });

  it("keeps contained-resource invalid errors when profile dom-3 names a different contained resource", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "profile",
        code: "profile-constraint-violation",
        severity: "error",
        path: "CarePlan",
        resourceType: "CarePlan",
        message:
          "Constraint 'dom-3' failed: contained resource must be referenced",
        ruleId: "dom-3",
        details: {
          constraintKey: "dom-3",
          containedId: "org1",
          fieldPath: "CarePlan",
        },
      }),
      issue({
        aspect: "structural",
        code: "invalid",
        severity: "error",
        path: "CarePlan.contained[1]",
        resourceType: "CarePlan",
        message:
          "The contained resource 'org2' is not referenced to from elsewhere in the containing resource nor does it refer to the containing resource",
        details: { fieldPath: "CarePlan.contained[1]" },
      }),
    ]);

    expect(deduped).toHaveLength(2);
  });

  it("keeps structural DateTime timezone errors over redundant lastUpdated metadata timezone warnings", () => {
    const path = "Bundle.entry[0].resource/*Composition/c1*/.meta.lastUpdated";
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "invalid",
        severity: "error",
        path,
        resourceType: "Bundle",
        message: "If a date has a time, it must have a timezone",
        details: { expectedType: "dateTime", value: "2026-06-11T08:15:00" },
      }),
      issue({
        aspect: "metadata",
        code: "metadata-last-updated-missing-timezone",
        severity: "warning",
        path,
        resourceType: "Bundle",
        message: "lastUpdated is missing timezone indicator",
        details: { value: "2026-06-11T08:15:00" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("invalid");
  });

  it("keeps required binding violations over redundant AllergyIntolerance presence invariants", () => {
    const path = "AllergyIntolerance.clinicalStatus";
    const deduped = dedupeIssues([
      issue({
        aspect: "invariant",
        code: "ait-1-violation",
        severity: "error",
        path,
        resourceType: "AllergyIntolerance",
        message: "ait-1: AllergyIntolerance.clinicalStatus SHALL be present",
        details: { fieldPath: path },
      }),
      issue({
        aspect: "profile",
        code: "profile-required-binding-violation",
        severity: "error",
        path,
        resourceType: "AllergyIntolerance",
        message: "Value does not satisfy required binding",
        details: { fieldPath: path, textValue: "active" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("profile-required-binding-violation");
  });

  it("keeps extension no-value issues over generic ext-1 constraint rows", () => {
    const path = "Encounter.extension[2].extension[1]";
    const deduped = dedupeIssues([
      issue({
        aspect: "structural",
        code: "profile-constraint-violation",
        severity: "error",
        path,
        resourceType: "Extension",
        message:
          "ext-1 violation: Extension must have either extensions or value[x]",
        details: { fieldPath: path, constraintKey: "ext-1" },
      }),
      issue({
        aspect: "profile",
        code: "profile-extension-no-value",
        severity: "error",
        path,
        resourceType: "Encounter",
        message:
          "Extension 'valor' must have either a value or nested extensions",
        details: { fieldPath: path, url: "valor" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("profile-extension-no-value");
  });
});

describe("getValueAtPath", () => {
  it("treats primitive sidecar extensions as present values", () => {
    const patient = {
      resourceType: "Patient",
      identifier: [
        {
          system: "http://fhir.de/sid/gkv/kvid-10",
          _value: {
            extension: [
              {
                url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
                valueCode: "masked",
              },
            ],
          },
        },
      ],
    };

    expect(getValueAtPath(patient, "Patient.identifier.value")).toEqual({
      extension: [
        {
          url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
          valueCode: "masked",
        },
      ],
    });
  });

  it("treats repeating primitive sidecar arrays as present values", () => {
    const activityDefinition = {
      resourceType: "ActivityDefinition",
      timingTiming: {
        _event: [
          {
            extension: [
              {
                url: "http://hl7.org/fhir/StructureDefinition/cqf-expression",
                valueExpression: {
                  language: "text/cql",
                  expression: "Now()",
                },
              },
            ],
          },
        ],
      },
    };

    expect(
      getValueAtPath(
        activityDefinition,
        "ActivityDefinition.timingTiming.event",
      ),
    ).toEqual({
      extension: [
        {
          url: "http://hl7.org/fhir/StructureDefinition/cqf-expression",
          valueExpression: {
            language: "text/cql",
            expression: "Now()",
          },
        },
      ],
    });
  });

  it("navigates into primitive sidecar extensions when a primitive child path continues", () => {
    const practitioner = {
      resourceType: "Practitioner",
      name: [
        {
          family: "Topp-Gluecklich",
          _family: {
            extension: [
              {
                url: "http://hl7.org/fhir/StructureDefinition/humanname-own-name",
                valueString: "Topp-Gluecklich",
              },
            ],
          },
        },
      ],
    };

    expect(
      getValueAtPath(practitioner, "Practitioner.name.family.extension"),
    ).toEqual({
      url: "http://hl7.org/fhir/StructureDefinition/humanname-own-name",
      valueString: "Topp-Gluecklich",
    });
  });

  it("navigates into repeating primitive sidecar extensions when a primitive array child path continues", () => {
    const practitioner = {
      resourceType: "Practitioner",
      name: [
        {
          prefix: ["Dr. med."],
          _prefix: [
            {
              extension: [
                {
                  url: "http://hl7.org/fhir/StructureDefinition/iso21090-EN-qualifier",
                  valueCode: "AC",
                },
              ],
            },
          ],
        },
      ],
    };

    expect(
      getValueAtPath(practitioner, "Practitioner.name.prefix.extension"),
    ).toEqual({
      url: "http://hl7.org/fhir/StructureDefinition/iso21090-EN-qualifier",
      valueCode: "AC",
    });
  });

  it("resolves primitive choice sidecars for value[x] paths", () => {
    const observation = {
      resourceType: "Observation",
      _valueString: {
        extension: [
          {
            url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
            valueCode: "unknown",
          },
        ],
      },
    };

    expect(getValueAtPath(observation, "Observation.value[x]")).toEqual({
      extension: [
        {
          url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
          valueCode: "unknown",
        },
      ],
    });
  });
});

describe("suppressRedundantBindingWarnings", () => {
  it("suppresses missing required binding issues when structural min cardinality already reports the same path", () => {
    const structuralIssue = issue({
      aspect: "structural",
      code: "structural-cardinality-min",
      path: "Encounter.status",
      message:
        "Element Encounter.status has too few values: expected at least 1, found 0",
    });
    const terminologyIssue = issue({
      aspect: "terminology",
      code: "binding-required-missing",
      path: "Encounter.status",
      message:
        "Required binding for 'Encounter.status' is missing (binding strength: required)",
    });

    expect(
      suppressRedundantBindingWarnings([structuralIssue, terminologyIssue]),
    ).toEqual([structuralIssue]);
  });

  it("suppresses missing required binding issues when a specific presence issue already reports the same path", () => {
    const structuralIssue = issue({
      aspect: "structural",
      code: "questionnaire-missing-status",
      path: "Questionnaire.status",
      message: "Questionnaire.status is required",
    });
    const terminologyIssue = issue({
      aspect: "terminology",
      code: "terminology-binding-missing",
      path: "Questionnaire.status",
      message:
        "Required binding for 'Questionnaire.status' is missing (binding strength: required)",
    });

    expect(
      suppressRedundantBindingWarnings([structuralIssue, terminologyIssue]),
    ).toEqual([structuralIssue]);
  });

  it("suppresses non-required binding warnings when the underlying coding is already invalid", () => {
    const invalidCodeIssue = issue({
      aspect: "terminology",
      severity: "error",
      code: "terminology-code-invalid",
      path: "PlanDefinition.type.coding[0].code",
      message: "Unknown code protocol",
    });
    const extensibleBindingIssue = issue({
      aspect: "terminology",
      severity: "warning",
      code: "terminology-binding-extensible",
      path: "PlanDefinition.type",
      message: "Code is not in extensible ValueSet",
    });

    expect(
      suppressRedundantBindingWarnings([
        invalidCodeIssue,
        extensibleBindingIssue,
      ]),
    ).toEqual([invalidCodeIssue]);
  });

  it("suppresses non-required binding warnings when the underlying coding system is already invalid", () => {
    const invalidSystemIssue = issue({
      aspect: "terminology",
      severity: "error",
      code: "terminology-code-invalid",
      path: "Device.type.coding[0].system",
      message: "System contains whitespace",
    });
    const extensibleBindingIssue = issue({
      aspect: "terminology",
      severity: "warning",
      code: "terminology-binding-extensible",
      path: "Device.type",
      message: "Code is not in extensible ValueSet",
    });

    expect(
      suppressRedundantBindingWarnings([
        invalidSystemIssue,
        extensibleBindingIssue,
      ]),
    ).toEqual([invalidSystemIssue]);
  });

  it("keeps required binding violations when the underlying coding is invalid", () => {
    const invalidCodeIssue = issue({
      aspect: "terminology",
      severity: "error",
      code: "terminology-code-invalid",
      path: "Observation.status.coding[0].code",
      message: "Unknown code final-ish",
    });
    const requiredBindingIssue = issue({
      aspect: "terminology",
      severity: "error",
      code: "terminology-binding-required",
      path: "Observation.status",
      message: "Code is not in required ValueSet",
    });

    expect(
      suppressRedundantBindingWarnings([
        invalidCodeIssue,
        requiredBindingIssue,
      ]),
    ).toEqual([invalidCodeIssue, requiredBindingIssue]);
  });
});
