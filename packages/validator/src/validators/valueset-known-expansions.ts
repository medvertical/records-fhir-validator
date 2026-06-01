// Local expansions for small, spec-fixed required-binding ValueSets so they
// validate without a terminology server (gap P-3 step a).
//
// INVARIANT: only ValueSets whose code set is *identical across R4/R5/R6* may
// live here — this map is not version-keyed, and the local expansion is
// authoritative for required bindings, so a version-divergent set (e.g.
// encounter-status, composition-status, quantity-comparator) would produce
// false positives on the versions it does not match. Every entry below is
// stable across R4 and R5.
export const KNOWN_VALUE_SET_EXPANSIONS: Record<string, string[]> = {
  'http://hl7.org/fhir/ValueSet/administrative-gender': [
    'http://hl7.org/fhir/administrative-gender|male',
    'http://hl7.org/fhir/administrative-gender|female',
    'http://hl7.org/fhir/administrative-gender|other',
    'http://hl7.org/fhir/administrative-gender|unknown',
    'male', 'female', 'other', 'unknown'
  ],

  'http://hl7.org/fhir/ValueSet/name-use': [
    'http://hl7.org/fhir/name-use|usual',
    'http://hl7.org/fhir/name-use|official',
    'http://hl7.org/fhir/name-use|temp',
    'http://hl7.org/fhir/name-use|nickname',
    'http://hl7.org/fhir/name-use|anonymous',
    'http://hl7.org/fhir/name-use|old',
    'http://hl7.org/fhir/name-use|maiden',
    'usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden'
  ],

  'http://hl7.org/fhir/ValueSet/identifier-use': [
    'http://hl7.org/fhir/identifier-use|usual',
    'http://hl7.org/fhir/identifier-use|official',
    'http://hl7.org/fhir/identifier-use|temp',
    'http://hl7.org/fhir/identifier-use|secondary',
    'http://hl7.org/fhir/identifier-use|old',
    'usual', 'official', 'temp', 'secondary', 'old'
  ],

  'http://hl7.org/fhir/ValueSet/contact-point-system': [
    'http://hl7.org/fhir/contact-point-system|phone',
    'http://hl7.org/fhir/contact-point-system|fax',
    'http://hl7.org/fhir/contact-point-system|email',
    'http://hl7.org/fhir/contact-point-system|pager',
    'http://hl7.org/fhir/contact-point-system|url',
    'http://hl7.org/fhir/contact-point-system|sms',
    'http://hl7.org/fhir/contact-point-system|other',
    'phone', 'fax', 'email', 'pager', 'url', 'sms', 'other'
  ],

  'http://hl7.org/fhir/ValueSet/contact-point-use': [
    'http://hl7.org/fhir/contact-point-use|home',
    'http://hl7.org/fhir/contact-point-use|work',
    'http://hl7.org/fhir/contact-point-use|temp',
    'http://hl7.org/fhir/contact-point-use|old',
    'http://hl7.org/fhir/contact-point-use|mobile',
    'home', 'work', 'temp', 'old', 'mobile'
  ],

  'http://hl7.org/fhir/ValueSet/device-nametype': [
    'http://hl7.org/fhir/device-nametype|udi-label-name',
    'http://hl7.org/fhir/device-nametype|user-friendly-name',
    'http://hl7.org/fhir/device-nametype|patient-reported-name',
    'http://hl7.org/fhir/device-nametype|manufacturer-name',
    'http://hl7.org/fhir/device-nametype|model-name',
    'http://hl7.org/fhir/device-nametype|other',
    'udi-label-name', 'user-friendly-name', 'patient-reported-name',
    'manufacturer-name', 'model-name', 'other'
  ],

  'http://hl7.org/fhir/ValueSet/observation-status': [
    'http://hl7.org/fhir/observation-status|registered',
    'http://hl7.org/fhir/observation-status|preliminary',
    'http://hl7.org/fhir/observation-status|final',
    'http://hl7.org/fhir/observation-status|amended',
    'http://hl7.org/fhir/observation-status|corrected',
    'http://hl7.org/fhir/observation-status|cancelled',
    'http://hl7.org/fhir/observation-status|entered-in-error',
    'http://hl7.org/fhir/observation-status|unknown',
    'registered', 'preliminary', 'final', 'amended', 'corrected',
    'cancelled', 'entered-in-error', 'unknown'
  ],

  'http://hl7.org/fhir/ValueSet/address-use': [
    'http://hl7.org/fhir/address-use|home',
    'http://hl7.org/fhir/address-use|work',
    'http://hl7.org/fhir/address-use|temp',
    'http://hl7.org/fhir/address-use|old',
    'http://hl7.org/fhir/address-use|billing',
    'home', 'work', 'temp', 'old', 'billing'
  ],

  'http://hl7.org/fhir/ValueSet/address-type': [
    'http://hl7.org/fhir/address-type|postal',
    'http://hl7.org/fhir/address-type|physical',
    'http://hl7.org/fhir/address-type|both',
    'postal', 'physical', 'both'
  ],

  'http://hl7.org/fhir/ValueSet/publication-status': [
    'http://hl7.org/fhir/publication-status|draft',
    'http://hl7.org/fhir/publication-status|active',
    'http://hl7.org/fhir/publication-status|retired',
    'http://hl7.org/fhir/publication-status|unknown',
    'draft', 'active', 'retired', 'unknown'
  ],

  'http://hl7.org/fhir/ValueSet/request-status': [
    'http://hl7.org/fhir/request-status|draft',
    'http://hl7.org/fhir/request-status|active',
    'http://hl7.org/fhir/request-status|on-hold',
    'http://hl7.org/fhir/request-status|revoked',
    'http://hl7.org/fhir/request-status|completed',
    'http://hl7.org/fhir/request-status|entered-in-error',
    'http://hl7.org/fhir/request-status|unknown',
    'draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error', 'unknown'
  ],

  'http://hl7.org/fhir/ValueSet/request-intent': [
    'http://hl7.org/fhir/request-intent|proposal',
    'http://hl7.org/fhir/request-intent|plan',
    'http://hl7.org/fhir/request-intent|directive',
    'http://hl7.org/fhir/request-intent|order',
    'http://hl7.org/fhir/request-intent|original-order',
    'http://hl7.org/fhir/request-intent|reflex-order',
    'http://hl7.org/fhir/request-intent|filler-order',
    'http://hl7.org/fhir/request-intent|instance-order',
    'http://hl7.org/fhir/request-intent|option',
    'proposal', 'plan', 'directive', 'order', 'original-order',
    'reflex-order', 'filler-order', 'instance-order', 'option'
  ],

  'http://hl7.org/fhir/ValueSet/request-priority': [
    'http://hl7.org/fhir/request-priority|routine',
    'http://hl7.org/fhir/request-priority|urgent',
    'http://hl7.org/fhir/request-priority|asap',
    'http://hl7.org/fhir/request-priority|stat',
    'routine', 'urgent', 'asap', 'stat'
  ],

  'http://hl7.org/fhir/ValueSet/event-status': [
    'http://hl7.org/fhir/event-status|preparation',
    'http://hl7.org/fhir/event-status|in-progress',
    'http://hl7.org/fhir/event-status|not-done',
    'http://hl7.org/fhir/event-status|on-hold',
    'http://hl7.org/fhir/event-status|stopped',
    'http://hl7.org/fhir/event-status|completed',
    'http://hl7.org/fhir/event-status|entered-in-error',
    'http://hl7.org/fhir/event-status|unknown',
    'preparation', 'in-progress', 'not-done', 'on-hold', 'stopped',
    'completed', 'entered-in-error', 'unknown'
  ],

  'http://hl7.org/fhir/ValueSet/narrative-status': [
    'http://hl7.org/fhir/narrative-status|generated',
    'http://hl7.org/fhir/narrative-status|extensions',
    'http://hl7.org/fhir/narrative-status|additional',
    'http://hl7.org/fhir/narrative-status|empty',
    'generated', 'extensions', 'additional', 'empty'
  ],

  'http://hl7.org/fhir/ValueSet/link-type': [
    'http://hl7.org/fhir/link-type|replaced-by',
    'http://hl7.org/fhir/link-type|replaces',
    'http://hl7.org/fhir/link-type|refer',
    'http://hl7.org/fhir/link-type|seealso',
    'replaced-by', 'replaces', 'refer', 'seealso'
  ],

  'http://hl7.org/fhir/ValueSet/days-of-week': [
    'http://hl7.org/fhir/days-of-week|mon',
    'http://hl7.org/fhir/days-of-week|tue',
    'http://hl7.org/fhir/days-of-week|wed',
    'http://hl7.org/fhir/days-of-week|thu',
    'http://hl7.org/fhir/days-of-week|fri',
    'http://hl7.org/fhir/days-of-week|sat',
    'http://hl7.org/fhir/days-of-week|sun',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'
  ],

  'http://hl7.org/fhir/ValueSet/list-status': [
    'http://hl7.org/fhir/list-status|current',
    'http://hl7.org/fhir/list-status|retired',
    'http://hl7.org/fhir/list-status|entered-in-error',
    'current', 'retired', 'entered-in-error'
  ],

  'http://hl7.org/fhir/ValueSet/document-reference-status': [
    'http://hl7.org/fhir/document-reference-status|current',
    'http://hl7.org/fhir/document-reference-status|superseded',
    'http://hl7.org/fhir/document-reference-status|entered-in-error',
    'current', 'superseded', 'entered-in-error'
  ]
};
