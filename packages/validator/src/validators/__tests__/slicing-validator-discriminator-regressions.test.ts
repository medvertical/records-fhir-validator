import { describe, expect, it } from "vitest";
import { SlicingValidator } from "../slicing-validator";
import { emitMatchedSliceChildIssues } from "../slicing-content-rules";
import type { StructureDefinition } from "../../core/structure-definition-types";
import { testStructureDefinition } from "./slicing-test-builders";

const validator = new SlicingValidator();

describe("SlicingValidator discriminator regressions", () => {
  it("does not match a max-zero empty-pattern placeholder slice as a wildcard", async () => {
    const profile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "http://example.org/StructureDefinition/closed-coding-slices",
      name: "ClosedCodingSlices",
      status: "active",
      kind: "resource",
      abstract: false,
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.code.coding",
            path: "Observation.code.coding",
            slicing: {
              discriminator: [{ type: "pattern", path: "$this" }],
              rules: "closed",
            },
          } as any,
          {
            id: "Observation.code.coding:prohibited",
            path: "Observation.code.coding",
            sliceName: "prohibited",
            min: 0,
            max: "0",
            patternCoding: {},
          } as any,
          {
            id: "Observation.code.coding:loinc",
            path: "Observation.code.coding",
            sliceName: "loinc",
            min: 1,
            max: "1",
            patternCoding: { system: "http://loinc.org", code: "9217-1" },
          } as any,
        ],
      },
    };

    const issues = await new SlicingValidator().validateSlicing(
      [{ system: "http://snomed.info/sct", code: "251849009" }],
      "Observation.code.coding",
      profile,
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "profile-slice-min-cardinality",
        details: expect.objectContaining({ sliceName: "loinc" }),
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "profile-slice-closed-unmatched",
      }),
    );
    expect(
      issues.filter((issue) => issue.code === "profile-slice-max-cardinality"),
    ).toHaveLength(0);
  });

  it("matches parent slices whose discriminator values live in nested coding slices", async () => {
    const profile = testStructureDefinition({
      url: "http://hl7.org/fhir/StructureDefinition/bp-test",
      name: "BloodPressureTest",
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.component",
            path: "Observation.component",
            slicing: {
              discriminator: [
                { type: "value", path: "code.coding.code" },
                { type: "value", path: "code.coding.system" },
              ],
              rules: "open",
            },
          },
          {
            id: "Observation.component:SystolicBP",
            path: "Observation.component",
            sliceName: "SystolicBP",
            min: 1,
            max: "1",
          },
          {
            id: "Observation.component:SystolicBP.code.coding:SBPCode.code",
            path: "Observation.component.code.coding.code",
            fixedCode: "8480-6",
          },
          {
            id: "Observation.component:SystolicBP.code.coding:SBPCode.system",
            path: "Observation.component.code.coding.system",
            fixedUri: "http://loinc.org",
          },
          {
            id: "Observation.component:DiastolicBP",
            path: "Observation.component",
            sliceName: "DiastolicBP",
            min: 1,
            max: "1",
          },
          {
            id: "Observation.component:DiastolicBP.code.coding:DBPCode.code",
            path: "Observation.component.code.coding.code",
            fixedCode: "8462-4",
          },
          {
            id: "Observation.component:DiastolicBP.code.coding:DBPCode.system",
            path: "Observation.component.code.coding.system",
            fixedUri: "http://loinc.org",
          },
        ],
      },
    });

    const issues = await validator.validateSlicing(
      [
        { code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] } },
        { code: { coding: [{ system: "http://loinc.org", code: "8462-4" }] } },
      ],
      "Observation.component",
      profile,
      undefined,
      "Observation.component",
    );

    expect(
      issues.filter((issue) => issue.code === "profile-slice-min-cardinality"),
    ).toEqual([]);
  });

  it("enforces required children inherited from a Coding type profile", async () => {
    const profileUrl =
      "https://gematik.de/fhir/isik/StructureDefinition/ISiKICD10GMCoding";
    const validatorWithResolver = new SlicingValidator();
    validatorWithResolver.setTypeProfileResolver(async (url) =>
      url === profileUrl
        ? ({
            resourceType: "StructureDefinition",
            url: profileUrl,
            name: "ISiKICD10GMCoding",
            status: "active",
            kind: "complex-type",
            abstract: false,
            type: "Coding",
            snapshot: {
              element: [
                { id: "Coding", path: "Coding" },
                {
                  id: "Coding.system",
                  path: "Coding.system",
                  min: 1,
                  patternUri: "http://fhir.de/CodeSystem/bfarm/icd-10-gm",
                },
                { id: "Coding.version", path: "Coding.version", min: 1 },
              ],
            },
          } as any)
        : null,
    );

    const diagnosisProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "https://gematik.de/fhir/isik/StructureDefinition/ISiKDiagnose",
      name: "ISiKDiagnose",
      status: "active",
      kind: "resource",
      abstract: false,
      type: "Condition",
      snapshot: {
        element: [
          {
            id: "Condition.code.coding",
            path: "Condition.code.coding",
            slicing: {
              discriminator: [{ type: "pattern", path: "$this" }],
              rules: "open",
            },
          },
          {
            id: "Condition.code.coding:ICD-10-GM",
            path: "Condition.code.coding",
            sliceName: "ICD-10-GM",
            min: 0,
            max: "1",
            type: [{ code: "Coding", profile: [profileUrl] }],
            patternCoding: {
              system: "http://fhir.de/CodeSystem/bfarm/icd-10-gm",
            },
          },
        ],
      },
    } as any;

    const issues = await validatorWithResolver.validateSlicing(
      [{ system: "http://fhir.de/CodeSystem/bfarm/icd-10-gm", code: "M17.0" }],
      "Condition.code.coding",
      diagnosisProfile,
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "structural-cardinality-min",
        severity: "error",
        path: "Condition.code.coding[0].version",
      }),
    );
  });

  it("enforces FHIRPath constraints inherited from a matched Coding type profile", async () => {
    const profileUrl =
      "https://gematik.de/fhir/isik/StructureDefinition/ISiKSnomedCTCoding";
    const validatorWithResolver = new SlicingValidator();
    validatorWithResolver.setTypeProfileResolver(async (url) =>
      url === profileUrl
        ? ({
            resourceType: "StructureDefinition",
            url: profileUrl,
            name: "ISiKSnomedCTCoding",
            status: "active",
            kind: "complex-type",
            abstract: false,
            type: "Coding",
            snapshot: {
              element: [
                { id: "Coding", path: "Coding" },
                {
                  id: "Coding.system",
                  path: "Coding.system",
                  patternUri: "http://snomed.info/sct",
                },
                {
                  id: "Coding.version",
                  path: "Coding.version",
                  constraint: [
                    {
                      key: "sct-version-de",
                      severity: "error",
                      human: "The SNOMED CT version must be a German edition",
                      expression:
                        "startsWith('http://snomed.info/sct/11000274103')",
                    },
                  ],
                },
              ],
            },
            differential: {
              element: [
                {
                  id: "Coding.version",
                  path: "Coding.version",
                  constraint: [
                    {
                      key: "sct-version-de",
                      severity: "error",
                      human: "The SNOMED CT version must be a German edition",
                      expression:
                        "startsWith('http://snomed.info/sct/11000274103')",
                    },
                  ],
                },
              ],
            },
          } as any)
        : null,
    );

    const observationProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "https://gematik.de/fhir/isik/StructureDefinition/TestObservation",
      name: "TestObservation",
      status: "active",
      kind: "resource",
      abstract: false,
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.code.coding",
            path: "Observation.code.coding",
            slicing: {
              discriminator: [{ type: "pattern", path: "system" }],
              rules: "open",
            },
          },
          {
            id: "Observation.code.coding:snomed-ct",
            path: "Observation.code.coding",
            sliceName: "snomed-ct",
            min: 0,
            max: "*",
            type: [{ code: "Coding", profile: [profileUrl] }],
          },
        ],
      },
    } as any;

    const issues = await validatorWithResolver.validateSlicing(
      [
        {
          system: "http://snomed.info/sct",
          code: "404684003",
          version: "http://snomed.info/sct/900000000000207008/version/20250101",
        },
      ],
      "Observation.code.coding",
      observationProfile,
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "profile-constraint-violation",
        path: "Observation.code.coding[0].version",
        details: expect.objectContaining({ constraintKey: "sct-version-de" }),
      }),
    );
  });

  it("matches an incomplete Quantity slice and reports its child constraints", async () => {
    const observationProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "http://hl7.org/fhir/StructureDefinition/resprate",
      name: "RespRate",
      status: "active",
      kind: "resource",
      abstract: false,
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.value[x]",
            path: "Observation.value[x]",
            min: 0,
            max: "1",
            slicing: {
              discriminator: [{ type: "type", path: "$this" }],
              rules: "closed",
              ordered: false,
            },
          } as any,
          {
            id: "Observation.value[x]:valueQuantity",
            path: "Observation.value[x]",
            sliceName: "valueQuantity",
            min: 0,
            max: "1",
            type: [{ code: "Quantity" }],
          } as any,
          {
            id: "Observation.value[x]:valueQuantity.unit",
            path: "Observation.value[x].unit",
            min: 1,
            max: "1",
          } as any,
          {
            id: "Observation.value[x]:valueQuantity.code",
            path: "Observation.value[x].code",
            min: 1,
            max: "1",
            fixedCode: "/min",
          } as any,
        ],
      },
    };

    const localValidator = new SlicingValidator();
    const issues = await localValidator.validateSlicing(
      [
        {
          value: 12,
          system: "http://unitsofmeasure.org",
          code: "{Breaths}/min",
        },
      ],
      "Observation.value[x]",
      observationProfile,
    );

    expect(
      issues.find((i) => i.code === "profile-slice-closed-unmatched"),
    ).toBeUndefined();
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "structural-cardinality-min",
          path: "Observation.valueQuantity.unit",
        }),
        expect.objectContaining({
          code: "profile-slice-fixed-value-mismatch",
          path: "Observation.valueQuantity.code",
        }),
      ]),
    );
  });

  it("does not create resource errors from differential-only slices whose inherited discriminator metadata is missing", async () => {
    const incompleteProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Practitioner",
      version: "1.1.0",
      name: "IncompleteKbvPractitioner",
      status: "active",
      kind: "resource",
      abstract: false,
      type: "Practitioner",
      snapshot: {
        element: [
          {
            id: "Practitioner.identifier",
            path: "Practitioner.identifier",
            slicing: {
              discriminator: [{ type: "pattern", path: "type" }],
              rules: "closed",
            },
          } as any,
          {
            id: "Practitioner.identifier:ANR",
            path: "Practitioner.identifier",
            sliceName: "ANR",
            min: 0,
            max: "1",
          } as any,
          {
            id: "Practitioner.identifier:Telematik-ID",
            path: "Practitioner.identifier",
            sliceName: "Telematik-ID",
            min: 0,
            max: "1",
          } as any,
        ],
      },
    };

    const issues = await validator.validateSlicing(
      [
        { type: { coding: [{ code: "LANR" }] }, value: "838382202" },
        { type: { coding: [{ code: "PRN" }] }, value: "1-838382202" },
      ],
      "Practitioner.identifier",
      incompleteProfile,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "profile-slice-validation-incomplete",
      severity: "information",
      details: { reason: "unresolved-discriminator-metadata" },
    });
    expect(issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("does not treat a slice with no evidence for its only discriminator as a wildcard", async () => {
    const partiallyResolvedProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "https://example.org/StructureDefinition/partially-resolved-organization",
      name: "PartiallyResolvedOrganization",
      status: "active",
      kind: "resource",
      abstract: false,
      type: "Organization",
      snapshot: {
        element: [
          {
            id: "Organization.identifier",
            path: "Organization.identifier",
            slicing: {
              discriminator: [{ type: "pattern", path: "type" }],
              rules: "open",
            },
          } as any,
          {
            id: "Organization.identifier:Institutionskennzeichen",
            path: "Organization.identifier",
            sliceName: "Institutionskennzeichen",
            min: 0,
            max: "1",
          } as any,
          {
            id: "Organization.identifier:Betriebsstaettennummer",
            path: "Organization.identifier",
            sliceName: "Betriebsstaettennummer",
            min: 0,
            max: "1",
          } as any,
          {
            id: "Organization.identifier:Betriebsstaettennummer.type",
            path: "Organization.identifier.type",
            patternCodeableConcept: {
              coding: [
                {
                  system: "http://terminology.hl7.org/CodeSystem/v2-0203",
                  code: "BSNR",
                },
              ],
            },
          } as any,
        ],
      },
    };

    const issues = await validator.validateSlicing(
      [
        {
          type: {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v2-0203",
                code: "BSNR",
              },
            ],
          },
        },
        {
          type: {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v2-0203",
                code: "PRN",
              },
            ],
          },
        },
      ],
      "Organization.identifier",
      partiallyResolvedProfile,
    );

    expect(
      issues.find((issue) => issue.code === "profile-slice-max-cardinality"),
    ).toBeUndefined();
    expect(
      issues.find((issue) => issue.code === "profile-slice-closed-unmatched"),
    ).toBeUndefined();
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "profile-slice-validation-incomplete",
        severity: "information",
        details: expect.objectContaining({
          reason: "unresolved-slice-discriminator-metadata",
          unresolvedSliceNames: ["Institutionskennzeichen"],
        }),
      }),
    );
  });

  it("does not report a required primitive child missing when only its sidecar is present", () => {
    const profile = testStructureDefinition({
      url: "http://example.org/StructureDefinition/patient",
      name: "PatientProfile",
      type: "Patient",
      snapshot: {
        element: [
          {
            id: "Patient.identifier:MaskierterVersichertenIdentifer",
            path: "Patient.identifier",
            sliceName: "MaskierterVersichertenIdentifer",
          },
          {
            id: "Patient.identifier:MaskierterVersichertenIdentifer.value",
            path: "Patient.identifier.value",
            min: 1,
          },
        ],
      },
    });

    const issues = emitMatchedSliceChildIssues(
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
      {
        path: "Patient.identifier",
        sliceName: "MaskierterVersichertenIdentifer",
      } as any,
      "Patient.identifier[0]",
      profile,
    );

    expect(issues).toHaveLength(0);
  });

  it("preserves profile context for missing mustSupport slice children", () => {
    const profile = testStructureDefinition({
      url: "http://example.org/StructureDefinition/patient-slice",
      name: "PatientSliceProfile",
      type: "Patient",
      snapshot: {
        element: [
          {
            id: "Patient.name:name",
            path: "Patient.name",
            sliceName: "name",
          },
          {
            id: "Patient.name:name.prefix",
            path: "Patient.name.prefix",
            mustSupport: true,
          },
        ],
      },
    });

    const issues = emitMatchedSliceChildIssues(
      { family: "Example" },
      { path: "Patient.name", sliceName: "name" } as any,
      "Patient.name[0]",
      profile,
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "profile-mustsupport-missing",
        path: "Patient.name[0]:name.prefix",
        profile: "http://example.org/StructureDefinition/patient-slice",
      }),
    );
  });

  it("honors the configured severity for missing mustSupport slice children", () => {
    const profile = testStructureDefinition({
      url: "http://example.org/StructureDefinition/patient-slice",
      name: "PatientSliceProfile",
      type: "Patient",
      snapshot: {
        element: [
          {
            id: "Patient.name:name",
            path: "Patient.name",
            sliceName: "name",
          },
          {
            id: "Patient.name:name.prefix",
            path: "Patient.name.prefix",
            mustSupport: true,
          },
        ],
      },
    });

    const issues = emitMatchedSliceChildIssues(
      { family: "Example" },
      { path: "Patient.name", sliceName: "name" } as any,
      "Patient.name[0]",
      profile,
      "information",
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "profile-mustsupport-missing",
        severity: "information",
      }),
    );
  });

  it("matches value $this slices that constrain the whole Coding with patternCoding", async () => {
    const bodyTemperatureProfile = testStructureDefinition({
      url: "http://nictiz.nl/fhir/StructureDefinition/zib-BodyTemperature",
      name: "ZibBodyTemperature",
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.code.coding",
            path: "Observation.code.coding",
            min: 1,
            max: "*",
            type: [{ code: "Coding" }],
            slicing: {
              discriminator: [{ type: "value", path: "$this" }],
              rules: "open",
            },
          },
          {
            id: "Observation.code.coding:BodyTempCode",
            path: "Observation.code.coding",
            sliceName: "BodyTempCode",
            min: 1,
            max: "1",
            type: [{ code: "Coding" }],
            patternCoding: {
              system: "http://loinc.org",
              code: "8310-5",
            },
          },
        ],
      },
    });

    const issues = await validator.validateSlicing(
      [
        {
          system: "http://loinc.org",
          code: "8310-5",
          display: "Body temperature",
        },
      ],
      "Observation.code.coding",
      bodyTemperatureProfile,
    );

    expect(issues.some((i) => i.code === "profile-slice-min-cardinality")).toBe(
      false,
    );
  });

  it("does not enforce required slices whose type profile is for another FHIR version", async () => {
    const r4ProfileWithR5ExtensionSlice: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "http://example.org/StructureDefinition/r4-procedure",
      name: "R4Procedure",
      status: "draft",
      kind: "resource",
      abstract: false,
      type: "Procedure",
      snapshot: {
        element: [
          {
            id: "Procedure.extension",
            path: "Procedure.extension",
            min: 0,
            max: "*",
            slicing: {
              discriminator: [{ type: "value", path: "url" }],
              rules: "open",
            },
          },
          {
            id: "Procedure.extension:recorded",
            path: "Procedure.extension",
            sliceName: "recorded",
            min: 1,
            max: "1",
            type: [
              {
                code: "Extension",
                profile: [
                  "http://hl7.org/fhir/5.0/StructureDefinition/procedure-recorded",
                ],
              },
            ],
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      [],
      "Procedure.extension",
      r4ProfileWithR5ExtensionSlice,
      null,
      "Procedure.extension",
      "R4",
    );

    expect(
      issues.filter((i) => i.code === "profile-slice-min-cardinality"),
    ).toHaveLength(0);
  });

  it("matches primitive fixedCanonical slices on meta.profile", async () => {
    const kbvPatientProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient",
      name: "KBV_PR_FOR_Patient",
      status: "active",
      kind: "resource",
      abstract: false,
      type: "Patient",
      snapshot: {
        element: [
          {
            id: "Patient.meta.profile",
            path: "Patient.meta.profile",
            min: 1,
            max: "*",
            slicing: {
              discriminator: [{ type: "value", path: "$this" }],
              rules: "open",
            },
          },
          {
            id: "Patient.meta.profile:forProfile",
            path: "Patient.meta.profile",
            sliceName: "forProfile",
            min: 1,
            max: "1",
            fixedCanonical:
              "https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.3",
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      ["https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.3"],
      "Patient.meta.profile",
      kbvPatientProfile,
    );

    expect(
      issues.filter((i) => i.code === "profile-slice-min-cardinality"),
    ).toHaveLength(0);
    expect(issues.filter((i) => i.code?.includes("fixed-value"))).toHaveLength(
      0,
    );
  });

  it("reports a concrete fixedCanonical version mismatch instead of a missing meta.profile slice", async () => {
    const kbvPatientProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient",
      name: "KBV_PR_FOR_Patient",
      status: "active",
      kind: "resource",
      abstract: false,
      type: "Patient",
      snapshot: {
        element: [
          {
            id: "Patient.meta.profile",
            path: "Patient.meta.profile",
            min: 1,
            max: "*",
            slicing: {
              discriminator: [{ type: "value", path: "$this" }],
              rules: "open",
            },
          },
          {
            id: "Patient.meta.profile:forProfile",
            path: "Patient.meta.profile",
            sliceName: "forProfile",
            min: 1,
            max: "1",
            fixedCanonical:
              "https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.3",
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      ["https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.1.0"],
      "Patient.meta.profile",
      kbvPatientProfile,
    );

    expect(
      issues.filter((i) => i.code === "profile-slice-min-cardinality"),
    ).toHaveLength(0);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "profile-slice-fixed-value-mismatch",
        path: "Patient.meta.profile[0]",
        details: expect.objectContaining({
          sliceName: "forProfile",
          expectedValue:
            "https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.3",
          actualValue:
            "https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.1.0",
        }),
      }),
    );
  });

  it("matches value $this slices using child patterns from a Coding type profile", async () => {
    const profileUrl = "http://example.org/StructureDefinition/BodyTempCoding";
    const validatorWithResolver = new SlicingValidator();
    validatorWithResolver.setTypeProfileResolver(async (url) =>
      url === profileUrl
        ? ({
            resourceType: "StructureDefinition",
            url: profileUrl,
            name: "BodyTempCoding",
            status: "draft",
            kind: "complex-type",
            abstract: false,
            type: "Coding",
            snapshot: {
              element: [
                { id: "Coding", path: "Coding" },
                {
                  id: "Coding.system",
                  path: "Coding.system",
                  patternUri: "http://loinc.org",
                },
                {
                  id: "Coding.code",
                  path: "Coding.code",
                  patternCode: "8310-5",
                },
              ],
            },
          } as any)
        : null,
    );

    const bodyTemperatureProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "http://nictiz.nl/fhir/StructureDefinition/zib-BodyTemperature",
      name: "ZibBodyTemperature",
      status: "draft",
      kind: "resource",
      abstract: false,
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.code.coding",
            path: "Observation.code.coding",
            min: 1,
            max: "*",
            type: [{ code: "Coding" }],
            slicing: {
              discriminator: [{ type: "value", path: "$this" }],
              rules: "open",
            },
          },
          {
            id: "Observation.code.coding:BodyTempCode",
            path: "Observation.code.coding",
            sliceName: "BodyTempCode",
            min: 1,
            max: "1",
            type: [{ code: "Coding", profile: [profileUrl] }],
          },
        ],
      },
    } as any;

    const issues = await validatorWithResolver.validateSlicing(
      [
        {
          system: "http://loinc.org",
          code: "8310-5",
          display: "Body temperature",
        },
      ],
      "Observation.code.coding",
      bodyTemperatureProfile,
    );

    expect(issues.some((i) => i.code === "profile-slice-min-cardinality")).toBe(
      false,
    );
  });
});
