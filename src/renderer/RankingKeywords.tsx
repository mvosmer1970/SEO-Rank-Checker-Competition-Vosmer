// Every query the Search Console property ranked for, with country, device, period and Top N filters.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Device, Project, RankingKeyword, RankingKeywordsFilter } from '../shared/types';
import { api, errorMessage } from './api';
import { CopyButton } from './CopyButton';
import { COUNTRIES, DEVICES } from './ProjectForm';
import { shortUrl } from './ProjectView';

const PERIODS: [number, string][] = [
  [7, 'Last 7 days'],
  [28, 'Last 28 days'],
  [90, 'Last 3 months'],
  [486, 'Last 16 months'],
];

const TOP: number[] = [10, 20, 50, 100];

type SortKey = 'query' | 'position' | 'clicks' | 'impressions' | 'ctr';

interface Props {
  project: Project;
  signedIn: boolean;
  onAdded: (project: Project) => void;
  onError: (message: string) => void;
}

export function RankingKeywords({ project, signedIn, onAdded, onError }: Props) {
  const [filter, setFilter] = useState<RankingKeywordsFilter>({
    days: 28,
    country: project.country,
    device: project.device,
    maxPosition: 100,
  });
  const [items, setItems] = useState<RankingKeyword[] | undefined>();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'impressions', asc: false });
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = useCallback(
    (f: RankingKeywordsFilter) => {
      setLoading(true);
      setChecked(new Set());
      api
        .getRankingKeywords(project.id, f)
        .then(setItems, (e: unknown) => onError(errorMessage(e)))
        .finally(() => setLoading(false));
    },
    [project.id, onError],
  );

  // First load with the filters of the project; afterwards the Search button applies changed filters.
  useEffect(() => {
    if (signedIn) load({ days: 28, country: project.country, device: project.device, maxPosition: 100 });
  }, [signedIn, load, project.country, project.device]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (items ?? []).filter((i) => !needle || i.query.includes(needle) || i.page.toLowerCase().includes(needle));
    return list.sort((a, b) => {
      const cmp = sort.key === 'query' ? a.query.localeCompare(b.query) : a[sort.key] - b[sort.key];
      return sort.asc ? cmp : -cmp;
    });
  }, [items, search, sort]);

  const add = async (queries: string[]) => {
    try {
      onAdded(await api.addKeywords(project.id, queries, []));
      const added = new Set(queries);
      setItems((list) => list?.map((i) => (added.has(i.query) ? { ...i, tracked: true } : i)));
      setChecked(new Set());
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const toggle = (query: string) =>
    setChecked((set) => {
      const next = new Set(set);
      if (next.has(query)) next.delete(query);
      else next.add(query);
      return next;
    });

  const header = (key: SortKey, label: string, className = '') => (
    <th
      className={`sortable ${className}`}
      onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : key === 'query' || key === 'position' }))}
    >
      {label}
      {sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  if (!signedIn) return <div className="banner">Sign in with Google under Settings to see the ranking keywords.</div>;

  const untrackedVisible = rows.filter((r) => !r.tracked);
  const countryOptions = COUNTRIES.some(([code]) => code === filter.country) || !filter.country
    ? COUNTRIES
    : [[filter.country, filter.country.toUpperCase()] as [string, string], ...COUNTRIES];

  return (
    <section className="card">
      <form
        className="row filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          load(filter);
        }}
      >
        <select value={filter.country} onChange={(e) => setFilter({ ...filter, country: e.target.value })}>
          <option value="">All countries</option>
          {countryOptions.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <select value={filter.device} onChange={(e) => setFilter({ ...filter, device: e.target.value as Device })}>
          {DEVICES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={filter.days} onChange={(e) => setFilter({ ...filter, days: Number(e.target.value) })}>
          {PERIODS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={filter.maxPosition} onChange={(e) => setFilter({ ...filter, maxPosition: Number(e.target.value) })}>
          {TOP.map((n) => (
            <option key={n} value={n}>
              Top {n}
            </option>
          ))}
        </select>
        <button type="submit" className="primary" disabled={loading}>
          {loading ? 'Loading…' : 'Search'}
        </button>
        <input className="grow" placeholder="Filter by keyword or URL" value={search} onChange={(e) => setSearch(e.target.value)} />
      </form>

      <div className="row list-actions">
        <span className="muted small">
          {items ? `${rows.length.toLocaleString()} keywords${rows.length !== items.length ? ` of ${items.length.toLocaleString()}` : ''}` : ''}
          {' · '}
          {project.siteUrl}
        </span>
        <button className="primary" disabled={checked.size === 0} onClick={() => void add([...checked])}>
          Add selected ({checked.size})
        </button>
      </div>

      <table className="keywords">
        <thead>
          <tr>
            <th className="check-col">
              <input
                type="checkbox"
                title="Select all untracked keywords in the list"
                checked={untrackedVisible.length > 0 && untrackedVisible.every((r) => checked.has(r.query))}
                onChange={(e) => setChecked(e.target.checked ? new Set(untrackedVisible.map((r) => r.query)) : new Set())}
              />
            </th>
            {header('query', 'Keyword')}
            {header('position', 'Position', 'num')}
            {header('clicks', 'Clicks', 'num')}
            {header('impressions', 'Impressions', 'num')}
            {header('ctr', 'CTR', 'num')}
            <th>Page</th>
            <th className="num">
              <CopyButton
                headers={['Keyword', 'Position', 'Clicks', 'Impressions', 'CTR %', 'Page', 'Tracked']}
                rows={rows.map((i) => [i.query, i.position, i.clicks, i.impressions, i.ctr * 100, i.page, i.tracked ? 'yes' : 'no'])}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.query} onClick={() => !item.tracked && toggle(item.query)}>
              <td className="check-col">
                <input type="checkbox" disabled={item.tracked} checked={checked.has(item.query)} onChange={() => toggle(item.query)} onClick={(e) => e.stopPropagation()} />
              </td>
              <td>{item.query}</td>
              <td className="num">{item.position.toFixed(1)}</td>
              <td className="num">{item.clicks.toLocaleString()}</td>
              <td className="num">{item.impressions.toLocaleString()}</td>
              <td className="num">{(item.ctr * 100).toFixed(1)}%</td>
              <td>
                {item.page ? (
                  <span className="page-cell" title={item.page}>
                    <a href={item.page} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      {shortUrl(item.page, project.siteUrl)}
                    </a>
                  </span>
                ) : (
                  <span className="muted">–</span>
                )}
              </td>
              <td className="num">
                {item.tracked ? (
                  <span className="muted small">Tracked</span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void add([item.query]);
                    }}
                  >
                    Add
                  </button>
                )}
              </td>
            </tr>
          ))}
          {items && rows.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                No ranking keywords with these filters.
              </td>
            </tr>
          )}
          {!items && loading && (
            <tr>
              <td colSpan={8} className="muted">
                Loading from Search Console…
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
