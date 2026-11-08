import { useEffect, useState } from 'react';
import type { AppOptions, AuthStatus, SerperStatus } from '../shared/types';
import { api, errorMessage } from './api';

interface Props {
  auth: AuthStatus;
  onChanged: () => void;
  onError: (message: string) => void;
}

export function Settings({ auth, onChanged, onError }: Props) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [options, setOptions] = useState<AppOptions | undefined>();

  useEffect(() => {
    void api.getGoogleSettings().then((s) => {
      setClientId(s.clientId);
      setClientSecret(s.clientSecret);
    });
    void api.getOptions().then(setOptions);
  }, []);

  const [serper, setSerper] = useState<SerperStatus>({ configured: false, source: '' });
  const [serperKey, setSerperKey] = useState('');

  useEffect(() => {
    void api.getSerperStatus().then(setSerper);
  }, []);

  const saveAll = (next: AppOptions) => {
    api.saveOptions(next).then(
      () => api.getOptions().then(setOptions),
      (e: unknown) => onError(errorMessage(e)),
    );
  };

  const setOption = (key: 'autoSync' | 'keepInTray' | 'startWithWindows', value: boolean) => {
    if (!options) return;
    const next = { ...options, [key]: value };
    setOptions(next);
    saveAll(next);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h2>Settings</h2>

      <section className="card">
        <h3>1. Google OAuth client</h3>
        <p className="muted">
          Create an OAuth client of type <strong>Desktop app</strong> in Google Cloud Console (APIs &amp; Services → Credentials), with the
          Google Search Console API enabled. See README.md for the steps.
        </p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.saveGoogleSettings({ clientId, clientSecret });
              setSaved(true);
            });
          }}
        >
          <label>
            Client ID
            <input value={clientId} onChange={(e) => { setClientId(e.target.value); setSaved(false); }} spellCheck={false} />
          </label>
          <label>
            Client secret
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => { setClientSecret(e.target.value); setSaved(false); }}
              spellCheck={false}
            />
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={busy || !clientId.trim() || !clientSecret.trim()}>
              Save
            </button>
            {saved && <span className="muted small">Saved.</span>}
          </div>
        </form>
      </section>

      <section className="card">
        <h3>2. Google account</h3>
        {auth.signedIn ? (
          <div className="row">
            <span className="badge ok">Signed in</span>
            <button disabled={busy} onClick={() => void run(() => api.signOut())}>
              Sign out
            </button>
          </div>
        ) : (
          <>
            <p className="muted">Sign in with the Google account that has access to your Search Console properties. Your browser opens.</p>
            <button className="primary" disabled={busy || !auth.configured} onClick={() => void run(() => api.signIn())}>
              {busy ? 'Waiting for browser…' : 'Sign in with Google'}
            </button>
          </>
        )}
      </section>

      {options && (
        <section className="card form">
          <h3>3. Automatic sync</h3>
          <label className="check">
            <input type="checkbox" checked={options.autoSync} onChange={(e) => setOption('autoSync', e.target.checked)} />
            Sync every project once a day, and notify on a drop of more than 5 positions or a new top 10
          </label>
          <label className="check">
            <input type="checkbox" checked={options.keepInTray} onChange={(e) => setOption('keepInTray', e.target.checked)} />
            Keep running in the system tray when the window is closed
          </label>
          <label className="check">
            <input type="checkbox" checked={options.startWithWindows} onChange={(e) => setOption('startWithWindows', e.target.checked)} />
            Start with Windows (hidden in the system tray)
          </label>
          <span className="hint">
            The daily sync (and the weekly competition check) only runs while the app runs. Use the tray icon to open the app, sync all
            projects or quit.
          </span>
        </section>
      )}

      <section className="card form">
        <h3>4. Competition (Serper.dev)</h3>
        <p className="muted">
          The Competition tab checks the Google top 20 of every tracked keyword through serper.dev, weekly and with the button on the tab.
          Each keyword costs Serper credits per check.
        </p>
        <div className="row">
          <span className={`badge ${serper.configured ? 'ok' : 'warn'}`}>
            {serper.source === 'settings' ? 'Key set' : serper.source === 'env' ? 'Key from SERPER_API_KEY (.env)' : 'No key'}
          </span>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            api
              .saveSerperApiKey(serperKey)
              .then(() => api.getSerperStatus())
              .then((s) => {
                setSerper(s);
                setSerperKey('');
              }, (err: unknown) => onError(errorMessage(err)));
          }}
        >
          <input
            className="grow"
            type="password"
            placeholder={serper.source === 'settings' ? 'Enter a new key to replace it, or leave empty and save to remove it' : 'Serper API key'}
            value={serperKey}
            onChange={(e) => setSerperKey(e.target.value)}
            spellCheck={false}
          />
          <button type="submit" className="primary">
            Save key
          </button>
        </form>
        <span className="hint">The own and ignored domains are set per project (Edit on the project).</span>
      </section>
    </div>
  );
}
