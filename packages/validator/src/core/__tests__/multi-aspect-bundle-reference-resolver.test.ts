import { describe, expect, it } from 'vitest';
import {
  createBundleCanonicalResolver,
  createBundleReferenceResolver,
} from '../multi-aspect-bundle-reference-resolver';

describe('multi-aspect bundle reference resolver', () => {
  it('resolves a bare hash to the containing resource', () => {
    const containingResource = {
      resourceType: 'Organization',
      id: 'owner',
      contained: [{ resourceType: 'OrganizationAffiliation', id: 'affiliation' }],
    };
    const resolver = createBundleReferenceResolver(undefined, containingResource);

    expect(resolver?.('#')).toBe(containingResource);
  });

  it('resolves exact fullUrl references before relative fallbacks', () => {
    const exactTarget = {
      resourceType: 'Patient',
      id: 'exact',
    };
    const relativeTarget = {
      resourceType: 'Patient',
      id: 'p1',
    };
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          fullUrl: 'https://server.example/fhir/Patient/p1',
          resource: exactTarget,
        },
        {
          fullUrl: 'https://other.example/fhir/Patient/p1',
          resource: relativeTarget,
        },
      ],
    };

    const resolver = createBundleReferenceResolver(bundle, bundle);

    expect(resolver?.('https://server.example/fhir/Patient/p1')).toBe(exactTarget);
  });

  it('resolves absolute server URLs to bundled resources by ResourceType/id', () => {
    const target = {
      resourceType: 'Condition',
      id: 'mii-exa-onko-colorectal-cancer-diagnosis',
      meta: {
        profile: [
          'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/StructureDefinition/mii-pr-onko-diagnose-primaertumor|2026.0.3',
        ],
      },
    };
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          fullUrl: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/Condition/mii-exa-onko-colorectal-cancer-diagnosis',
          resource: target,
        },
      ],
    };

    const resolver = createBundleReferenceResolver(bundle, bundle);

    expect(
      resolver?.('https://server.fire.ly/Condition/mii-exa-onko-colorectal-cancer-diagnosis'),
    ).toBe(target);
  });

  it('normalizes versioned absolute references to the bundled ResourceType/id key', () => {
    const target = {
      resourceType: 'Procedure',
      id: 'operation-1',
    };
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          fullUrl: 'https://example.org/fhir/Procedure/operation-1',
          resource: target,
        },
      ],
    };

    const resolver = createBundleReferenceResolver(bundle, bundle);

    expect(resolver?.('https://server.fire.ly/fhir/Procedure/operation-1/_history/3')).toBe(target);
  });

  it('keeps contained references scoped to the root resource', () => {
    const containedTarget = {
      resourceType: 'Observation',
      id: 'contained-1',
    };
    const bundleTarget = {
      resourceType: 'Observation',
      id: 'contained-1',
    };
    const rootResource = {
      resourceType: 'Patient',
      id: 'p1',
      contained: [containedTarget],
    };
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          fullUrl: 'https://example.org/fhir/Observation/contained-1',
          resource: bundleTarget,
        },
      ],
    };

    const resolver = createBundleReferenceResolver(bundle, rootResource);

    expect(resolver?.('#contained-1')).toBe(containedTarget);
  });

  it('skips malformed bundle and contained entries without aborting resolution', () => {
    const containedTarget = { resourceType: 'Observation', id: 'contained-1' };
    const bundleTarget = { resourceType: 'Patient', id: 'p1' };
    const rootResource = {
      resourceType: 'Patient',
      contained: [null, [], { id: 42 }, containedTarget],
    };
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        null,
        [],
        { resource: null },
        { fullUrl: 'urn:uuid:invalid', resource: [] },
        { fullUrl: 'urn:uuid:p1', resource: bundleTarget },
      ],
    };

    const resolver = createBundleReferenceResolver(bundle, rootResource);

    expect(resolver?.('#contained-1')).toBe(containedTarget);
    expect(resolver?.('urn:uuid:p1')).toBe(bundleTarget);
    expect(resolver?.('urn:uuid:invalid')).toBeNull();
  });

  it('does not reuse an index across independent resolver sessions', () => {
    const bundle: Record<string, unknown> = { resourceType: 'Bundle', entry: [] };
    expect(createBundleReferenceResolver(bundle, bundle)).toBeNull();

    const patient = { resourceType: 'Patient', id: 'later' };
    bundle.entry = [{ fullUrl: 'urn:uuid:later', resource: patient }];

    expect(createBundleReferenceResolver(bundle, bundle)?.('urn:uuid:later')).toBe(patient);
  });
});

describe('multi-aspect bundle canonical resolver', () => {
  const questionnaireUrn = 'urn:uuid:bc52dbf4-fd67-52e3-ba75-731a76805872';
  const urnQuestionnaire = { resourceType: 'Questionnaire', status: 'active' };
  const urlQuestionnaire = {
    resourceType: 'Questionnaire',
    id: 'phq-9',
    url: 'https://example.org/Questionnaire/phq-9',
    version: '2.0.0',
    status: 'active',
  };
  const bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      { fullUrl: questionnaireUrn, resource: urnQuestionnaire },
      { fullUrl: 'urn:uuid:phq-9', resource: urlQuestionnaire },
      { fullUrl: 'urn:uuid:patient', resource: { resourceType: 'Patient', id: 'p1' } },
    ],
  };

  it('resolves a urn:uuid canonical against the entry fullUrl without a Questionnaire.url', () => {
    expect(createBundleCanonicalResolver(bundle)?.(questionnaireUrn, 'Questionnaire')).toBe(urnQuestionnaire);
  });

  it('resolves a literal canonical against the entry resource url and honours a pinned version', () => {
    const resolve = createBundleCanonicalResolver(bundle);

    expect(resolve?.(urlQuestionnaire.url, 'Questionnaire')).toBe(urlQuestionnaire);
    expect(resolve?.(`${urlQuestionnaire.url}|2.0.0`, 'Questionnaire')).toBe(urlQuestionnaire);
    expect(resolve?.(`${urlQuestionnaire.url}|1.0.0`, 'Questionnaire')).toBeNull();
  });

  it('resolves a relative Questionnaire/id canonical to the bundled resource', () => {
    expect(createBundleCanonicalResolver(bundle)?.('Questionnaire/phq-9', 'Questionnaire')).toBe(urlQuestionnaire);
  });

  it('refuses an entry of another resource type', () => {
    expect(createBundleCanonicalResolver(bundle)?.('urn:uuid:patient', 'Questionnaire')).toBeNull();
  });

  it('yields no resolver without a bundle or without entries', () => {
    expect(createBundleCanonicalResolver(undefined)).toBeNull();
    expect(createBundleCanonicalResolver({ resourceType: 'Bundle', entry: [] })).toBeNull();
  });
});
