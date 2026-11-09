import { Eye, EyeOff, KeyRound, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EDL_LINKS, signInWithPassword } from '@/auth/earthdataLogin';
import { AuthError, saveToken, type TokenInfo } from '@/auth/token';
import { Button, Field, Input, Notice, cx } from '@/components/ui';

type Method = 'account' | 'token';

const link = 'font-medium text-accent underline underline-offset-2';

export function SignInForm({ onSignedIn }: { onSignedIn?: (info: TokenInfo) => void }) {
  const [method, setMethod] = useState<Method>('account');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const info = method === 'account' ? await signInWithPassword(username, password) : await saveToken(token);
      setPassword(''); // never kept beyond the one request
      setToken('');
      onSignedIn?.(info);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-6">
      <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 gap-1 rounded-ui bg-sunken p-1">
        {(
          [
            ['account', 'Earthdata account'],
            ['token', 'Token'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={method === id}
            onClick={() => {
              setMethod(id);
              setError(null);
            }}
            className={cx(
              'h-9 rounded-ui text-meta font-medium transition-[background-color,color] duration-200 ease-signature',
              method === id ? 'bg-surface text-ink shadow-float' : 'text-ink-2 hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {method === 'account' ? (
        <div className="space-y-4">
          <Field label="Username" hint={username.includes('@') ? 'Earthdata Login uses your username, not your email address.' : undefined}>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} autoFocus />
          </Field>
          <Field label="Password">
            <span className="relative block">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-ui text-ink-3 hover:text-ink"
              >
                {showPassword ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              </button>
            </span>
          </Field>
          <p className="text-meta text-ink-3">
            Your password goes only to NASA Earthdata Login, once, to get an access token. The extension keeps the token and forgets the
            password.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Earthdata token">
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={4}
              spellCheck={false}
              autoComplete="off"
              className="block w-full rounded-ui border border-line-strong bg-surface p-3 text-meta break-all text-ink transition-[border-color] duration-200 ease-signature hover:border-ink-3 focus-visible:border-accent"
            />
          </Field>
          <p className="text-meta text-ink-3">
            Create one under{' '}
            <a className={link} href={EDL_LINKS.tokens} target="_blank" rel="noreferrer">
              Generate Token
            </a>{' '}
            on Earthdata Login. Tokens last 60 days.
          </p>
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <Button
        type="submit"
        variant="primary"
        block
        icon={method === 'account' ? LogIn : KeyRound}
        disabled={busy || (method === 'account' ? !username.trim() || !password : !token.trim())}
      >
        {busy ? 'Signing in…' : method === 'account' ? 'Sign in' : 'Use token'}
      </Button>

      <p className="text-meta text-ink-2">
        No account?{' '}
        <a className={link} href={EDL_LINKS.register} target="_blank" rel="noreferrer">
          Register with NASA Earthdata
        </a>{' '}
        · it's free.{' '}
        {method === 'account' && (
          <>
            <a className={link} href={EDL_LINKS.resetPassword} target="_blank" rel="noreferrer">
              Forgot password?
            </a>
          </>
        )}
      </p>
    </form>
  );
}
