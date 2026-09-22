/**
 * Canonical Resource Invariant Validator
 *
 * FHIR R4 defines an identical "Name should be usable as an identifier"
 * constraint on every canonical / knowledge-artifact resource, under
 * resource-specific keys (mea-0, cnl-0, csd-0, vsd-0, que-0, …). All
 * variants test the same thing: `name.exists() implies
 * name.matches('[A-Z]([A-Za-z0-9_]){0,254}')`.
 *
 * This validator applies that rule uniformly. `QuestionnaireValidator`
 * keeps its own copy of the rule (as `que-0`) because it already owns
 * the Questionnaire-specific checks, so we skip Questionnaire here.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

/** Identifier regex from the FHIR R4 invariant. */
const IDENTIFIER_REGEX = /^[A-Z]([A-Za-z0-9_]){0,254}$/;

/**
 * Map from resource type to the invariant key (and short prefix) the
 * Java reference validator emits in its OperationOutcome. Keeping the
 * key in the message text lets the conformance diff match Java's output
 * via the `details.text` heuristic.
 *
 * Questionnaire is intentionally omitted — que-0 is handled by the
 * QuestionnaireValidator alongside que-1…que-12.
 */
const NAME_INVARIANT_KEYS: Record<string, string> = {
    Measure: 'mea-0',
    CodeSystem: 'csd-0',
    ValueSet: 'vsd-0',
    ConceptMap: 'cmd-0',
    NamingSystem: 'nsd-0',
    CapabilityStatement: 'cnl-0',
    MessageDefinition: 'cnl-0',
    OperationDefinition: 'opd-0',
    StructureDefinition: 'sdf-0',
    StructureMap: 'smp-0',
    GraphDefinition: 'gdf-0',
    SearchParameter: 'spd-0',
    CompartmentDefinition: 'cpd-0',
    ImplementationGuide: 'ig-0',
    TerminologyCapabilities: 'cnl-0',
    ExampleScenario: 'cnl-0',
    Library: 'lib-0',
    ActivityDefinition: 'asd-0',
    PlanDefinition: 'pdf-0',
    EventDefinition: 'cnl-0',
    ChargeItemDefinition: 'cnl-0',
};

export class CanonicalResourceInvariantValidator {
    /**
     * Evaluate the name-as-identifier invariant for any canonical /
     * knowledge-artifact resource. Returns an empty array for resource
     * types that don't carry the invariant.
     */
    /**
     * A constraint key identifies an invariant. Reusing one for a different
     * expression means two different rules answer to the same name, and a
     * reader tracing a failure back to its definition finds the wrong one.
     * Reusing a key for the *same* expression is how a profile restates an
     * inherited invariant and is allowed.
     */
    private validateConstraintKeyReuse(resource: Record<string, unknown>): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const seen = new Map<string, { expression: string; location: string }>();

        for (const source of ['differential', 'snapshot'] as const) {
            const container = asRecord(resource[source]);
            const elements = Array.isArray(container?.element) ? container.element : [];
            for (const element of elements) {
                const elementRecord = asRecord(element);
                const location = typeof elementRecord?.path === 'string' ? elementRecord.path : '';
                const constraints = Array.isArray(elementRecord?.constraint)
                    ? elementRecord.constraint
                    : [];
                for (const constraint of constraints) {
                    const record = asRecord(constraint);
                    const key = typeof record?.key === 'string' ? record.key : '';
                    if (!key) continue;
                    const expression = typeof record?.expression === 'string' ? record.expression : '';
                    const previous = seen.get(key);
                    if (!previous) {
                        seen.set(key, { expression, location });
                        continue;
                    }
                    if (previous.expression === expression) continue;
                    issues.push(createValidationIssue({
                        code: 'canonical-resource-constraint-key-reused',
                        path: location || 'StructureDefinition',
                        resourceType: 'StructureDefinition',
                        customMessage:
                            `The constraint key '${key}' already exists at the location `
                            + `'${previous.location}' with a different expression`,
                        severityOverride: 'error',
                        details: { key, location, previousLocation: previous.location },
                    }));
                }
            }
        }

        return issues;
    }

    validate(resource: unknown): ValidationIssue[] {
        const resourceRecord = asRecord(resource);
        if (!resourceRecord || typeof resourceRecord.resourceType !== 'string') return [];
        const issues: ValidationIssue[] = [];
        const rt = resourceRecord.resourceType;

        // Universal name-as-identifier invariant
        const key = NAME_INVARIANT_KEYS[rt];
        if (key && typeof resourceRecord.name === 'string') {
            const name = resourceRecord.name;
            if (!IDENTIFIER_REGEX.test(name)) {
                issues.push(createValidationIssue({
                    code: `canonical-resource-invariant-${key}`,
                    path: rt,
                    resourceType: rt,
                    customMessage:
                        `Constraint failed: ${key}: 'Name should be usable as an identifier ` +
                        `for the module by machine processing applications such as code generation'`,
                    severityOverride: 'warning',
                }));
            }
        }

        if (rt === 'StructureDefinition') {
            issues.push(...this.validateConstraintKeyReuse(resourceRecord));
        }

        // Resource-specific business rules
        if (rt === 'SearchParameter') {
            issues.push(...this.validateSearchParameter(resourceRecord));
        }

        return issues;
    }

    /**
     * Resource-specific business rules for SearchParameter.
     *
     * Currently enforces:
     *   - `type = 'composite'` requires `component.count() >= 2`
     *     (Java baseline `sp-composite`).
     */
    private validateSearchParameter(resource: Record<string, unknown>): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (resource.type === 'composite') {
            const componentCount = Array.isArray(resource.component) ? resource.component.length : 0;
            if (componentCount < 2) {
                issues.push(createValidationIssue({
                    code: 'business-rule-sp-composite',
                    path: 'SearchParameter',
                    resourceType: 'SearchParameter',
                    customMessage:
                        `When the SearchParameter has a type of 'composite', ` +
                        `then the SearchParameter must define two or more components`,
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}
