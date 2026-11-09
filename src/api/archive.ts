/** Authenticated file access to the PO.DAAC SWOT archive from extension pages. */

export class DownloadHostError extends Error {}

/**
 * Files fetched in this page session, newest last, so that clipping right after a preview
 * (or previewing the same pass twice) does not download the same granule again.
 * Granule files never change, so the cache only needs a size limit.
 */
const CACHE_LIMIT_BYTES = 250e6;
const cache = new Map<string, ArrayBuffer>();
let cachedBytes = 0;

function remember(url: string, data: ArrayBuffer) {
  if (data.byteLength > CACHE_LIMIT_BYTES / 2) return;
  const previous = cache.get(url); // two concurrent fetches of one URL both land here
  if (previous) cachedBytes -= previous.byteLength;
  cache.set(url, data);
  cachedBytes += data.byteLength;
  for (const [oldUrl, old] of cache) {
    if (cachedBytes <= CACHE_LIMIT_BYTES) break;
    cache.delete(oldUrl);
    cachedBytes -= old.byteLength;
  }
}

export const isArchiveFileCached = (url: string) => cache.has(url);

/**
 * Fetch a granule file with the Earthdata bearer token.
 * The archive redirects (303) to a signed CloudFront URL; the browser drops the
 * Authorization header on that cross-origin hop, as the CDN requires.
 */
export async function fetchArchiveFile(url: string, token: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url); // refresh recency
    cache.set(url, hit);
    return hit;
  }
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new DownloadHostError(
      'The download was blocked. NASA may have moved files to a new host; update host_permissions in wxt.config.ts.',
    );
  }
  if (resp.status === 401 || resp.status === 403) throw new Error('Earthdata refused the token. Check it in Options.');
  if (!resp.ok) throw new Error(`Download failed (HTTP ${resp.status}).`);
  if ((resp.headers.get('Content-Type') ?? '').includes('html'))
    throw new Error('Got a login page instead of data: the token is invalid or expired.');
  const data = await resp.arrayBuffer();
  remember(url, data);
  return data;
}
