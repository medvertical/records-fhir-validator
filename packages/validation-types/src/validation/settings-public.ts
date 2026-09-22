import type { ValidationSettings } from './settings.js';
import type { TerminologyAuthConfig, TerminologyServer } from './settings-terminology.js';

type TerminologySecretField =
  | 'password'
  | 'token'
  | 'clientSecret'
  | 'clientCert'
  | 'clientKey'
  | 'caCert'
  | 'passphrase';

export interface CredentialPresenceHints {
  hasPassword?: boolean;
  hasToken?: boolean;
  hasClientSecret?: boolean;
  hasClientCert?: boolean;
  hasClientKey?: boolean;
  hasCaCert?: boolean;
  hasPassphrase?: boolean;
}

export type PublicTerminologyAuthConfig = Omit<TerminologyAuthConfig, TerminologySecretField>
  & CredentialPresenceHints;

export type PublicTerminologyServer = Omit<TerminologyServer, 'authConfig'> & {
  authConfig?: PublicTerminologyAuthConfig;
};

/** Settings DTO that is safe to serialize to browsers and API consumers. */
export type PublicValidationSettings = Omit<ValidationSettings, 'terminologyServers'> & {
  terminologyServers?: PublicTerminologyServer[];
};
