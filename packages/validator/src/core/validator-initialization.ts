import { logger } from '../logger';
import type { StructureDefinitionLoader } from './structure-definition-loader';

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
    logger.warn('[RecordsValidator] Error during initialization:', error);
    return false;
  }
}
