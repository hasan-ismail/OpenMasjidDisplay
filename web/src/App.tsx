import { useState, type FormEvent } from 'react';
import { useAppState } from './state';
import { api } from './api';
import { usePrefs, prefsStore, resolveTheme, useOmosAppearanceSync } from './prefs';
import {
  ToastProvider,
  MasjidMark,
  IconScreen,
  IconClock,
  IconCamera,
  IconCalendar,
  IconCog,
  IconMoon,
  IconSun,
  IconPower,
  Spinner,
} from './ui';
import type { AppState } from './types';
import { Screens } from './routes/Screens';
import { Timetables } from './routes/Timetables';
import { Sources } from './routes/Sources';
import { Schedules } from './routes/Schedules';
import { SettingsPage } from './routes/Settings';

type Tab = 'screens' | 'timetables' | 'sources' | 'schedules' | 'settings';

const TABS: { id: Tab; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'screens', label: 'Screens', Icon: IconScreen },
  { id: 'timetables', label: 'Timetables', Icon: IconClock },
  { id: 'sources', label: 'Sources', Icon: IconCamera },
  { id: 'schedules', label: 'Schedule', Icon: IconCalendar },
  { id: 'settings', label: 'Settings', Icon: IconCog },
];

export function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const { state, authed, hasPassword, ssoEnabled, loading, refetch, onAuthed } = useAppState();
  const [tab, setTab] = useState<Tab>('screens');
  const [setupInstead, setSetupInstead] = useState(false);

  if (authed) return state ? <Shell state={state} refetch={refetch} tab={tab} setTab={setTab} /> : <Splash />;
  if (loading) return <Splash />;
  // Not signed in. Standalone first run (or a chosen fallback) → create a password.
  if (!hasPassword && (setupInstead || !ssoEnabled)) return <Setup onDone={onAuthed} />;
  return (
    <Login
      onDone={onAuthed}
      ssoEnabled={ssoEnabled}
      hasPassword={hasPassword}
      onSetupInstead={!hasPassword ? () => setSetupInstead(true) : undefined}
    />
  );
}

