/**
 * Sign in with an Earthdata Login username and password.
 *
 * The password is used for exactly one request, to NASA's own token endpoint, and is never
 * stored: only the returned bearer token is kept (see token.ts). find_or_create_token returns
 * the user's existing token if there is one (Earthdata allows two), otherwise it creates one.
 */
import { AuthError, saveToken, type TokenInfo } from './token';

const TOKEN_ENDPOINT = 'https://urs.earthdata.nasa.gov/api/users/find_or_create_token';

export const EDL_LINKS = {
  register: 'https://urs.earthdata.nasa.gov/users/new',
  tokens: 'https://urs.earthdata.nasa.gov/user_tokens',
  profile: 'https://urs.earthdata.nasa.gov/profile',
  resetPassword: 'https://urs.earthdata.nasa.gov/reset_passwords/new',
} as const;

export async function signInWithPassword(username: string, password: string): Promise<TokenInfo> {
  const user = username.trim();
  if (!user || !password) throw new AuthError('Enter your Earthdata username and password.');

  let resp: Response;
  try {
    resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${user}:${password}`)))}` },
      credentials: 'omit',
    });
  } catch {
    throw new AuthError('Could not reach Earthdata Login. Check your connection and try again.');
  }

  const body = (await resp.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (resp.status === 401) {
    throw new AuthError(
      user.includes('@')
        ? 'Earthdata did not accept these details. Sign in with your Earthdata username rather than your email address.'
        : 'Earthdata did not accept this username and password.',
    );
  }
  if (!resp.ok || !body.access_token) {
    throw new AuthError(body.error_description ?? `Earthdata Login refused the request (HTTP ${resp.status}).`);
  }
  return saveToken(body.access_token);
}
