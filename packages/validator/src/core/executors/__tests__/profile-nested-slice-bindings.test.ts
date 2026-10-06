import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../structure-definition-types';
import { prepareNestedSliceBindings } from '../profile-nested-slice-bindings';
import { scopeParentItemsToNestedSlice } from '../profile-nested-slice-scoping';

// CH Lab's CBC slices Observation.component by code: most slices fix a LOINC
// code, the RDW slice only binds one, and each fixes its own unit.
const RDW_VALUE_SET = 'http://fhir.ch/ig/ch-lab-report/ValueSet/observation-code-entsvol-ratio';
const componentSlice = (name: string, code: Record<string, unknown>, unit: string) => [
  { id: `Observation.component:${name}`, path: 'Observation.component', sliceName: name },
  { id: `Observation.component:${name}.code`, path: 'Observation.component.code', ...code },
  {
    id: `Observation.component:${name}.value[x]`,
    path: 'Observation.component.value[x]',
    slicing: { discriminator: [{ type: 'type', path: '$this' }], rules: 'closed' },
  },
  {
    id: `Observation.component:${name}.value[x]:valueQuantity.code`,
    path: 'Observation.component.value[x].code',
    fixedCode: unit,
  },
];
const cbc = {
  resourceType: 'StructureDefinition',
  url: 'http://fhir.ch/ig/ch-lab-report/StructureDefinition/ch-lab-observation-cbc',
  type: 'Observation',
  snapshot: {
    element: [
      { id: 'Observation', path: 'Observation' },
      {
        id: 'Observation.component',
        path: 'Observation.component',
        slicing: { discriminator: [{ type: 'value', path: 'code' }], rules: 'open' },
      },
      ...componentSlice('WhiteBloodCellCount', {
        patternCodeableConcept: { coding: [{ system: 'http://loinc.org', code: '6690-2' }] },
      }, '10*9/L'),
      ...componentSlice('ErythrocyteDistWidth', {
        binding: { strength: 'required', valueSet: RDW_VALUE_SET },
      }, 'fL'),
    ],
  },
} as unknown as StructureDefinition;
const whiteCells = { code: { coding: [{ system: 'http://loinc.org', code: '6690-2' }] }, valueQuantity: { code: '10*9/L' } };
const distWidth = { code: { coding: [{ system: 'http://loinc.org', code: '788-0' }] }, valueQuantity: { code: 'fL' } };
const rdwTypeSlicing = cbc.snapshot!.element.find(element => element.id === 'Observation.component:ErythrocyteDistWidth.value[x]')!;

describe('enclosing slices told apart by a required binding', () => {
  it('scopes nested slicing to the components whose code is in the value set', async () => {
    await prepareNestedSliceBindings(cbc, async valueSet => (valueSet === RDW_VALUE_SET ? ['http://loinc.org|788-0'] : null));

    expect(scopeParentItemsToNestedSlice([whiteCells, distWidth], rdwTypeSlicing, cbc)).toEqual([distWidth]);
  });

  it('leaves the slice undecided when the value set cannot be expanded', async () => {
    await prepareNestedSliceBindings(cbc, async () => {
      throw new Error('not in any package');
    });

    expect(scopeParentItemsToNestedSlice([whiteCells, distWidth], rdwTypeSlicing, cbc)).toBeNull();
  });

  // FR Core slices Practitioner.qualification by code.coding and names each
  // slice only through bound reslices of that coding.
  const TYPE_DIPLOME = 'https://mos.esante.gouv.fr/NOS/JDV_J81-TypeDiplome-RASS/FHIR/JDV-J81-TypeDiplome-RASS|20230526120000';
  const byCoding = { discriminator: [{ type: 'value', path: '$this' }], rules: 'closed' };
  const practitioner = {
    resourceType: 'StructureDefinition',
    url: 'https://hl7.fr/ig/fhir/core/StructureDefinition/fr-core-practitioner',
    type: 'Practitioner',
    snapshot: {
      element: [
        { id: 'Practitioner', path: 'Practitioner' },
        {
          id: 'Practitioner.qualification',
          path: 'Practitioner.qualification',
          slicing: { discriminator: [{ type: 'value', path: 'code.coding' }], rules: 'open' },
        },
        { id: 'Practitioner.qualification:degree', path: 'Practitioner.qualification', sliceName: 'degree' },
        { id: 'Practitioner.qualification:degree.code.coding', path: 'Practitioner.qualification.code.coding', slicing: byCoding },
        {
          id: 'Practitioner.qualification:degree.code.coding:degreeType',
          path: 'Practitioner.qualification.code.coding',
          sliceName: 'degreeType',
          binding: { strength: 'required', valueSet: TYPE_DIPLOME },
        },
      ],
    },
  } as unknown as StructureDefinition;
  const diplome = { system: 'https://mos.esante.gouv.fr/NOS/TRE_R14-TypeDiplome/FHIR/TRE-R14-TypeDiplome', code: 'DE' };
  const categorie = { system: 'https://mos.esante.gouv.fr/NOS/TRE_R09-CategorieProfessionnelle/FHIR/TRE-R09-CategorieProfessionnelle', code: 'C' };
  const codingSlicing = practitioner.snapshot!.element.find(element => element.id === 'Practitioner.qualification:degree.code.coding')!;

  it('reads the binding from the first reslice and matches a single coding only', async () => {
    await prepareNestedSliceBindings(practitioner, async valueSet => (valueSet === TYPE_DIPLOME ? [`${diplome.system}|DE`] : null));
    const single = { code: { coding: [diplome] } };
    const twoCodings = { code: { coding: [diplome, { ...diplome, code: 'DE11' }] } };
    const other = { code: { coding: [categorie] } };

    expect(scopeParentItemsToNestedSlice([single, twoCodings, other], codingSlicing, practitioner)).toEqual([single]);
  });
});
