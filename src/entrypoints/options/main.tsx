import '@/lib/zodConfig'; // must run first: stops Zod probing eval (blocked by the extension CSP)
import { LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { EDL_LINKS } from '@/auth/earthdataLogin';
import { removeToken } from '@/auth/token';
import { useAccount } from '@/auth/useAccount';
import { DAHITI_LINKS, getDahitiKey, removeDahitiKey, saveDahitiKey } from '@/api/dahiti';
import { getHydrowebKey, HYDROWEB_LINKS, removeHydrowebKey, saveHydrowebKey } from '@/api/hydroweb';
import { Button, Card, Field, Input, Notice, Section, cx } from '@/components/ui';
import { SignInForm } from '@/features/account/SignInForm';
import { initTheme } from '@/state/theme';
import '@/styles/tokens.css';

initTheme();

interface KeySectionProps {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  label: string;
  savedText: string;
  get: () => Promise<string | null>;
  save: (key: string) => Promise<void>;
  remove: () => Promise<void>;
}

/** An optional third-party API key: checked with the service before it is stored. */
function KeySection({ eyebrow, title, intro, label, savedText, get, save, remove }: KeySectionProps) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => void get().then((k) => setHasKey(Boolean(k))), []);

  const submit = async () => {
    setBusy(true);
    setNote(null);
    try {
      await save(draft);
      setHasKey(true);
      setDraft('');
      setNote({ ok: true, text: 'Key checked and saved. Open a lake or river time series and tick “Compare with independent altimetry”.' });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : 'Could not check the key.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section eyebrow={eyebrow} title={title}>
      <p className="text-body text-ink-2">{intro}</p>
      {hasKey ? (
        <Card className="flex items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-3">
            <ShieldCheck aria-hidden size={20} strokeWidth={1.5} className="text-ok" />
            <p className="text-body text-ink">{savedText}</p>
          </div>
          <Button
            variant="ghost"
            icon={Trash2}
            onClick={() => {
              void remove();
              setHasKey(false);
            }}
          >
            Remove
          </Button>
        </Card>
      ) : (
        hasKey === false && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label={label}>
              <Input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Button type="submit" variant="primary" disabled={busy || !draft.trim()}>
              {busy ? 'Checking…' : 'Save key'}
            </Button>
          </form>
        )
      )}
      {note && <Notice tone={note.ok ? 'success' : 'error'}>{note.text}</Notice>}
    </Section>
  );
}

const link = 'font-medium text-accent underline underline-offset-2';

function Options() {
  const { info } = useAccount();
  const [message, setMessage] = useState<string | null>(null);
  const signedIn = Boolean(info && !info.expired);

  return (
    <main className="mx-auto grid max-w-5xl gap-x-16 gap-y-8 px-6 py-[clamp(3rem,8vw,6rem)] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <header className="reveal space-y-5">
        <img src="/icon/128.png" alt="Hydraulics Research Center, Sudan" width={72} height={72} />
        <div className="space-y-3">
          <p className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">SWOT Explorer</p>
          <h1 className="text-[clamp(2rem,4vw,3rem)] leading-[1.1]">Options</h1>
        </div>
      </header>

      <div className="reveal space-y-12">
        <Section eyebrow="Needed to download and clip files" title="Earthdata Login">
          {info === undefined ? null : signedIn && info ? (
            <>
              <Card className="flex items-center justify-between gap-4 p-6">
                <div className="flex items-center gap-3">
                  <ShieldCheck aria-hidden size={20} strokeWidth={1.5} className="text-ok" />
                  <div>
                    <p className="text-body text-ink">Signed in as {info.uid}</p>
                    <p className={cx('tabular text-meta', info.daysLeft < 7 ? 'text-caution' : 'text-ink-3')}>
                      Token expires {info.expiresAt.toLocaleDateString()} · {info.daysLeft} days left
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  icon={LogOut}
                  onClick={() => {
                    void removeToken();
                    setMessage('Signed out. The token was removed from this browser; it stays valid on NASA until it expires or you revoke it.');
                  }}
                >
                  Sign out
                </Button>
              </Card>
              <p className="text-meta text-ink-2">
                To revoke the token on NASA's side, open{' '}
                <a className="font-medium text-accent underline underline-offset-2" href={EDL_LINKS.tokens} target="_blank" rel="noreferrer">
                  your Earthdata tokens
                </a>
                .
              </p>
            </>
          ) : (
            <>
              {info?.expired && <Notice tone="warning">Your token has expired. Sign in again.</Notice>}
              <SignInForm onSignedIn={() => setMessage(null)} />
            </>
          )}
          {message && <Notice tone="success">{message}</Notice>}
        </Section>

        <KeySection
          eyebrow="Optional · independent check"
          title="Hydroweb altimetry"
          label="Hydroweb API key"
          savedText="Hydroweb API key saved"
          intro={
            <>
              Hydroweb (Theia / CNES) publishes lake and river water levels from altimetry missions, including stations for Roseires, Merowe, Lake
              Nasser and the Blue Nile through GERD. Create a free account on{' '}
              <a className={link} href={HYDROWEB_LINKS.home} target="_blank" rel="noreferrer">
                hydroweb.next
              </a>{' '}
              and generate an API key in your account settings.
            </>
          }
          get={getHydrowebKey}
          save={saveHydrowebKey}
          remove={removeHydrowebKey}
        />

        <KeySection
          eyebrow="Optional · independent check"
          title="DAHITI altimetry"
          label="DAHITI API key"
          savedText="DAHITI API key saved"
          intro={
            <>
              DAHITI (DGFI-TUM) publishes multi-mission water levels for lakes, reservoirs and rivers. Register on the{' '}
              <a className={link} href={DAHITI_LINKS.home} target="_blank" rel="noreferrer">
                DAHITI website
              </a>{' '}
              and copy the API key from your account.
            </>
          }
          get={getDahitiKey}
          save={saveDahitiKey}
          remove={removeDahitiKey}
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
