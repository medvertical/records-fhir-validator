import fhirpath from 'fhirpath';
import { getFhirPathModel } from '../core/fhirpath-context.js';
import { isRecord } from '../core/fhir-resource.js';

type Family = 'R4' | 'R5';
const projections = new Map<Family, ReturnType<typeof compileProjection>>();

function compileProjection(family: Family) {
  return fhirpath.compile({ base: 'Extension', expression: '$this' }, getFhirPathModel(family), {
    async: false, resolveInternalTypes: false,
  });
}

/** Preserve model-typed Extension nodes without exposing compilation or cache ownership. */
export function getExtensionProjection(context: unknown): ReturnType<typeof compileProjection> | undefined {
  if (!isRecord(context) || !isRecord(context.model)) return undefined;
  const family = context.model.version === 'r4' ? 'R4' : context.model.version === 'r5' ? 'R5' : undefined;
  if (!family) return undefined;
  let projection = projections.get(family);
  if (!projection) {
    projection = compileProjection(family);
    projections.set(family, projection);
  }
  return projection;
}
