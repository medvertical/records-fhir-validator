import { logger } from '../logger.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

export async function checkRecordsValidatorAvailability(
  sdLoader: StructureDefinitionLoader,
): Promise<boolean> {
  try {
    await sdLoader.waitForInitialization();

    const hasBaseProfiles = await sdLoader.hasBaseProfiles();
    if (hasBaseProfiles) {
      logger.info('[RecordsValidator] ✅ Validator is available and ready');
    } else {
      logger.info('[RecordsValidator] ⚠️  Validator not available - base profiles not loaded');
    }

    return hasBaseProfiles;
  } catch (error) {
    logger.warn('[RecordsValidator] Error during initialization', validationFailureMetadata(error));
    return false;
  }
}
