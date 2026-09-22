import { logger } from '../logger.js';
import type { TerminologyResolutionConfig, ValueSetValidator } from '../validators/valueset-validator.js';
import type { StructuralExecutor, TerminologyExecutor } from './executors/index.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';

export class ValidatorTerminologyAdministration {
  constructor(
    private readonly structuralExecutor: StructuralExecutor,
    private readonly terminologyExecutor: TerminologyExecutor,
    private readonly valueSetValidator: ValueSetValidator,
  ) {}

  configure(config: TerminologyResolutionConfig): void {
    this.terminologyExecutor.configureResolution(config);
    this.structuralExecutor.configureTerminologyResolution(config);
    this.valueSetValidator.setResolutionConfig(config);
    const scopedCount = config.servers?.filter(server =>
      server.preferredSystems && server.preferredSystems.length > 0
    ).length ?? 0;
    logger.debug('[RecordsValidator] Terminology resolution configured', {
      strategy: config.strategy,
      authType: config.auth?.type || 'none',
      serverCount: config.servers?.length || 0,
      scopedServerCount: scopedCount,
      ...terminologyTargetMetadata(config.serverUrl),
    });
  }

  clearCache(): void {
    this.terminologyExecutor.clearCache();
    this.valueSetValidator.clearCache();
    logger.info('[RecordsValidator] Terminology caches cleared');
  }

  registerExternalResource(resource: unknown, fhirVersion: 'R4' | 'R5' | 'R6'): boolean {
    return this.valueSetValidator.registerExternalTerminologyResource(resource, fhirVersion);
  }
}
