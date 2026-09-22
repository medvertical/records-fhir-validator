/**
 * Extension Validator Tests
 */

import { describe, it, expect, vi } from "vitest";
import { ExtensionValidator } from "../extension-validator";
import { ExtensionUrlResolver } from "../extension-url-resolver";
import { getValueAtPath } from "../../core/validation-utils";
import type {
  StructureDefinition,
  ElementDefinition,
} from "../../core/structure-definition-types";

// Minimal mocks for required constructor deps
const mockSdLoader = { loadProfile: vi.fn() } as any;
const mockTypeValidator = { validate: vi.fn().mockResolvedValue([]) } as any;
const mockValueSetValidator = {
  validate: vi.fn().mockResolvedValue([]),
} as any;
const mockElementRulesValidator = {
  validate: vi.fn().mockReturnValue([]),
} as any;

describe("ExtensionValidator", () => {
  const validator = new ExtensionValidator(
    mockSdLoader,
    mockTypeValidator,
    mockValueSetValidator,
    mockElementRulesValidator,
  );

  it("scopes extension resolvability by FHIR version and retries prior misses", async () => {
    const extensionUrl = "http://example.org/StructureDefinition/versioned-extension";
    const loadProfile = vi
      .fn()
      .mockResolvedValueOnce({ resourceType: "StructureDefinition" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ resourceType: "StructureDefinition" });
    const resolver = new ExtensionUrlResolver({ loadProfile } as any);

    await expect(resolver.resolveKnown(extensionUrl, "R4")).resolves.toBe("resolvable");
    await expect(resolver.resolveKnown(extensionUrl, "R5")).resolves.toBe("unresolvable");
    await expect(resolver.resolveKnown(extensionUrl, "R5")).resolves.toBe("resolvable");
    expect(loadProfile).toHaveBeenCalledTimes(3);
  });

  // Mock UK Core Patient profile with birthSex extension
  const mockUKCorePatientProfile: StructureDefinition = {
    resourceType: "StructureDefinition",
    url: "https://fhir.hl7.org.uk/StructureDefinition/UKCore-Patient",
    name: "UKCorePatient",
    status: "active",
    kind: "resource",
    abstract: false,
    type: "Patient",
    snapshot: {
      element: [
        {
          id: "Patient",
          path: "Patient",
          min: 0,
          max: "*",
        },
        {
          id: "Patient.extension:birthSex",
          path: "Patient.extension",
          sliceName: "birthSex",
          min: 0,
          max: "1",
          type: [
            {
              code: "Extension",
              profile: [
                "https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex",
              ],
            },
          ],
        } as ElementDefinition,
      ],
    },
  };

  function makeContext(resource: any, profileSD: StructureDefinition) {
    return {
      resource,
      profileSD,
      strictMode: false,
      fhirVersion: "R4" as const,
      profileUrl: profileSD.url,
      getValueAtPath: (res: any, path: string) => getValueAtPath(res, path),
    };
  }

  describe("validateExtensions", () => {
    it("does not expose extension validator exception text", async () => {
      const secret = "postgresql://user:password@example.test/private";
      const brokenProfile = { ...mockUKCorePatientProfile };
      Object.defineProperty(brokenProfile, "snapshot", {
        get() {
          throw new Error(secret);
        },
      });
      const resource = { resourceType: "Patient", extension: [] };

      const issues = await validator.validateExtensions(
        resource,
        brokenProfile,
        makeContext(resource, brokenProfile),
      );

      expect(issues).toContainEqual(expect.objectContaining({
        code: "profile-extension-validation-error",
        message:
          "Extension validation could not be completed because the validator encountered an operational error.",
      }));
      expect(JSON.stringify(issues)).not.toContain(secret);
    });

    it("preserves universal issues when profile-scoped validation fails", async () => {
      const extensionUrl = "http://example.org/StructureDefinition/partial-failure";
      const extensionProfile: StructureDefinition = {
        resourceType: "StructureDefinition",
        url: extensionUrl,
        name: "PartialFailureExtension",
        status: "active",
        kind: "complex-type",
        abstract: false,
        type: "Extension",
        snapshot: {
          element: [{ id: "Extension", path: "Extension", min: 0, max: "*" }],
        },
      };
      const patientProfile: StructureDefinition = {
        ...mockUKCorePatientProfile,
        snapshot: {
          element: [
            mockUKCorePatientProfile.snapshot!.element[0],
            {
              id: "Patient.extension:partialFailure",
              path: "Patient.extension",
              sliceName: "partialFailure",
              min: 0,
              max: "1",
              type: [{ code: "Extension", profile: [extensionUrl] }],
            },
          ],
        },
      };
      const isolatedValidator = new ExtensionValidator(
        { loadProfile: vi.fn().mockResolvedValue(extensionProfile) } as any,
        mockTypeValidator,
        mockValueSetValidator,
        mockElementRulesValidator,
        { execute: vi.fn().mockRejectedValue(new Error("pipeline failure")) } as any,
      );
      const resource = {
        resourceType: "Patient",
        extension: [{
          url: extensionUrl,
          valueString: "value",
          extension: [{ url: "nested", valueString: "nested" }],
        }],
      };

      const issues = await isolatedValidator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      expect(issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "profile-extension-value-and-nested" }),
        expect.objectContaining({ code: "profile-extension-validation-error" }),
      ]));
    });

    it("should validate valid extension", async () => {
      const resource = {
        resourceType: "Patient",
        id: "test-patient",
        extension: [
          {
            url: "https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex",
            valueCode: "M",
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        mockUKCorePatientProfile,
        makeContext(resource, mockUKCorePatientProfile),
      );

      // Should have no structural errors (URL/structure/cardinality)
      const structuralErrors = issues.filter(
        (i) =>
          i.severity === "error" &&
          (i.code === "profile-extension-url-missing" ||
            i.code === "profile-extension-no-value" ||
            i.code === "profile-extension-value-and-nested" ||
            i.code === "profile-extension-min-cardinality" ||
            i.code === "profile-extension-max-cardinality"),
      );
      expect(structuralErrors).toHaveLength(0);
    });

    it("should detect extension without URL", async () => {
      const resource = {
        resourceType: "Patient",
        id: "test-patient",
        extension: [
          {
            // Missing url
            valueCode: "M",
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        mockUKCorePatientProfile,
        makeContext(resource, mockUKCorePatientProfile),
      );

      // Should have error about missing URL
      const urlErrors = issues.filter(
        (i) =>
          i.code === "profile-extension-url-missing" && i.severity === "error",
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it("should detect extension with both value and nested extensions", async () => {
      const resource = {
        resourceType: "Patient",
        id: "test-patient",
        extension: [
          {
            url: "https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex",
            valueCode: "M",
            extension: [{ url: "nested", valueString: "invalid" }],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        mockUKCorePatientProfile,
        makeContext(resource, mockUKCorePatientProfile),
      );

      // Should have error about both value and nested
      const bothErrors = issues.filter(
        (i) =>
          i.code === "profile-extension-value-and-nested" &&
          i.severity === "error",
      );
      expect(bothErrors.length).toBeGreaterThan(0);
    });

    it("should detect extension without value or nested extensions", async () => {
      const resource = {
        resourceType: "Patient",
        id: "test-patient",
        extension: [
          {
            url: "https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex",
            // Missing value and nested extensions
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        mockUKCorePatientProfile,
        makeContext(resource, mockUKCorePatientProfile),
      );

      // Should have error about no value
      const noValueErrors = issues.filter(
        (i) =>
          i.code === "profile-extension-no-value" && i.severity === "error",
      );
      expect(noValueErrors.length).toBeGreaterThan(0);
    });

    it("should validate modifier extensions", async () => {
      const resource = {
        resourceType: "Patient",
        id: "test-patient",
        modifierExtension: [
          {
            url: "http://example.org/fhir/StructureDefinition/modifier-ext",
            valueBoolean: true,
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        mockUKCorePatientProfile,
        makeContext(resource, mockUKCorePatientProfile),
      );

      // Should process without crashing
      expect(Array.isArray(issues)).toBe(true);
    });

    it("should check for required extensions", async () => {
      // Create profile with required extension
      const profileWithRequired: StructureDefinition = {
        ...mockUKCorePatientProfile,
        snapshot: {
          element: [
            {
              id: "Patient",
              path: "Patient",
              min: 0,
              max: "*",
            },
            {
              id: "Patient.extension:required",
              path: "Patient.extension",
              sliceName: "required",
              min: 1, // Required
              max: "1",
              type: [
                {
                  code: "Extension",
                  profile: ["http://example.org/required-extension"],
                },
              ],
            } as ElementDefinition,
          ],
        },
      };

      const resource = {
        resourceType: "Patient",
        id: "test-patient",
        // Missing required extension
      };

      const issues = await validator.validateExtensions(
        resource,
        profileWithRequired,
        makeContext(resource, profileWithRequired),
      );

      // Should have error about missing required extension
      const requiredErrors = issues.filter(
        (i) =>
          i.code === "profile-extension-min-cardinality" &&
          i.severity === "error",
      );
      expect(requiredErrors.length).toBeGreaterThan(0);
      expect(requiredErrors[0]).toMatchObject({
        resourceType: "Patient",
        details: expect.objectContaining({ resourceType: "Patient" }),
      });
    });

    it("does not enforce required extension slices from another FHIR version", async () => {
      const r4ProfileWithR5Extension: StructureDefinition = {
        resourceType: "StructureDefinition",
        url: "http://example.org/profile/procedure-with-r5-extension",
        name: "ProcedureWithR5Extension",
        status: "active",
        kind: "resource",
        abstract: false,
        type: "Procedure",
        snapshot: {
          element: [
            { id: "Procedure", path: "Procedure", min: 0, max: "*" },
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
                    "http://hl7.org/fhir/5.0/StructureDefinition/extension-Procedure.recorded",
                  ],
                },
              ],
            } as ElementDefinition,
          ],
        },
      };
      const resource = {
        resourceType: "Procedure",
        id: "procedure-without-r5-recorded",
      };

      const issues = await validator.validateExtensions(
        resource,
        r4ProfileWithR5Extension,
        makeContext(resource, r4ProfileWithR5Extension),
      );

      expect(
        issues.filter((i) => i.code === "profile-extension-min-cardinality"),
      ).toHaveLength(0);
    });

    it("matches required extension slices declared with versioned profile canonicals", async () => {
      const profileWithVersionedExtension: StructureDefinition = {
        resourceType: "StructureDefinition",
        url: "http://example.org/profile/patient-versioned-extension",
        name: "PatientWithVersionedExtension",
        status: "active",
        kind: "resource",
        abstract: false,
        type: "Patient",
        snapshot: {
          element: [
            { id: "Patient", path: "Patient", min: 0, max: "*" },
            {
              id: "Patient.name.given.extension:qualifier",
              path: "Patient.name.given.extension",
              sliceName: "qualifier",
              min: 1,
              max: "1",
              type: [
                {
                  code: "Extension",
                  profile: [
                    "http://hl7.org/fhir/StructureDefinition/iso21090-EN-qualifier|5.2.0",
                  ],
                },
              ],
            } as ElementDefinition,
          ],
        },
      };
      const resource = {
        resourceType: "Patient",
        id: "p1",
        name: [
          {
            given: ["Hendrik"],
            _given: [
              {
                extension: [
                  {
                    url: "http://hl7.org/fhir/StructureDefinition/iso21090-EN-qualifier",
                    valueCode: "BR",
                  },
                ],
              },
            ],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        profileWithVersionedExtension,
        makeContext(resource, profileWithVersionedExtension),
      );

      expect(
        issues.filter((i) => i.code === "profile-extension-min-cardinality"),
      ).toHaveLength(0);
    });

    it("should validate extension cardinality", async () => {
      const resource = {
        resourceType: "Patient",
        id: "test-patient",
        extension: [
          {
            url: "https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex",
            valueCode: "M",
          },
          {
            url: "https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex",
            valueCode: "F",
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        mockUKCorePatientProfile,
        makeContext(resource, mockUKCorePatientProfile),
      );

      // Should have error about max cardinality (max=1)
      const cardinalityErrors = issues.filter(
        (i) =>
          i.code === "profile-extension-max-cardinality" &&
          i.severity === "error",
      );
      expect(cardinalityErrors.length).toBeGreaterThan(0);
    });

    it("applies extension cardinality only from matching parent slices", async () => {
      const profileWithAddressSlices: StructureDefinition = {
        resourceType: "StructureDefinition",
        url: "http://example.org/profile/patient-address-slices",
        name: "PatientAddressSlices",
        status: "active",
        kind: "resource",
        abstract: false,
        type: "Patient",
        snapshot: {
          element: [
            { id: "Patient", path: "Patient", min: 0, max: "*" },
            {
              id: "Patient.address:Strassenanschrift",
              path: "Patient.address",
              sliceName: "Strassenanschrift",
            } as ElementDefinition,
            {
              id: "Patient.address:Strassenanschrift.type",
              path: "Patient.address.type",
              patternCode: "both",
            } as ElementDefinition,
            {
              id: "Patient.address:Strassenanschrift.line.extension:Strasse",
              path: "Patient.address.line.extension",
              sliceName: "Strasse",
              min: 0,
              max: "1",
              type: [
                {
                  code: "Extension",
                  profile: [
                    "http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-streetName",
                  ],
                },
              ],
            } as ElementDefinition,
            {
              id: "Patient.address:Strassenanschrift.line.extension:Postfach",
              path: "Patient.address.line.extension",
              sliceName: "Postfach",
              min: 0,
              max: "0",
              type: [
                {
                  code: "Extension",
                  profile: [
                    "http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-postBox",
                  ],
                },
              ],
            } as ElementDefinition,
            {
              id: "Patient.address:Postfach",
              path: "Patient.address",
              sliceName: "Postfach",
            } as ElementDefinition,
            {
              id: "Patient.address:Postfach.type",
              path: "Patient.address.type",
              patternCode: "postal",
            } as ElementDefinition,
            {
              id: "Patient.address:Postfach.line.extension:Strasse",
              path: "Patient.address.line.extension",
              sliceName: "Strasse",
              min: 0,
              max: "0",
              type: [
                {
                  code: "Extension",
                  profile: [
                    "http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-streetName",
                  ],
                },
              ],
            } as ElementDefinition,
            {
              id: "Patient.address:Postfach.line.extension:Postfach",
              path: "Patient.address.line.extension",
              sliceName: "Postfach",
              min: 1,
              max: "1",
              type: [
                {
                  code: "Extension",
                  profile: [
                    "http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-postBox",
                  ],
                },
              ],
            } as ElementDefinition,
          ],
        },
      };
      const resource = {
        resourceType: "Patient",
        address: [
          {
            type: "both",
            line: ["Musterstr. 1"],
            _line: [
              {
                extension: [
                  {
                    url: "http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-streetName",
                    valueString: "Musterstr.",
                  },
                ],
              },
            ],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        profileWithAddressSlices,
        makeContext(resource, profileWithAddressSlices),
      );

      const addressCardinalityErrors = issues.filter(
        (i) =>
          (i.code === "profile-extension-min-cardinality" ||
            i.code === "profile-extension-max-cardinality") &&
          i.path === "Patient.address.line.extension",
      );
      expect(addressCardinalityErrors).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Deep nested extension validation (PRD §6.1 "Deep Extension Validation")
  // ==========================================================================

  describe("deep nested extension validation", () => {
    const PARENT_URL = "http://example.org/ext/complex-parent";

    // Parent extension profile with two sub-extension slices:
    //   - required: min=1 max=1
    //   - optional: min=0 max=*
    const parentProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: PARENT_URL,
      name: "ComplexParent",
      status: "active",
      kind: "complex-type",
      abstract: false,
      type: "Extension",
      snapshot: {
        element: [
          {
            id: "Extension",
            path: "Extension",
            min: 0,
            max: "*",
          } as ElementDefinition,
          {
            id: "Extension.extension:required",
            path: "Extension.extension",
            sliceName: "required",
            min: 1,
            max: "1",
            type: [{ code: "Extension" }],
          } as unknown as ElementDefinition,
          {
            id: "Extension.extension:required.url",
            path: "Extension.extension.url",
            min: 1,
            max: "1",
            fixedUri: "required-sub",
          } as unknown as ElementDefinition,
          {
            id: "Extension.extension:required.value[x]",
            path: "Extension.extension.value[x]",
            min: 1,
            max: "1",
            type: [{ code: "Coding" }],
            binding: {
              strength: "required",
              valueSet: "http://example.org/ValueSet/required-sub",
            },
          } as ElementDefinition,
          {
            id: "Extension.extension:optional",
            path: "Extension.extension",
            sliceName: "optional",
            min: 0,
            max: "*",
            type: [{ code: "Extension" }],
            fixedUri: "optional-sub",
          } as unknown as ElementDefinition,
        ],
      },
    };

    // Host Patient profile declaring the parent extension
    const patientProfile: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "http://example.org/profile/patient",
      name: "DeepExtPatient",
      status: "active",
      kind: "resource",
      abstract: false,
      type: "Patient",
      snapshot: {
        element: [
          { id: "Patient", path: "Patient", min: 0, max: "*" },
          {
            id: "Patient.extension:complex",
            path: "Patient.extension",
            sliceName: "complex",
            min: 0,
            max: "1",
            type: [
              {
                code: "Extension",
                profile: [PARENT_URL],
              },
            ],
          } as ElementDefinition,
        ],
      },
    };

    function makeDeepValidator() {
      const sdLoader = {
        loadProfile: vi.fn(async (url: string) => {
          if (url === PARENT_URL) return parentProfile;
          return null;
        }),
      } as any;
      const typeValidator = { validate: vi.fn().mockResolvedValue([]) } as any;
      const valueSetValidator = {
        validate: vi.fn().mockResolvedValue([]),
        validateBinding: vi.fn().mockResolvedValue([]),
      } as any;
      const elementRulesValidator = {
        validate: vi.fn().mockReturnValue([]),
      } as any;
      return new ExtensionValidator(
        sdLoader,
        typeValidator,
        valueSetValidator,
        elementRulesValidator,
      );
    }

    it("reports a missing required sub-extension", async () => {
      const validator = makeDeepValidator();
      const resource = {
        resourceType: "Patient",
        id: "p1",
        extension: [
          {
            url: PARENT_URL,
            extension: [{ url: "optional-sub", valueString: "hello" }],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      const minErrors = issues.filter(
        (i) => i.code === "profile-extension-min-cardinality",
      );
      expect(minErrors.length).toBeGreaterThan(0);
    });

    it("accepts a valid nested extension tree", async () => {
      const validator = makeDeepValidator();
      const resource = {
        resourceType: "Patient",
        id: "p1",
        extension: [
          {
            url: PARENT_URL,
            extension: [
              { url: "required-sub", valueString: "ok" },
              { url: "optional-sub", valueString: "also-ok" },
            ],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      const minErrors = issues.filter(
        (i) => i.code === "profile-extension-min-cardinality",
      );
      expect(minErrors.length).toBe(0);
    });

    it("reports max-cardinality violation on a required singleton sub-extension", async () => {
      const validator = makeDeepValidator();
      const resource = {
        resourceType: "Patient",
        id: "p1",
        extension: [
          {
            url: PARENT_URL,
            extension: [
              { url: "required-sub", valueString: "a" },
              { url: "required-sub", valueString: "b" },
            ],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      const maxErrors = issues.filter(
        (i) => i.code === "profile-extension-max-cardinality",
      );
      expect(maxErrors.length).toBeGreaterThan(0);
    });

    it("applies an inline value[x] binding declared by a nested extension slice", async () => {
      const valueSetValidator = {
        validate: vi.fn().mockResolvedValue([]),
        validateBinding: vi.fn().mockResolvedValue([
          {
            id: "display-error",
            aspect: "terminology",
            severity: "error",
            code: "terminology-display-mismatch",
            message: "Wrong Display Name",
            path: "Patient.extension.valueCoding.display",
            timestamp: new Date(),
          },
        ]),
      } as any;
      const sdLoader = {
        loadProfile: vi.fn(async (url: string) =>
          url === PARENT_URL ? parentProfile : null,
        ),
      } as any;
      const validator = new ExtensionValidator(
        sdLoader,
        { validate: vi.fn().mockResolvedValue([]) } as any,
        valueSetValidator,
        { validate: vi.fn().mockReturnValue([]) } as any,
      );
      const resource = {
        resourceType: "Patient",
        extension: [
          {
            url: PARENT_URL,
            extension: [
              {
                url: "required-sub",
                valueCoding: {
                  system: "http://example.org/CodeSystem/test",
                  code: "x",
                  display: "wrong",
                },
              },
            ],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      expect(valueSetValidator.validateBinding).toHaveBeenCalledWith(
        resource.extension[0].extension[0].valueCoding,
        expect.objectContaining({
          strength: "required",
          valueSet: "http://example.org/ValueSet/required-sub",
        }),
        expect.stringContaining("extension[url='required-sub'].valueCoding"),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: "terminology-display-mismatch",
          severity: "error",
        }),
      );
    });

    it("stops recursing when nesting exceeds the depth limit", async () => {
      const validator = makeDeepValidator();

      // Build a 10-deep chain
      let chain: any = { url: "required-sub", valueString: "leaf" };
      for (let i = 0; i < 10; i++) {
        chain = { url: PARENT_URL, extension: [chain] };
      }
      const resource = {
        resourceType: "Patient",
        id: "p1",
        extension: [chain],
      };

      const issues = await validator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      const depthErrors = issues.filter(
        (i) => i.code === "profile-extension-max-depth",
      );
      expect(depthErrors.length).toBeGreaterThan(0);
    });
  });

});
