import { logger } from '../logger.js';
import {
  isAllowedPackageTarballUrl,
  packageErrorMetadata,
  packageReferenceMetadata,
} from './package-artifact-policy.js';
import { isPackageManifestFor, readResponseBodyBounded } from './package-registry-response.js';
import type { PackageInfo, PackageManifest } from './package-registry-types.js';

const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const USER_AGENT = 'Records-FHIR-Validator/1.0';

export async function fetchManifestFromRegistry(input: {
  packageId: string;
  registryUrl: string;
  registryName: 'fhir' | 'simplifier' | 'unknown';
  timeoutMs: number;
}): Promise<PackageManifest | null> {
  const startedAt = Date.now();
  try {
    logger.info('[PackageRegistry] Fetching package manifest', {
      ...packageReferenceMetadata(input.packageId),
      registry: input.registryName,
      timeoutMs: input.timeoutMs,
    });
    const response = await fetchWithTimeout(
      `${input.registryUrl}/${encodeURIComponent(input.packageId)}`,
      input.timeoutMs,
      { Accept: 'application/json', 'User-Agent': USER_AGENT },
    );
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const buffer = await readResponseBodyBounded(response, MAX_MANIFEST_BYTES);
    if (!buffer) {
      logger.warn('[PackageRegistry] Registry manifest exceeds size limit');
      return null;
    }
    const manifest = JSON.parse(buffer.toString('utf8')) as unknown;
    if (!isPackageManifestFor(manifest, input.packageId)) {
      logger.warn('[PackageRegistry] Registry returned an invalid package manifest');
      return null;
    }
    logger.info('[PackageRegistry] Package manifest fetched', {
      ...packageReferenceMetadata(input.packageId),
      registry: input.registryName,
      durationMs: Date.now() - startedAt,
    });
    return manifest;
  } catch (error: unknown) {
    logger.warn('[PackageRegistry] Package manifest request failed', {
      ...packageReferenceMetadata(input.packageId),
      registry: input.registryName,
      durationMs: Date.now() - startedAt,
      ...packageErrorMetadata(error),
    });
    return null;
  }
}

export async function downloadPackageArtifact(input: {
  packageInfo: PackageInfo;
  maxBytes: number;
  timeoutMs: number;
}): Promise<Buffer | null> {
  const { packageId, version, tarballUrl } = input.packageInfo;
  if (!isAllowedPackageTarballUrl(tarballUrl)) {
    logger.warn('[PackageRegistry] Refusing untrusted package tarball URL', packageReferenceMetadata(packageId, version));
    return null;
  }
  try {
    logger.info('[PackageRegistry] Downloading package tarball', packageReferenceMetadata(packageId, version));
    const response = await fetchWithTimeout(tarballUrl, input.timeoutMs, { 'User-Agent': USER_AGENT });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > input.maxBytes) {
      logger.warn('[PackageRegistry] Package tarball exceeds download limit', {
        ...packageReferenceMetadata(packageId, version),
        declaredBytes: declaredLength,
        maxBytes: input.maxBytes,
      });
      return null;
    }
    const buffer = await readResponseBodyBounded(response, input.maxBytes);
    if (!buffer) {
      logger.warn('[PackageRegistry] Package tarball exceeded streaming limit', {
        ...packageReferenceMetadata(packageId, version),
        maxBytes: input.maxBytes,
      });
      return null;
    }
    logger.info('[PackageRegistry] Package tarball downloaded', {
      ...packageReferenceMetadata(packageId, version),
      bytes: buffer.length,
    });
    return buffer;
  } catch (error: unknown) {
    logger.error('[PackageRegistry] Package tarball download failed', {
      ...packageReferenceMetadata(packageId, version),
      ...packageErrorMetadata(error),
    });
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'error', headers });
  } finally {
    clearTimeout(timeoutId);
  }
}
