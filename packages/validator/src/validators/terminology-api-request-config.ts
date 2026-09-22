import * as fs from 'fs';
import * as https from 'https';
import { createHash } from 'node:crypto';
import axios, { type AxiosRequestConfig } from 'axios';
import { logger } from '../logger.js';
import type { TerminologyApiAuthConfig } from './valueset-types.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

type OAuth2Token = {
  accessToken: string;
  authSignature: string;
  expiresAt: number;
};

export class TerminologyRequestConfigBuilder {
  private oauth2Token: OAuth2Token | null = null;
  private mtlsAgent: { signature: string; agent: https.Agent } | null = null;

  constructor(private readonly getDefaultAuth: () => TerminologyApiAuthConfig | undefined) {}

  resetAuthCache(): void {
    this.oauth2Token = null;
    this.mtlsAgent = null;
  }

  async build(
    authOverride: TerminologyApiAuthConfig | undefined,
    timeout: number,
    params?: Record<string, unknown>,
  ): Promise<AxiosRequestConfig> {
    const auth = authOverride ?? this.getDefaultAuth();
    const httpsAgent = this.buildHttpsAgent(auth);

    return {
      ...(params ? { params } : {}),
      timeout,
      headers: await this.buildHeaders(auth),
      ...(httpsAgent ? { httpsAgent } : {}),
    };
  }

  private async buildHeaders(auth?: TerminologyApiAuthConfig): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: 'application/fhir+json',
    };
    if (!auth || auth.type === 'none') return headers;

    switch (auth.type) {
      case 'basic':
        if (auth.username && auth.password) {
          const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
          headers.Authorization = `Basic ${encoded}`;
        }
        break;
      case 'bearer':
        if (auth.token) {
          headers.Authorization = `Bearer ${auth.token}`;
        }
        break;
      case 'oauth2': {
        const token = await this.getOAuth2Token(auth);
        if (token) headers.Authorization = `Bearer ${token}`;
        break;
      }
      case 'mtls':
        break;
    }
    return headers;
  }

  private buildHttpsAgent(auth?: TerminologyApiAuthConfig): https.Agent | undefined {
    if (!auth || auth.type !== 'mtls') return undefined;

    const signature = JSON.stringify({
      clientCert: auth.clientCert,
      clientCertPath: auth.clientCertPath,
      clientKey: auth.clientKey,
      clientKeyPath: auth.clientKeyPath,
      caCert: auth.caCert,
      caCertPath: auth.caCertPath,
      passphrase: auth.passphrase,
      rejectUnauthorized: auth.rejectUnauthorized,
    });
    if (this.mtlsAgent?.signature === signature) {
      return this.mtlsAgent.agent;
    }

    const cert = this.readTlsMaterial(auth.clientCert, auth.clientCertPath, 'client certificate');
    const key = this.readTlsMaterial(auth.clientKey, auth.clientKeyPath, 'client key');
    if (!cert || !key) {
      logger.warn('[TerminologyApiClient] mTLS auth configured without both client certificate and key; request will be sent without mTLS credentials.');
      return undefined;
    }

    const ca = this.readTlsMaterial(auth.caCert, auth.caCertPath, 'CA certificate');
    const agent = new https.Agent({
      cert,
      key,
      ...(ca ? { ca } : {}),
      ...(auth.passphrase ? { passphrase: auth.passphrase } : {}),
      rejectUnauthorized: auth.rejectUnauthorized ?? true,
    });
    this.mtlsAgent = { signature, agent };
    return agent;
  }

  private readTlsMaterial(inlineValue: string | undefined, filePath: string | undefined, label: string): string | undefined {
    if (inlineValue) return inlineValue;
    if (!filePath) return undefined;

    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      logger.warn('[TerminologyApiClient] Could not read configured mTLS material', {
        material: label,
        ...validationFailureMetadata(error),
      });
      return undefined;
    }
  }

  private async getOAuth2Token(auth: TerminologyApiAuthConfig): Promise<string | null> {
    if (!auth.clientId || !auth.clientSecret || !auth.tokenUrl) return null;

    const authSignature = createHash('sha256')
      .update(JSON.stringify({
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        scope: auth.scope,
        tokenUrl: auth.tokenUrl,
      }))
      .digest('hex');
    if (
      this.oauth2Token?.authSignature === authSignature &&
      Date.now() < this.oauth2Token.expiresAt - 30_000
    ) {
      return this.oauth2Token.accessToken;
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
      });
      if (auth.scope) body.append('scope', auth.scope);

      const resp = await axios.post(auth.tokenUrl, body.toString(), {
        timeout: 10000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (resp.data?.access_token) {
        const expiresInSec = typeof resp.data.expires_in === 'number' ? resp.data.expires_in : 3600;
        this.oauth2Token = {
          accessToken: resp.data.access_token,
          authSignature,
          expiresAt: Date.now() + expiresInSec * 1000,
        };
        logger.info(`[TerminologyApiClient] OAuth2 token acquired (expires in ${expiresInSec}s)`);
        return this.oauth2Token.accessToken;
      }
      logger.warn('[TerminologyApiClient] OAuth2 token endpoint returned no access_token');
      return null;
    } catch (err) {
      logger.warn(
        '[TerminologyApiClient] OAuth2 token acquisition failed',
        validationFailureMetadata(err),
      );
      return null;
    }
  }
}
