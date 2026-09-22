import { logger } from '../logger.js';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';

export function logSlicingValidationStart(
  elementCount: number,
  compatibleSliceCount: number,
  elementPath: string,
): void {
  logger.debug('[SlicingValidator] Validating sliced elements', {
    elementCount,
    compatibleSliceCount,
    ...sensitiveValueMetadata(elementPath),
  });
}
