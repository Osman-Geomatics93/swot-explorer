import { SignInForm } from './SignInForm';

/** First-run screen: sign in, or continue to search without downloads. */
export function SignInScreen({ onSkip, expired }: { onSkip: () => void; expired?: boolean }) {
  return (
    <main className="flex min-h-screen items-start justify-center overflow-y-auto px-6 py-[clamp(2rem,8vh,6rem)]">
      <div className="reveal w-full max-w-sm space-y-8">
        <header className="space-y-5">
          <img src="/icon/128.png" alt="Hydraulics Research Center, Sudan" width={64} height={64} />
          <div className="space-y-2">
            <p className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">SWOT Explorer</p>
            <h1 className="text-[clamp(1.75rem,6vw,2.25rem)] leading-[1.1]">{expired ? 'Sign in again' : 'Sign in to Earthdata'}</h1>
            <p className="text-body text-ink-2">
              {expired
                ? 'Your Earthdata session has expired. Sign in again to keep downloading SWOT data.'
                : 'SWOT files are distributed by NASA. Sign in with your Earthdata Login to download, clip and analyse them.'}
            </p>
          </div>
        </header>

        <SignInForm />

        <button type="button" onClick={onSkip} className="text-meta text-ink-2 underline underline-offset-2 hover:text-ink">
          Continue without signing in. You can search, but not download.
        </button>
      </div>
    </main>
  );
}
