import { logger } from '../logger';
import type { StructureDefinition } from './structure-definition-types';

export function sanitizeProfile(sd: StructureDefinition): StructureDefinition {
  if (!sd || !sd.snapshot || !sd.snapshot.element) return sd;

  let patched = false;
  for (const element of sd.snapshot.element) {
    if (!element.constraint) continue;

    for (const constraint of element.constraint) {
      if (
        constraint.expression &&
        constraint.key === 'pd-1' &&
        constraint.expression.includes('telecom or endpoint') &&
        !constraint.expression.includes('exists()')
      ) {
        constraint.expression = 'telecom.exists() or endpoint.exists()';
        patched = true;
      }
    }
  }

  if (patched) {
    logger.debug(`[SDLoader] Patched constraints in profile: ${sd.url}`);
  }

  return sd;
}