function Scene() {
  const prefs = usePrefs();
  const v = prefs.wallpaperImage.trim();
  const img = /^https?:\/\/[^\s"'()]+$/i.test(v) ? v : null;
  if (img) {
    return (
      <div
        className="scene scene--image"
        aria-hidden="true"
        style={{ backgroundImage: `url("${img}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
      />
    );
  }
  return <div className="scene" aria-hidden="true" />;
}

function Splash() {
  return (
    <div className="auth-wrap">
      <Scene />
      <div className="row" style={{ gap: '0.75rem', color: 'var(--color-primary)' }}>
        <Spinner /> <span className="muted">Loading…</span>
      </div>
    </div>
  );
}

function Dock({
  tab,
  setTab,
  dark,
  onToggleTheme,
  onLogout,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  dark: boolean;
  onToggleTheme: () => void;
  onLogout?: () => void;
}) {
  return (
    <div className="dock-wrap">
      <nav className="dock glass-raised" aria-label="Sections">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`nav-item${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            aria-label={label}
            title={label}
          >
            <Icon size={20} />
          </button>
        ))}
        <span className="dock-sep" aria-hidden="true" />
        <button className="nav-item nav-item--util" onClick={onToggleTheme} aria-label="Toggle light or dark" title="Toggle light or dark">
          {dark ? <IconSun size={20} /> : <IconMoon size={20} />}
        </button>
        {onLogout && (
          <button className="nav-item nav-item--util" onClick={onLogout} aria-label="Sign out" title="Sign out">
            <IconPower size={20} />
          </button>
        )}
      </nav>
    </div>
  );
}

function Shell({
  state,
  refetch,
  tab,
  setTab,
}: {
  state: AppState;
  refetch: () => Promise<void>;
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const prefs = usePrefs();
  useOmosAppearanceSync(state.omosBase);
  const dark = resolveTheme(prefs.theme) === 'dark';
  // A manual toggle is an explicit choice → stop mirroring OpenMasjidOS.
  const toggleTheme = () => prefsStore.patch({ theme: dark ? 'light' : 'dark', followOmos: false });
  const logout = async () => {
    try {
      await api.logout();
    } finally {
      location.reload();
    }
  };

  return (
    <div className="shell">
      <Scene />
      <header className="topbar">
        <div className="brand">
          <MasjidMark size={24} />
          <b>OpenMasjid Display</b>
        </div>
      </header>

      <main className="main">
        {tab === 'screens' && <Screens state={state} refetch={refetch} />}
        {tab === 'timetables' && <Timetables state={state} refetch={refetch} />}
        {tab === 'sources' && <Sources state={state} refetch={refetch} />}
        {tab === 'schedules' && <Schedules state={state} refetch={refetch} />}
        {tab === 'settings' && <SettingsPage state={state} refetch={refetch} />}
      </main>

      <Dock
        tab={tab}
        setTab={setTab}
        dark={dark}
        onToggleTheme={toggleTheme}
        onLogout={state.authRequired ? logout : undefined}
      />
    </div>
  );
}

function Login({
  onDone,
  ssoEnabled,
  hasPassword,
  onSetupInstead,
}: {
  onDone: () => void;
  ssoEnabled: boolean;
  hasPassword: boolean;
  onSetupInstead?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Under OpenMasjidOS with no local password: there's nothing to type — the user
  // just needs to open the app from the dashboard (which carries the platform
  // session). Offer a fallback to set a password in case the platform is down.
  if (ssoEnabled && !hasPassword) {
    return (
      <div className="auth-wrap">
        <Scene />
        <div className="auth-card glass-raised">
          <div className="auth-logo"><MasjidMark size={44} /></div>
          <h1 className="page-title" style={{ textAlign: 'center' }}>OpenMasjid Display</h1>
          <p className="page-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            This panel uses your OpenMasjidOS sign-in. Open it from your OpenMasjidOS
            dashboard to continue.
          </p>
          <button className="btn btn--primary btn--block" onClick={onDone}>
            I’ve signed in — continue
          </button>
          {onSetupInstead && (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              style={{ marginTop: '0.6rem' }}
              onClick={onSetupInstead}
            >
              Set a password instead
            </button>
          )}
        </div>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <Scene />
      <form className="auth-card glass-raised" onSubmit={submit}>
        <div className="auth-logo"><MasjidMark size={44} /></div>
        <h1 className="page-title" style={{ textAlign: 'center' }}>OpenMasjid Display</h1>
        <p className="page-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          Enter the control-panel password to continue.
        </p>
        <input
          className="input"
          type="password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn--primary btn--block" style={{ marginTop: '0.8rem' }} disabled={busy}>
          {busy ? <Spinner /> : 'Sign in'}
        </button>
        {ssoEnabled && (
          <p className="hint" style={{ textAlign: 'center', marginBlockStart: '0.8rem' }}>
            Tip: open this app from your OpenMasjidOS dashboard to sign in automatically.
          </p>
        )}
      </form>
    </div>
  );
}

function Setup({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 4) {
      setError('Please use at least 4 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords don’t match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.setup(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish setup.');
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <Scene />
      <form className="auth-card glass-raised" onSubmit={submit}>
        <div className="auth-logo"><MasjidMark size={44} /></div>
        <h1 className="page-title" style={{ textAlign: 'center' }}>Welcome</h1>
        <p className="page-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          Create a password for your control panel. You'll set everything else up inside.
        </p>
        <input
          className="input"
          type="password"
          autoFocus
          placeholder="Choose a password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ marginBottom: '0.6rem' }}
        />
        <input
          className="input"
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn--primary btn--block" style={{ marginTop: '0.8rem' }} disabled={busy}>
          {busy ? <Spinner /> : 'Create & continue'}
        </button>
      </form>
    </div>
  );
}
