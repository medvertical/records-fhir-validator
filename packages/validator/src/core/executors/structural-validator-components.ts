import { AttachmentValidator } from '../../validators/attachment-validator.js';
import { BundleValidator } from '../../validators/bundle-validator.js';
import { CanonicalResourceInvariantValidator } from '../../validators/canonical-resource-invariant-validator.js';
import { CardinalityValidator } from '../../validators/cardinality-validator.js';
import { ComplexTypeValidator } from '../../validators/complex-type-validator.js';
import { CompliesWithValidator } from '../../validators/complies-with-validator.js';
import { ElementRulesValidator } from '../../validators/element-rules-validator.js';
import { MustSupportValidator } from '../../validators/must-support-validator.js';
import { NarrativeValidator } from '../../validators/narrative-validator.js';
import { QuestionnaireValidator } from '../../validators/questionnaire-validator.js';
import { ReferenceFormatValidator } from '../../validators/reference-format-validator.js';
import { ReferenceTargetValidator } from '../../validators/reference-target-validator.js';
import { StringSecurityValidator } from '../../validators/string-security-validator.js';
import { StructureDefinitionValidator } from '../../validators/structure-definition-validator.js';
import { TypeValidator } from '../../validators/type-validator.js';
import type { ValueSetCache } from '../../validators/valueset-cache.js';
import { ValueSetValidator } from '../../validators/valueset-validator.js';
import type { StructureDefinitionLoader } from '../structure-definition-loader.js';

export interface StructuralExecutorDependencies {
  elementRulesValidator?: ElementRulesValidator;
  typeValidator?: TypeValidator;
  valueSetCache?: ValueSetCache;
  valueSetValidator?: ValueSetValidator;
}

export interface StructuralValidatorComponents {
  attachment: AttachmentValidator;
  bundle: BundleValidator;
  canonicalResourceInvariant: CanonicalResourceInvariantValidator;
  cardinality: CardinalityValidator;
  complexType: ComplexTypeValidator;
  compliesWith: CompliesWithValidator;
  elementRules: ElementRulesValidator;
  mustSupport: MustSupportValidator;
  narrative: NarrativeValidator;
  questionnaire: QuestionnaireValidator;
  referenceFormat: ReferenceFormatValidator;
  referenceTarget: ReferenceTargetValidator;
  stringSecurity: StringSecurityValidator;
  structureDefinition: StructureDefinitionValidator;
  type: TypeValidator;
}

export function createStructuralValidatorComponents(
  sdLoader: StructureDefinitionLoader,
  dependencies: StructuralExecutorDependencies,
): StructuralValidatorComponents {
  const type = dependencies.typeValidator ?? new TypeValidator();
  const elementRules = dependencies.elementRulesValidator ?? new ElementRulesValidator();
  const valueSet = dependencies.valueSetValidator
    ?? new ValueSetValidator(dependencies.valueSetCache);
  const referenceTarget = new ReferenceTargetValidator();
  referenceTarget.setProfileTypeResolver(url => sdLoader.getBaseResourceType(url));

  return {
    attachment: new AttachmentValidator(),
    bundle: new BundleValidator(),
    canonicalResourceInvariant: new CanonicalResourceInvariantValidator(),
    cardinality: new CardinalityValidator(),
    complexType: new ComplexTypeValidator(sdLoader, type, valueSet),
    compliesWith: new CompliesWithValidator(sdLoader),
    elementRules,
    mustSupport: new MustSupportValidator(),
    narrative: new NarrativeValidator(),
    questionnaire: new QuestionnaireValidator(dependencies.valueSetCache),
    referenceFormat: new ReferenceFormatValidator(),
    referenceTarget,
    stringSecurity: new StringSecurityValidator(),
    structureDefinition: new StructureDefinitionValidator(),
    type,
  };
}
