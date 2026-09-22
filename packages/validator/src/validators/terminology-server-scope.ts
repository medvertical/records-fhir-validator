import { createHash } from 'node:crypto';
import type { TerminologyApiAuthConfig } from './valueset-types.js';

export function getTerminologyServerScope(
  serverUrl: string,
  auth: TerminologyApiAuthConfig | undefined,
): string {
  if (!auth || auth.type === 'none') {
    return `${serverUrl}|auth:anonymous`;
  }

  const authFingerprint = createHash('sha256')
    .update(JSON.stringify([
      auth.type,
      auth.username,
      auth.password,
      auth.token,
      auth.clientId,
      auth.clientSecret,
      auth.scope,
      auth.tokenUrl,
      auth.clientCert,
      auth.clientCertPath,
      auth.clientKey,
      auth.clientKeyPath,
      auth.caCert,
      auth.caCertPath,
      auth.passphrase,
      auth.rejectUnauthorized,
    ]))
    .digest('hex')
    .slice(0, 16);

  return `${serverUrl}|auth:${authFingerprint}`;
}
