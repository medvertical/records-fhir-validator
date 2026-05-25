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
  ]
};
