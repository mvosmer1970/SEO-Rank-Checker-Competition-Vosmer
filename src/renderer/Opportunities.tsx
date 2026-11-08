// Queries of the project in Search Console (last 28 days) at position 5–20 with at least 5 impressions, not tracked yet.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Opportunity, Project } from '../shared/types';
import { api, errorMessage } from './api';
import { CopyButton } from './CopyButton';

type SortKey = 'query' | 'position' | 'impressions' | 'clicks';

interface Props {
  project: Project;
  signedIn: boolean;
  onAdded: (project: Project) => void;
  onError: (message: string) => void;
}

export function Opportunities({ project, signedIn, onAdded, onError }: Props) {
  const [items, setItems] = useState<Opportunity[] | undefined>();
  const [loading, setLoading] = useState(false);
  // Most impressions first, as loaded.
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'impressions', asc: false });

  const load = useCallback(() => {
    setLoading(true);
    api
      .getOpportunities(project.id)
      .then(setItems, (e: unknown) => onError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [project.id, onError]);

  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  const add = async (item: Opportunity) => {
    try {
      onAdded(await api.addKeywords(project.id, [item.query], []));
      setItems((list) => list?.filter((i) => i.query !== item.query));
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const rows = useMemo(() => {
    const list = [...(items ?? [])];
    return list.sort((a, b) => {
      const cmp = sort.key === 'query' ? a.query.localeCompare(b.query) : a[sort.key] - b[sort.key];
      return sort.asc ? cmp : -cmp;
    });
  }, [items, sort]);

  const header = (key: SortKey, label: string, className = '') => (
    <th
      className={`sortable ${className}`}
      onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : key === 'query' || key === 'position' }))}
    >
      {label}
      {sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  if (!signedIn) return <div className="banner">Sign in with Google under Settings to see opportunities.</div>;

  return (
    <section className="card">
      <div className="row opportunities-header">
        <span className="muted small">
          Search queries of the last 28 days at position 5–20 with at least 5 impressions that you do not track yet
          {project.country ? ` (${project.country.toUpperCase()})` : ''}. Add them, then sync to fetch their history.
        </span>
        <button onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <table className="keywords">
        <thead>
          <tr>
            {header('query', 'Query')}
            {header('position', 'Position', 'num')}
            {header('impressions', 'Impressions', 'num')}
            {header('clicks', 'Clicks', 'num')}
            <th className="num">
              <CopyButton
                headers={['Query', 'Position', 'Impressions', 'Clicks']}
                rows={rows.map((i) => [i.query, i.position, i.impressions, i.clicks])}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.query}>
              <td>{item.query}</td>
              <td className="num">{item.position.toFixed(1)}</td>
              <td className="num">{item.impressions.toLocaleString()}</td>
              <td className="num">{item.clicks.toLocaleString()}</td>
              <td className="num">
                <button onClick={() => void add(item)}>Add</button>
              </td>
            </tr>
          ))}
          {items?.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No opportunities found.
              </td>
            </tr>
          )}
          {!items && loading && (
            <tr>
              <td colSpan={5} className="muted">
                Loading from Search Console…
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
