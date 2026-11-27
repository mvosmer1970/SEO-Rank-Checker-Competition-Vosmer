// Site research, Keywords tab: the suggested keywords of the Content tab (without duplicates) plus the user's own,
// checked in Google through Serper (top 100) for the position of the site, its ranking page and the top 3. Every check
// is stored with its date; the next check shows the change.
import { useEffect, useMemo, useState } from 'react';
import type { ResearchData, ResearchKeyword, ResearchSite, SerperStatus } from '../shared/types';
import { api, errorMessage } from './api';
import { CopyButton } from './CopyButton';
import { pathOf } from './siteAnalysis';
import { ExternalLink, sortRows, useSort } from './table';

interface Props {
  site: ResearchSite;
  data: ResearchData;
  /** Suggested keyword -> number of pages (of the Content tab, without release notes and legal pages). */
  suggestions: Map<string, number>;
  onData: (data: ResearchData) => void;
  onError: (message: string) => void;
}

type SortKey = 'keyword' | 'pages' | 'position' | 'change' | 'url' | 'top' | 'date';

/** At most this many keywords per check (one Serper search each). */
const MAX_CHECK = 200;

function positionText(position: number | undefined, depth: number): string {
  return position === undefined ? `>${depth}` : String(position);
}

/** Positive = better (moved up); undefined without a previous check. */
function change(k: ResearchKeyword | undefined): { text: string; value: number | undefined; className: string } {
  if (!k?.previous) return { text: '', value: undefined, className: '' };
  const before = k.previous.position;
  const now = k.position;
  if (before === undefined && now === undefined) return { text: '–', value: 0, className: 'muted' };
  if (before === undefined) return { text: 'new', value: 1000, className: 'up' };
  if (now === undefined) return { text: 'lost', value: -1000, className: 'down' };
  const diff = before - now;
  if (diff === 0) return { text: '–', value: 0, className: 'muted' };
  return { text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}`, value: diff, className: diff > 0 ? 'up' : 'down' };
}

export function ResearchKeywords({ site, data, suggestions, onData, onError }: Props) {
  const [serper, setSerper] = useState<SerperStatus>({ configured: false, source: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newKeywords, setNewKeywords] = useState('');
  const [checking, setChecking] = useState(false);
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState<string | undefined>();
  const { sort, th } = useSort<SortKey>({ key: 'pages', asc: false }, ['keyword', 'position', 'url', 'top', 'date']);

  useEffect(() => {
    api.getSerperStatus().then(setSerper, (e: unknown) => onError(errorMessage(e)));
  }, [onError]);

  const checks = useMemo(() => new Map(data.keywords.map((k) => [k.keyword, k])), [data.keywords]);
  const removed = useMemo(() => new Set(data.removedKeywords), [data.removedKeywords]);
  const list = useMemo(
    () => [...new Set([...suggestions.keys(), ...data.addedKeywords])].filter((k) => !removed.has(k)),
    [suggestions, data.addedKeywords, removed],
  );

  const rows = useMemo(() => {
    const needles = search.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = list.filter((k) => needles.every((n) => `${k} ${checks.get(k)?.url ?? ''}`.toLowerCase().includes(n)));
    const value = (k: string): string | number | undefined => {
      const c = checks.get(k);
      switch (sort.key) {
        case 'keyword':
          return k;
        case 'pages':
          return suggestions.get(k) ?? 0;
        case 'position':
          return c ? (c.position ?? 1000 + c.depth) : undefined;
        case 'change':
          return change(c).value;
        case 'url':
          return c?.url;
        case 'top':
          return c?.top[0]?.domain;
        case 'date':
          return c?.checkedAt;
      }
    };
    return sortRows(filtered, value, sort.asc);
  }, [list, checks, suggestions, search, sort]);

  const saveList = (added: string[], removedList: string[]) =>
    api.setResearchKeywordList(site.id, added, removedList).then(onData, (e: unknown) => onError(errorMessage(e)));

  const addKeywords = () => {
    const words = newKeywords
      .split(/\r?\n|,/)
      .map((k) => k.trim().toLowerCase().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (!words.length) return;
    // An added keyword that was removed before comes back.
    void saveList([...data.addedKeywords, ...words], data.removedKeywords.filter((k) => !words.includes(k)));
    setNewKeywords('');
  };

  const remove = (keywords: string[]) => {
    const set = new Set(keywords);
    void saveList(
      data.addedKeywords.filter((k) => !set.has(k)),
      [...data.removedKeywords, ...keywords.filter((k) => suggestions.has(k))],
    );
    setSelected((s) => new Set([...s].filter((k) => !set.has(k))));
  };

  // The selected keywords, or all of the list when none is selected.
  const toCheck = selected.size ? [...selected].filter((k) => list.includes(k)) : list;
  const tooMany = toCheck.length > MAX_CHECK;

  const check = async () => {
    setChecking(true);
    try {
      onData(await api.checkResearchKeywords(site.id, toCheck));
      setSelected(new Set());
    } catch (e) {
      onError(errorMessage(e));
      // Keywords checked before the error are stored.
      api.getResearchData(site.id).then(onData, () => undefined);
    } finally {
      setChecking(false);
    }
  };

  const checked = list.map((k) => checks.get(k)).filter((c): c is ResearchKeyword => !!c);
  const ranking = checked.filter((c) => c.position !== undefined);
  const top10 = ranking.filter((c) => (c.position ?? 999) <= 10).length;
  const shownCheck = shown ? checks.get(shown) : undefined;

  return (
    <>
      {!serper.configured && (
        <div className="banner">Enter your Serper.dev API key under Settings (or SERPER_API_KEY in .env) to check rankings.</div>
      )}

      <div className="row">
        <button
          className="primary"
          disabled={checking || !serper.configured || toCheck.length === 0 || tooMany}
          onClick={() => void check()}
          title={`Google ${site.serpCountry}/${site.serpLanguage}, top 100`}
        >
          {checking ? 'Checking…' : `Check rankings: ${toCheck.length} keyword${toCheck.length === 1 ? '' : 's'} = ${toCheck.length} Serper search${toCheck.length === 1 ? '' : 'es'}`}
        </button>
        <span className={`small ${tooMany ? 'down' : 'muted'}`}>
          {selected.size ? `${selected.size} selected` : 'All keywords (select rows to check only those)'} · max {MAX_CHECK} per check · Google{' '}
          {site.serpCountry}/{site.serpLanguage}, top 100
        </span>
      </div>

      <div className="keywords-layout">
        {shownCheck && (
          <div className="side-column">
            <section className="card">
              <div className="row comparison-header">
                <h3>Google top 10: {shownCheck.keyword}</h3>
                <button onClick={() => setShown(undefined)}>Close</button>
              </div>
              <p className="muted small">
                Checked {shownCheck.checkedAt} · {shownCheck.depth} results fetched
                {shownCheck.previous ? ` · before: ${positionText(shownCheck.previous.position, shownCheck.previous.depth)} on ${shownCheck.previous.checkedAt}` : ''}
              </p>
              <ol className="serp-list">
                {shownCheck.top.map((e) => (
                  <li key={e.position} className={e.url === shownCheck.url ? 'own-item' : ''}>
                    <div>{e.title}</div>
                    <ExternalLink url={e.url} label={e.url.replace(/^https?:\/\//, '')} />
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
        <div className="keywords-main">
          <section className="card">
            <div className="row list-actions">
              <h3>
                Keywords ({list.length}) · {checked.length} checked · {ranking.length} ranking · {top10} in top 10
              </h3>
              <div className="row">
                <input
                  type="search"
                  className="keyword-search"
                  placeholder="Search keyword or URL"
                  spellCheck={false}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button onClick={() => setSelected(new Set(rows))}>Select shown</button>
                <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                  Clear selection
                </button>
                <button className="danger" onClick={() => remove([...selected])} disabled={selected.size === 0}>
                  Remove selected
                </button>
              </div>
            </div>
            <table className="keywords">
              <thead>
                <tr>
                  <th />
                  {th('keyword', 'Keyword')}
                  {th('pages', 'Pages', 'num')}
                  {th('position', 'Position', 'num')}
                  {th('change', 'Change', 'num')}
                  {th('url', 'Ranking page')}
                  {th('top', 'Top 3')}
                  {th('date', 'Checked')}
                  <th className="num">
                    <CopyButton
                      headers={['Keyword', 'Pages', 'Position', 'Change', 'Ranking page', 'Top 3', 'Checked']}
                      rows={rows.map((k) => {
                        const c = checks.get(k);
                        return [
                          k,
                          suggestions.get(k) ?? 'added',
                          c ? positionText(c.position, c.depth) : '',
                          change(c).text,
                          c?.url ?? '',
                          c ? c.top.slice(0, 3).map((e) => e.domain).join(', ') : '',
                          c?.checkedAt ?? '',
                        ];
                      })}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => {
                  const c = checks.get(k);
                  const diff = change(c);
                  return (
                    <tr key={k} className={k === shown ? 'selected' : ''} onClick={() => c && setShown(k)}>
                      <td
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = new Set(selected);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          setSelected(next);
                        }}
                      >
                        <input type="checkbox" checked={selected.has(k)} readOnly />
                      </td>
                      <td>{k}</td>
                      <td className="num">{suggestions.get(k) ?? <span className="muted small">added</span>}</td>
                      <td className={`num${!c ? '' : c.position === undefined ? ' muted' : c.position <= 10 ? ' up' : ''}`}>
                        {c ? positionText(c.position, c.depth) : ''}
                      </td>
                      <td
                        className={`num ${diff.className}`}
                        title={c?.previous ? `${positionText(c.previous.position, c.previous.depth)} on ${c.previous.checkedAt}` : undefined}
                      >
                        {diff.text}
                      </td>
                      <td>{c?.url ? <ExternalLink url={c.url} label={pathOf(c.url)} /> : ''}</td>
                      <td className="small">{c ? c.top.slice(0, 3).map((e) => e.domain).join(', ') : ''}</td>
                      <td className="small nowrap">{c?.checkedAt ?? ''}</td>
                      <td className="num">
                        <button
                          className="link"
                          title="Remove from the list"
                          onClick={(e) => {
                            e.stopPropagation();
                            remove([k]);
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">
                      No keywords. Crawl the site, or add your own below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="card form">
            <label>
              Add keywords (one per line or comma separated)
              <textarea rows={3} value={newKeywords} spellCheck={false} onChange={(e) => setNewKeywords(e.target.value)} />
            </label>
            <div className="row">
              <button className="primary" disabled={!newKeywords.trim()} onClick={addKeywords}>
                Add keywords
              </button>
              {data.removedKeywords.length > 0 && (
                <button onClick={() => void saveList(data.addedKeywords, [])} title={data.removedKeywords.join(', ')}>
                  Restore {data.removedKeywords.length} removed suggestion{data.removedKeywords.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
