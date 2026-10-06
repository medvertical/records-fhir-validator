import { describe, expect, it } from "vitest";
import { SlicingValidator } from "../slicing-validator";
import type { StructureDefinition } from "../../core/structure-definition-types";

const validator = new SlicingValidator();

describe("SlicingValidator cross-version extension slices", () => {
  it("enforces a required slice of a cross-version extension, which is defined for R4 itself", async () => {
    const r4ProfileWithXverSlice: StructureDefinition = {
      resourceType: "StructureDefinition",
      url: "http://example.org/StructureDefinition/r4-procedure-xver",
      name: "R4ProcedureXver",
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
            slicing: { discriminator: [{ type: "value", path: "url" }], rules: "open" },
          },
          {
            id: "Procedure.extension:recorded",
            path: "Procedure.extension",
            sliceName: "recorded",
            min: 1,
            max: "1",
            type: [{
              code: "Extension",
              profile: ["http://hl7.org/fhir/5.0/StructureDefinition/extension-Procedure.recorded"],
            }],
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      [],
      "Procedure.extension",
      r4ProfileWithXverSlice,
      null,
      "Procedure.extension",
      "R4",
    );

    expect(
      issues.filter((i) => i.code === "profile-slice-min-cardinality"),
    ).toHaveLength(1);
  });
});
