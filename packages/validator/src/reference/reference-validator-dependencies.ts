import { BatchedReferenceChecker } from './batched-reference-checker.js';
import { BundleReferenceResolver } from './bundle-reference-resolver.js';
import { CanonicalReferenceValidator } from './canonical-reference-validator.js';
import { CircularReferenceDetector } from './circular-reference-detector.js';
import { ContainedReferenceResolver } from './contained-reference-resolver.js';
import { RecursiveReferenceValidator } from './recursive-reference-validator.js';
import { ReferenceTypeConstraintValidator } from './reference-type-constraint-validator.js';
import { VersionSpecificReferenceValidator } from './version-specific-reference-validator.js';

export interface ReferenceValidatorDependencies {
  batchedChecker: BatchedReferenceChecker;
  bundleResolver: BundleReferenceResolver;
  canonicalValidator: CanonicalReferenceValidator;
  circularDetector: CircularReferenceDetector;
  constraintValidator: ReferenceTypeConstraintValidator;
  containedResolver: ContainedReferenceResolver;
  recursiveValidator: RecursiveReferenceValidator;
  versionValidator: VersionSpecificReferenceValidator;
}

export function createReferenceValidatorDependencies(
  overrides: Partial<ReferenceValidatorDependencies> = {},
): ReferenceValidatorDependencies {
  return {
    batchedChecker: overrides.batchedChecker ?? new BatchedReferenceChecker(),
    bundleResolver: overrides.bundleResolver ?? new BundleReferenceResolver(),
    canonicalValidator: overrides.canonicalValidator ?? new CanonicalReferenceValidator(),
    circularDetector: overrides.circularDetector ?? new CircularReferenceDetector(10),
    constraintValidator: overrides.constraintValidator ?? new ReferenceTypeConstraintValidator(),
    containedResolver: overrides.containedResolver ?? new ContainedReferenceResolver(),
    recursiveValidator: overrides.recursiveValidator ?? new RecursiveReferenceValidator(),
    versionValidator: overrides.versionValidator ?? new VersionSpecificReferenceValidator(),
  };
}
