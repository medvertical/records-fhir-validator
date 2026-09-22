import type { ProfileCache } from '../cache/profile-cache.js';
import type { BestPracticeValidator } from '../validators/best-practice-validator.js';
import type {
  CustomRuleExecutor,
  InvariantExecutor,
  MetadataExecutor,
  ProfileExecutor,
  ReferenceExecutor,
  StructuralExecutor,
  TerminologyExecutor,
} from './executors/index.js';
import type { FhirClientLike } from './profile-loader-utils.js';
import type { QuestionnaireContextRegistry } from './questionnaire-context-registry.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { SDFHIRPathExecutor } from '../validators/sd-fhirpath-executor.js';
import type { TerminologyResourceValidator } from '../validators/terminology-resource-validator.js';

export interface MultiAspectDeps {
  sdLoader: StructureDefinitionLoader;
  snapshotGenerator: SnapshotGenerator;
  profileCache?: ProfileCache;
  fhirClient?: FhirClientLike;
  structuralExecutor: StructuralExecutor;
  profileExecutor: ProfileExecutor;
  terminologyExecutor: TerminologyExecutor;
  referenceExecutor: ReferenceExecutor;
  invariantExecutor: InvariantExecutor;
  customRuleExecutor: CustomRuleExecutor;
  metadataExecutor: MetadataExecutor;
  bestPracticeValidator: BestPracticeValidator;
  questionnaireRegistry: QuestionnaireContextRegistry;
  strictMode: boolean;
  sdFHIRPathExecutor?: SDFHIRPathExecutor;
  terminologyResourceValidator: TerminologyResourceValidator;
}
