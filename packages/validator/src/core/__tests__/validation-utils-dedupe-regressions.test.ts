import { describe, expect, it } from "vitest";
import {
  dedupeExactIssues,
  dedupeIssues,
  dedupeIssuesWithTrace,
  dedupeResourceTreeIssues,
} from "../validation-utils";
import { validationIssue as issue } from "./validation-issue-test-builders";

describe("validation issue dedupe regressions", () => {
  it("can remove exact child copies without re-running cross-code suppression", () => {
    const dom3 = issue({
      aspect: "profile",
      code: "profile-constraint-violation",
      severity: "error",
      path: "Patient",
      message: "Constraint 'dom-3' failed",
      details: { constraintKey: "dom-3", containedId: "null" },
    });
    const structural = issue({
      aspect: "structural",
      code: "invalid",
      severity: "error",
      path: "Patient.contained[3]",
      message: "The contained resource 'null' is not referenced",
    });

    expect(dedupeExactIssues([dom3, structural, { ...structural }])).toEqual([
      dom3,
      structural,
    ]);
  });

  it("treats info and information as the same severity when deduping", () => {
    const deduped = dedupeIssues([
      issue({
        code: "dom-6",
        severity: "info",
        path: "Patient.text",
        resourceType: "Patient",
        message: "A resource should have narrative for robust management",
      }),
      issue({
        code: "dom-6",
        severity: "information",
        path: "Patient.text",
        resourceType: "Patient",
        message: "A resource should have narrative for robust management",
      }),
    ]);

    expect(deduped).toHaveLength(1);
  });

  it("prefers a contained CodeSystem canonical diagnostic over a generic URI copy", () => {
    const specific = issue({
      aspect: "terminology",
      code: "tx-codesystem-url-not-absolute",
      severity: "error",
      path: "ValueSet.contained[0].url",
      message: "Canonical URLs in contained resources must be absolute URLs",
    });
    const generic = issue({
      aspect: "structural",
      code: "structural-invalid-uri",
      severity: "error",
      path: "ValueSet.contained[0].url",
      message: "URI 'c1' is not a valid absolute URI",
    });

    expect(dedupeIssues([specific, generic])).toEqual([specific]);
  });

  it("uses rebased resource-tree paths instead of stale child fieldPath details", () => {
    const specific = issue({
      code: "tx-codesystem-url-not-absolute",
      path: "ValueSet.contained[0].url",
      details: { fieldPath: "ValueSet.contained[0].url" },
    });
    const recursive = issue({
      code: "structural-invalid-uri",
      path: "ValueSet.contained[0].url",
      details: { fieldPath: "CodeSystem.url", originalPath: "CodeSystem.url" },
    });

    expect(dedupeResourceTreeIssues([specific, recursive])).toEqual([specific]);
  });

  it("dedupes the same missing slice child reported by structural and profile walks", () => {
    const message =
      "Element Patient.identifier[0].system has too few values: expected at least 1, found 0";
    const deduped = dedupeIssues([
      {
        id: "structural-copy",
        aspect: "structural",
        severity: "error",
        code: "structural-cardinality-min",
        message,
        path: "Patient.identifier[0].system",
        profile: "http://example.org/Patient",
        timestamp: new Date(),
        details: { min: 1, actual: 0 },
      },
      {
        id: "slice-copy",
        aspect: "profile",
        severity: "error",
        code: "structural-cardinality-min",
        message,
        path: "Patient.identifier[0].system",
        profile: "http://example.org/Patient|2.0.0",
        timestamp: new Date(),
        details: { sliceName: "memberid", expectedMin: 1, actualCount: 0 },
      },
    ]);

    expect(deduped).toHaveLength(1);
  });

  it("prefers a rebased Bundle child cardinality over the parent slice copy", () => {
    const parentSlice = issue({
      aspect: "structural",
      code: "structural-cardinality-min",
      severity: "error",
      path: "Bundle.entry[4].resource.effective[x]",
      resourceType: "Bundle",
      message:
        "Element Bundle.entry[4].resource.effective[x] has too few values: expected at least 1, found 0",
      details: { sliceName: "medicationstatement", expectedMin: 1, actualCount: 0 },
    });
    const rebasedChild = issue({
      aspect: "structural",
      code: "structural-cardinality-min",
      severity: "error",
      path: "Bundle.entry[4].resource/*MedicationStatement/example*/.effective[x]",
      resourceType: "Bundle",
      message:
        "Element MedicationStatement.effective[x] has too few values: expected at least 1, found 0",
      details: { min: 1, actual: 0 },
    });

    expect(dedupeIssues([parentSlice, rebasedChild])).toEqual([rebasedChild]);
  });

  it("prefers the CodeSystem property diagnostic over its generic Coding duplicate", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "terminology",
        code: "terminology-code-invalid",
        severity: "error",
        path: "CodeSystem.concept[1].property[0].valueCoding.code",
        resourceType: "CodeSystem",
        message: "Unknown code",
        details: { system: "http://example.org/cs", code: "missing" },
      }),
      issue({
        aspect: "terminology",
        code: "tx-codesystem-concept-property-code-invalid",
        severity: "error",
        path: "CodeSystem.concept[1].property[0].value.ofType(Coding).code",
        resourceType: "CodeSystem",
        message: "Unknown property code",
        details: { system: "http://example.org/cs", code: "missing" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe("tx-codesystem-concept-property-code-invalid");
  });

  it("dedupes the same contained issue with and without navigation comments", () => {
    const deduped = dedupeIssues([
      issue({
        code: "structural-invalid-id",
        severity: "error",
        path: "Condition.contained[0]/*Practitioner/too-long*/.id",
        resourceType: "Condition",
        message: "Invalid Resource id: Too long",
      }),
      issue({
        code: "structural-invalid-id",
        severity: "error",
        path: "Condition.contained[0].id",
        resourceType: "Condition",
        message: "Invalid Resource id: Too long",
      }),
    ]);

    expect(deduped).toHaveLength(1);
  });

  it("suppresses generic presence advice when MustSupport already owns the same missing path", () => {
    const mustSupport = issue({
      aspect: "profile",
      code: "profile-mustsupport-missing",
      severity: "info",
      path: "Observation.effective[x]",
      resourceType: "Observation",
    });
    const bestPractice = issue({
      aspect: "structural",
      code: "best-practice-missing-effective",
      severity: "info",
      path: "Observation.effective[x]",
      resourceType: "Observation",
    });

    const traced = dedupeIssuesWithTrace([bestPractice, mustSupport]);

    expect(traced.issues).toEqual([mustSupport]);
    expect(traced.suppressions).toContainEqual({
      ruleId: "mustsupport-over-best-practice-presence",
      issue: bestPractice,
    });
  });

  it("keeps one extension max-cardinality issue when generic slicing reports the same excess", () => {
    const extensionIssue = issue({
      aspect: "profile",
      code: "profile-extension-max-cardinality",
      severity: "error",
      path: "PractitionerRole.extension",
      resourceType: "PractitionerRole",
      details: {
        url: "http://example.test/StructureDefinition/network-reference",
        max: "1",
        found: 2,
      },
    });
    const sliceIssue = issue({
      aspect: "profile",
      code: "profile-slice-max-cardinality",
      severity: "error",
      path: "PractitionerRole.extension",
      resourceType: "PractitionerRole",
      details: {
        sliceName: "network-reference",
        max: "1",
        actual: 2,
      },
    });

    const traced = dedupeIssuesWithTrace([sliceIssue, extensionIssue]);

    expect(traced.issues).toEqual([extensionIssue]);
    expect(traced.suppressions).toContainEqual({
      ruleId: "extension-max-over-slice-max",
      issue: sliceIssue,
    });
  });

  it("reports the suppression rule when tracing dedupe decisions", () => {
    const specific = issue({
      code: "questionnaire-missing-status",
      path: "Questionnaire.status",
      message: "Questionnaire.status is required",
    });
    const generic = issue({
      code: "structural-cardinality-min",
      path: "Questionnaire.status",
      message: "Questionnaire.status is required",
    });

    const traced = dedupeIssuesWithTrace([specific, generic]);

    expect(traced.issues).toEqual([specific]);
    expect(traced.suppressions).toEqual([
      {
        ruleId: "specific-required-over-cardinality-min",
        issue: generic,
      },
    ]);
  });

  it("preserves distinct slice issues on the same path", () => {
    const deduped = dedupeIssues([
      issue({ ruleId: "slice-min-Slice1", details: { sliceName: "Slice1" } }),
      issue({ ruleId: "slice-min-Slice2", details: { sliceName: "Slice2" } }),
      issue({ ruleId: "slice-min-Slice1", details: { sliceName: "Slice1" } }),
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((i) => i.ruleId)).toEqual([
      "slice-min-Slice1",
      "slice-min-Slice2",
    ]);
  });

  it("preserves same slice issues that originate from different imposed profiles", () => {
    const deduped = dedupeIssues([
      issue({
        ruleId: "slice-min-composition-conformance",
        path: "Bundle",
        details: {
          sliceName: "composition",
          sourceProfile:
            "http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps",
        },
      }),
      issue({
        ruleId: "slice-min-composition-conformance",
        path: "Bundle",
        details: {
          sliceName: "composition",
          sourceProfile:
            "http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips",
        },
      }),
    ]);

    expect(deduped).toHaveLength(2);
  });

  it("dedupes equivalent resource-prefixed and relative paths", () => {
    const deduped = dedupeIssues([
      issue({
        code: "terminology-code-invalid",
        severity: "warning",
        path: "Organization.meta.tag",
        resourceType: "Organization",
        details: { resourceType: "Organization" },
      }),
      issue({
        code: "terminology-code-invalid",
        severity: "warning",
        path: "meta.tag",
        resourceType: "Organization",
        details: { resourceType: "Organization" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
  });

  it("dedupes abstract and indexed MustSupport paths for the same missing element", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "profile",
        code: "profile-mustsupport-missing",
        severity: "info",
        path: "ServiceRequest.category.coding.display",
        resourceType: "ServiceRequest",
        message:
          "MustSupport element is not populated; verify support or availability when applicable: ServiceRequest.category.coding.display",
      }),
      issue({
        aspect: "profile",
        code: "profile-mustsupport-missing",
        severity: "info",
        path: "ServiceRequest.category[0].coding[0].display",
        resourceType: "ServiceRequest",
        message:
          "MustSupport element is not populated; verify support or availability when applicable: ServiceRequest.category[0].coding[0].display",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].path).toBe("ServiceRequest.category.coding.display");
  });

  it("prefers slice-specific MustSupport issues over generic copies in the same bundle entry", () => {
    const deduped = dedupeIssues([
      issue({
        aspect: "profile",
        code: "profile-mustsupport-missing",
        severity: "info",
        path: "Bundle.entry[1].resource/*Patient/p1*/.name.prefix",
        resourceType: "Patient",
        details: {
          fieldPath: "Patient.name.prefix",
          bundleUnit: {
            entryIndex: 1,
            resourceType: "Patient",
            resourceId: "p1",
          },
        },
      }),
      issue({
        aspect: "profile",
        code: "profile-mustsupport-missing",
        severity: "warning",
        path: "Bundle.entry[1].resource/*Patient/p1*/.name[0]:name.prefix",
        resourceType: "Patient",
        details: {
          sliceName: "name",
          fieldPath: "Patient.name[0]:name.prefix",
          bundleUnit: {
            entryIndex: 1,
            resourceType: "Patient",
            resourceId: "p1",
          },
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].path).toBe(
      "Bundle.entry[1].resource/*Patient/p1*/.name[0]:name.prefix",
    );
    expect(deduped[0].severity).toBe("warning");
  });
});
