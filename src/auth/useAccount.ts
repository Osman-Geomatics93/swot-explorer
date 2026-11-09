import { useEffect, useState } from 'react';
import { decodeToken, loadToken, TOKEN_KEY, type TokenInfo } from './token';

const SKIP_KEY = 'signInSkipped';

export interface AccountState {
  /** undefined while loading. */
  info: TokenInfo | null | undefined;
  /** The user chose to search without signing in (session only); undefined while loading. */
  skipped: boolean | undefined;
  skip: () => void;
}

const read = async (): Promise<TokenInfo | null> => {
  const token = await loadToken();
  if (!token) return null;
  try {
    return decodeToken(token);
  } catch {
    return null;
  }
};

/** Current Earthdata account, kept in sync across the side panel, full page and options. */
export function useAccount(): AccountState {
  const [info, setInfo] = useState<TokenInfo | null | undefined>(undefined);
  const [skipped, setSkipped] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void read().then(setInfo);
    void browser.storage.session.get(SKIP_KEY).then((r) => setSkipped(Boolean(r[SKIP_KEY])));
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && TOKEN_KEY in changes) void read().then(setInfo);
      if (area === 'session' && SKIP_KEY in changes) void browser.storage.session.get(SKIP_KEY).then((r) => setSkipped(Boolean(r[SKIP_KEY])));
    };
    browser.storage.onChanged.addListener(listener);
    // Expiry is time-based: re-read so a page left open notices when the token runs out.
    const timer = setInterval(() => void read().then(setInfo), 60_000);
    return () => {
      browser.storage.onChanged.removeListener(listener);
      clearInterval(timer);
    };
  }, []);

  return { info, skipped, skip: () => void browser.storage.session.set({ [SKIP_KEY]: true }) };
}
