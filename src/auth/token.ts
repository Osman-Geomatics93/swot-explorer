/**
 * Earthdata Login bearer token.
 *
 * Stored in chrome.storage.local, which content scripts cannot read
 * (setAccessLevel TRUSTED_CONTEXTS is the default for local storage).
 * Never log the token or put it in URLs, errors or exports.
 */

const KEY = 'edlToken';
export const TOKEN_KEY = KEY;

export interface TokenInfo {
  uid: string;
  expiresAt: Date;
  expired: boolean;
  daysLeft: number;
}

export class AuthError extends Error {}

export function decodeToken(token: string): TokenInfo {
  const payload = token.split('.')[1];
  if (!payload) throw new AuthError('This does not look like an Earthdata token.');
  let claims: { uid?: string; exp?: number };
  try {
    claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    throw new AuthError('This does not look like an Earthdata token.');
  }
  if (!claims.exp || !claims.uid) throw new AuthError('The token has no user or expiry.');
  const expiresAt = new Date(claims.exp * 1000);
  const msLeft = expiresAt.getTime() - Date.now();
  return { uid: claims.uid, expiresAt, expired: msLeft <= 0, daysLeft: Math.floor(msLeft / 86_400_000) };
}

export async function saveToken(token: string): Promise<TokenInfo> {
  const clean = token.trim();
  const info = decodeToken(clean);
  if (info.expired) throw new AuthError('This token has expired. Generate a new one on urs.earthdata.nasa.gov.');
  await browser.storage.local.set({ [KEY]: clean });
  return info;
}

export async function loadToken(): Promise<string | null> {
  const stored = await browser.storage.local.get(KEY);
  const token = stored[KEY];
  return typeof token === 'string' ? token : null;
}

export async function removeToken(): Promise<void> {
  await browser.storage.local.remove(KEY);
}

/** Token for an authenticated request, or a clear error the UI can show. */
export async function requireToken(): Promise<string> {
  const token = await loadToken();
  if (!token) throw new AuthError('Add your Earthdata token in Options to download data.');
  if (decodeToken(token).expired) throw new AuthError('Your Earthdata token has expired. Add a new one in Options.');
  return token;
}
