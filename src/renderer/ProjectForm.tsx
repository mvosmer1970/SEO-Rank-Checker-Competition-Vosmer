import { useEffect, useState } from 'react';
import type { Device, ProjectInput, SearchConsoleSite } from '../shared/types';
import { DEFAULT_IGNORED_DOMAINS } from '../shared/competition';
import { api, errorMessage } from './api';

/** Common countries (ISO 3166-1 alpha-3, as Search Console uses); any other 3-letter code can be typed. */
export const COUNTRIES: [string, string][] = [
  ['nld', 'Netherlands'],
  ['bel', 'Belgium'],
  ['deu', 'Germany'],
  ['fra', 'France'],
  ['gbr', 'United Kingdom'],
  ['usa', 'United States'],
  ['esp', 'Spain'],
  ['ita', 'Italy'],
  ['hun', 'Hungary'],
  ['pol', 'Poland'],
];

export const DEVICES: [Device, string][] = [
  ['', 'All devices'],
  ['DESKTOP', 'Desktop'],
  ['MOBILE', 'Mobile'],
  ['TABLET', 'Tablet'],
];

interface Props {
  initial?: ProjectInput;
  signedIn: boolean;
  onSave: (input: ProjectInput) => Promise<void>;
  onCancel: () => void;
}

export function ProjectForm({ initial, signedIn, onSave, onCancel }: Props) {
  const [input, setInput] = useState<ProjectInput>(
    initial ?? {
      name: '',
      siteUrl: '',
      country: '',
      device: '',
      serpCountry: 'nl',
      serpLanguage: 'nl',
      ownDomains: [],
      ignoredDomains: DEFAULT_IGNORED_DOMAINS,
    },
  );
  // The domain lists as typed (one per line); split on save.
  const [ownText, setOwnText] = useState(input.ownDomains.join('\n'));
  const [ignoredText, setIgnoredText] = useState(input.ignoredDomains.join('\n'));
  const split = (text: string) => text.split(/[\s,]+/).filter(Boolean);
  const [sites, setSites] = useState<SearchConsoleSite[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    api.listSites().then(setSites, (e: unknown) => setError(errorMessage(e)));
  }, [signedIn]);

  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => setInput((i) => ({ ...i, [key]: value }));

  return (
    <div className="page">
      <h2>{initial ? 'Edit project' : 'New project'}</h2>
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          onSave({ ...input, ownDomains: split(ownText), ignoredDomains: split(ignoredText) }).catch((err: unknown) => {
            setError(errorMessage(err));
            setBusy(false);
          });
        }}
      >
        <label>
          Name
          <input value={input.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </label>
        <label>
          Search Console property
          <input value={input.siteUrl} onChange={(e) => set('siteUrl', e.target.value)} list="sites" spellCheck={false} />
          <datalist id="sites">
            {sites.map((s) => (
              <option key={s.siteUrl} value={s.siteUrl} />
            ))}
          </datalist>
          <span className="hint">
            {signedIn ? 'Pick one of your properties, e.g. sc-domain:example.com.' : 'Sign in under Settings to pick from your properties.'}
          </span>
        </label>
        <div className="row">
          <label className="grow">
            Country
            <input value={input.country} onChange={(e) => set('country', e.target.value)} list="countries" placeholder="All countries" />
            <datalist id="countries">
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </datalist>
            <span className="hint">3-letter code, empty for all countries.</span>
          </label>
          <label className="grow">
            Device
            <select value={input.device} onChange={(e) => set('device', e.target.value as Device)}>
              {DEVICES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="grow">
            Competition: Google country
            <input value={input.serpCountry} onChange={(e) => set('serpCountry', e.target.value)} placeholder="nl" maxLength={2} />
            <span className="hint">2-letter code (gl) of the Google results that the competition check uses, e.g. nl, be, us.</span>
          </label>
          <label className="grow">
            Competition: Google language
            <input value={input.serpLanguage} onChange={(e) => set('serpLanguage', e.target.value)} placeholder="nl" maxLength={5} />
            <span className="hint">Language code (hl) of every keyword; a keyword can get its own language on the Competition tab.</span>
          </label>
        </div>
        <div className="row">
          <label className="grow">
            Own domains
            <textarea rows={4} value={ownText} onChange={(e) => setOwnText(e.target.value)} placeholder={'lialis.nl\nlialis.com'} />
            <span className="hint">Never counted as competitors; each gets a position column. The domain of the property always counts.</span>
          </label>
          <label className="grow">
            Ignored domains
            <textarea rows={4} value={ignoredText} onChange={(e) => setIgnoredText(e.target.value)} />
            <span className="hint">Left out of competitors, share of voice and gaps; shown grey in the top 10. One per line.</span>
          </label>
        </div>
        {initial && <p className="hint">Changing the property, country or device clears the stored history; the next sync fetches it again.</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
