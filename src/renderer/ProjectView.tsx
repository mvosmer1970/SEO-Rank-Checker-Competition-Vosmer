import { useEffect, useMemo, useState } from 'react';
import { daysAgo, formatDate, formatPosition, summarize, summarizeKeyword, validDays, type KeywordSummary } from '../shared/metrics';
import type { Keyword, KeywordPage, Project, ProjectHistory, RankAlert, SyncResult } from '../shared/types';
import { api, errorMessage } from './api';
import { Competition } from './Competition';
import { CopyButton } from './CopyButton';
import { Notes } from './Notes';
import { buildProjectReport } from './projectExport';
import { Opportunities } from './Opportunities';
import { ProjectForm } from './ProjectForm';
import { RankChart } from './RankChart';
import { RankingKeywords } from './RankingKeywords';

interface Props {
  project: Project;
  signedIn: boolean;
  /** The last sync of this project (manual or automatic), if any since the app started. */
  lastSync: SyncResult | undefined;
  onChanged: (project: Project) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}

type SortKey = 'text' | 'latest' | 'week' | 'change' | 'clicks28' | 'impressions28';

const DEVICE_LABELS: Record<string, string> = { '': 'All devices', DESKTOP: 'Desktop', MOBILE: 'Mobile', TABLET: 'Tablet' };

/** Positive = better (moved up). */
function change(s: KeywordSummary): number | undefined {
  return s.week !== undefined && s.previousWeek !== undefined ? s.previousWeek - s.week : undefined;
}

function parseTags(text: string): string[] {
  return text.split(',').map((t) => t.trim()).filter(Boolean);
}

/** The path of a URL (host included when the property is a domain property with several hosts). */
export function shortUrl(url: string, siteUrl: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return siteUrl.startsWith('sc-domain:') ? `${parsed.host}${path}` : path;
  } catch {
    return url;
  }
}

function describeAlert(alert: RankAlert): string {
  const from = alert.from === undefined ? 'not ranking' : alert.from.toFixed(1);
  return alert.kind === 'drop'
    ? `▼ ${alert.keyword} dropped ${from} → ${alert.to.toFixed(1)}`
    : `★ ${alert.keyword} entered the top 10 (${from} → ${alert.to.toFixed(1)})`;
}

function PageCell({ pages, siteUrl }: { pages: KeywordPage[]; siteUrl: string }) {
  const [first] = pages;
  if (!first) return <span className="muted">–</span>;
  const details = pages
    .map((p) => `${p.url}\n   position ${p.position.toFixed(1)} · ${p.impressions} impressions · ${p.clicks} clicks`)
    .join('\n');
  return (
    <span className="page-cell" title={details}>
      <a href={first.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {shortUrl(first.url, siteUrl)}
      </a>
      {pages.length > 1 && <span className="badge warn">+{pages.length - 1}</span>}
    </span>
  );
}

export function ProjectView({ project, signedIn, lastSync, onChanged, onDeleted, onError }: Props) {
  const [tab, setTab] = useState<'keywords' | 'ranking' | 'opportunities' | 'competition'>('keywords');
  const [history, setHistory] = useState<ProjectHistory>({});
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [newKeywords, setNewKeywords] = useState('');
  const [newTags, setNewTags] = useState('');
  const [selectedId, setSelectedId] = useState<string | undefined>(project.keywords[0]?.id);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'text', asc: true });
  const [activeTag, setActiveTag] = useState<string | undefined>();
  const [tagEdit, setTagEdit] = useState<{ id: string; text: string } | undefined>();

  // Reloaded after every sync of this project, also the automatic ones.
  useEffect(() => {
    api.getHistory(project.id).then(setHistory, (e: unknown) => onError(errorMessage(e)));
  }, [project.id, lastSync, onError]);

  const allTags = useMemo(
    () => [...new Set(project.keywords.flatMap((k) => k.tags))].sort((a, b) => a.localeCompare(b)),
    [project.keywords],
  );

  // A tag that no keyword has any more is no filter.
  const filterTag = activeTag && allTags.includes(activeTag) ? activeTag : undefined;

  /** Per tag: number of keywords and the impression-weighted average position of the last 7 days. */
  const tagSummaries = useMemo(() => {
    const today = daysAgo(0);
    return allTags.map((tag) => {
      const keywords = project.keywords.filter((k) => k.tags.includes(tag));
      let weighted = 0;
      let impressions = 0;
      for (const k of keywords) {
        const week = summarize(validDays(history[k.id] ?? {}), daysAgo(6), today);
        if (week.position !== undefined) {
          weighted += week.position * week.impressions;
          impressions += week.impressions;
        }
      }
      return { tag, count: keywords.length, position: impressions > 0 ? weighted / impressions : undefined };
    });
  }, [allTags, project.keywords, history]);

  const rows = useMemo(() => {
    const list = project.keywords
      .filter((k) => !filterTag || k.tags.includes(filterTag))
      .map((k) => ({ keyword: k, summary: summarizeKeyword(history[k.id] ?? {}) }));
    const value = (r: (typeof list)[number]): string | number | undefined => {
      switch (sort.key) {
        case 'text':
          return r.keyword.text;
        case 'latest':
          return r.summary.latestPosition;
        case 'week':
          return r.summary.week;
        case 'change':
          return change(r.summary);
        case 'clicks28':
          return r.summary.clicks28;
        case 'impressions28':
          return r.summary.impressions28;
      }
    };
    return list.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      // Keywords without data always last.
      if (va === undefined) return vb === undefined ? 0 : 1;
      if (vb === undefined) return -1;
      const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : Number(va) - Number(vb);
      return sort.asc ? cmp : -cmp;
    });
  }, [project.keywords, history, sort, filterTag]);

  const selected = project.keywords.find((k) => k.id === selectedId);

  const [serperConfigured, setSerperConfigured] = useState(false);
  useEffect(() => {
    api.getSerperStatus().then((s) => setSerperConfigured(s.configured), () => setSerperConfigured(false));
  }, []);

  /** Search Console (when signed in) and the competition check (with a Serper key) together. */
  const sync = async () => {
    setSyncing(true);
    // The results arrive through onSynced / onSerpChecked (as for the automatic ones), which reload the data.
    const results = await Promise.allSettled([
      signedIn ? api.syncProject(project.id) : Promise.resolve(),
      serperConfigured ? api.checkCompetition(project.id) : Promise.resolve(),
    ]);
    const errors = results.flatMap((r) => (r.status === 'rejected' ? [errorMessage(r.reason)] : []));
    if (errors.length) onError(errors.join(' · '));
    setSyncing(false);
  };

  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');

  const copyAll = async () => {
    setCopyState('copying');
    try {
      await api.copyToClipboard(await buildProjectReport(project, history, signedIn));
      setCopyState('copied');
    } catch (e) {
      setCopyState('failed');
      onError(errorMessage(e));
    }
    setTimeout(() => setCopyState('idle'), 2500);
  };

  const addKeywords = async () => {
    try {
      const updated = await api.addKeywords(project.id, newKeywords.split(/\r?\n|,/), parseTags(newTags));
      onChanged(updated);
      setNewKeywords('');
      if (!selectedId) setSelectedId(updated.keywords[0]?.id);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const saveTags = async (keyword: Keyword, text: string) => {
    setTagEdit(undefined);
    const tags = parseTags(text);
    if (tags.join(',') === keyword.tags.join(',')) return;
    try {
      onChanged(await api.setKeywordTags(project.id, keyword.id, tags));
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const header = (key: SortKey, label: string, className = '') => (
    <th
      className={`sortable ${className}`}
      onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : key === 'text' || key === 'latest' || key === 'week' }))}
    >
      {label}
      {sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  if (editing) {
    return (
      <ProjectForm
        initial={{
          name: project.name,
          siteUrl: project.siteUrl,
          country: project.country,
          device: project.device,
          serpCountry: project.serpCountry,
          serpLanguage: project.serpLanguage,
          ownDomains: project.ownDomains,
          ignoredDomains: project.ignoredDomains,
        }}
        signedIn={signedIn}
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          const updated = await api.updateProject(project.id, input);
          onChanged(updated);
          setHistory(await api.getHistory(project.id));
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="page">
      <header className="project-header">
        <div>
          <h2>{project.name}</h2>
          <p className="muted small">
            {project.siteUrl} · {project.country ? project.country.toUpperCase() : 'All countries'} · {DEVICE_LABELS[project.device]} ·
            last sync {project.lastSyncAt ? new Date(project.lastSyncAt).toLocaleString() : 'never'}
          </p>
        </div>
        <div className="row">
          <button
            onClick={() => void copyAll()}
            disabled={copyState === 'copying'}
            title="Copy the settings (no API keys) and all data of this project to the clipboard"
          >
            {copyState === 'copying' ? 'Copying…' : copyState === 'copied' ? 'Copied ✓' : copyState === 'failed' ? 'Copy failed' : 'Copy all'}
          </button>
          <button
            className="primary"
            title={`Fetch the Search Console data${serperConfigured ? ' and the Google top 20 of the competition' : ''}`}
            onClick={() => void sync()}
            disabled={syncing || (!signedIn && !serperConfigured) || project.keywords.length === 0}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button onClick={() => setEditing(true)}>Edit</button>
          <button
            className="danger"
            onClick={() => {
              if (!window.confirm(`Delete project "${project.name}" and its history?`)) return;
              api.deleteProject(project.id).then(onDeleted, (e: unknown) => onError(errorMessage(e)));
            }}
          >
            Delete
          </button>
        </div>
      </header>
      {!signedIn && <div className="banner">Sign in with Google under Settings to sync rankings.</div>}
      {lastSync && (
        <div className={`banner ${lastSync.alerts.length ? '' : 'ok'}`}>
          <div>
            <div>
              Synced {lastSync.keywordsSynced} keywords ({formatDate(lastSync.fromDate)} – {formatDate(lastSync.toDate)})
              {lastSync.alerts.length ? `: ${lastSync.alerts.length} ranking change${lastSync.alerts.length === 1 ? '' : 's'}` : '.'}
            </div>
            {lastSync.alerts.map((a) => (
              <div key={a.keyword} className={a.kind === 'drop' ? 'down' : 'up'}>
                {describeAlert(a)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={`tab${tab === 'keywords' ? ' active' : ''}`} onClick={() => setTab('keywords')}>
          Keywords
        </button>
        <button className={`tab${tab === 'opportunities' ? ' active' : ''}`} onClick={() => setTab('opportunities')}>
          Opportunities
        </button>
        <button className={`tab${tab === 'ranking' ? ' active' : ''}`} onClick={() => setTab('ranking')}>
          Ranking keywords
        </button>
        <button className={`tab${tab === 'competition' ? ' active' : ''}`} onClick={() => setTab('competition')}>
          Competition
        </button>
      </div>

      {tab === 'competition' && <Competition project={project} history={history} onChanged={onChanged} onError={onError} />}

      {tab === 'ranking' && <RankingKeywords project={project} signedIn={signedIn} onAdded={onChanged} onError={onError} />}

      {tab === 'opportunities' && <Opportunities project={project} signedIn={signedIn} onAdded={onChanged} onError={onError} />}

      {tab === 'keywords' && (
        <div className="keywords-layout">
          <div className="side-column">
            {selected && (
              <section className="card">
                <h3>{selected.text}</h3>
                <RankChart days={history[selected.id] ?? {}} />
              </section>
            )}
            <Notes project={project} onChanged={onChanged} onError={onError} />
          </div>
          <div className="keywords-main">

          {tagSummaries.length > 0 && (
            <div className="row tag-filter">
              <button className={`chip${filterTag ? '' : ' active'}`} onClick={() => setActiveTag(undefined)}>
                All · {project.keywords.length}
              </button>
              {tagSummaries.map((t) => (
                <button
                  key={t.tag}
                  className={`chip${filterTag === t.tag ? ' active' : ''}`}
                  title="Number of keywords · average position of the last 7 days"
                  onClick={() => setActiveTag(filterTag === t.tag ? undefined : t.tag)}
                >
                  {t.tag} · {t.count} · avg {formatPosition(t.position)}
                </button>
              ))}
            </div>
          )}

          <section className="card">
            <datalist id="tag-options">
              {allTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <table className="keywords">
              <thead>
                <tr>
                  {header('text', 'Keyword')}
                  <th>Tags</th>
                  <th>Page</th>
                  {header('latest', 'Latest', 'num')}
                  {header('week', 'Avg 7 days', 'num')}
                  {header('change', 'Change', 'num')}
                  <th className="num">Best</th>
                  {header('clicks28', 'Clicks 28d', 'num')}
                  {header('impressions28', 'Impr. 28d', 'num')}
                  <th className="num">
                    <CopyButton
                      headers={['Keyword', 'Tags', 'Page', 'Latest', 'Avg 7 days', 'Change', 'Best', 'Clicks 28d', 'Impressions 28d']}
                      rows={rows.map(({ keyword, summary }) => [
                        keyword.text,
                        keyword.tags.join(', '),
                        keyword.pages[0]?.url,
                        summary.latestPosition,
                        summary.week,
                        change(summary),
                        summary.bestPosition,
                        summary.clicks28,
                        summary.impressions28,
                      ])}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ keyword, summary }) => {
                  const diff = change(summary);
                  return (
                    <tr key={keyword.id} className={keyword.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(keyword.id)}>
                      <td>{keyword.text}</td>
                      <td
                        className="tags-cell"
                        title="Click to edit the tags (comma separated)"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (tagEdit?.id !== keyword.id) setTagEdit({ id: keyword.id, text: keyword.tags.join(', ') });
                        }}
                      >
                        {tagEdit?.id === keyword.id ? (
                          <input
                            className="tag-input"
                            autoFocus
                            list="tag-options"
                            value={tagEdit.text}
                            onChange={(e) => setTagEdit({ id: keyword.id, text: e.target.value })}
                            onBlur={() => void saveTags(keyword, tagEdit.text)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveTags(keyword, tagEdit.text);
                              if (e.key === 'Escape') setTagEdit(undefined);
                            }}
                          />
                        ) : keyword.tags.length ? (
                          keyword.tags.map((t) => (
                            <span key={t} className="tag">
                              {t}
                            </span>
                          ))
                        ) : (
                          <span className="muted small">+ tag</span>
                        )}
                      </td>
                      <td>
                        <PageCell pages={keyword.pages} siteUrl={project.siteUrl} />
                      </td>
                      <td className="num" title={summary.latestDate ? formatDate(summary.latestDate) : 'No impressions yet'}>
                        {formatPosition(summary.latestPosition)}
                      </td>
                      <td className="num">{formatPosition(summary.week)}</td>
                      <td className={`num ${diff === undefined || Math.abs(diff) < 0.05 ? '' : diff > 0 ? 'up' : 'down'}`}>
                        {diff === undefined ? '–' : `${diff > 0 ? '▲' : diff < 0 ? '▼' : ''} ${Math.abs(diff).toFixed(1)}`}
                      </td>
                      <td className="num">{formatPosition(summary.bestPosition)}</td>
                      <td className="num">{summary.clicks28.toLocaleString()}</td>
                      <td className="num">{summary.impressions28.toLocaleString()}</td>
                      <td className="num">
                        <button
                          className="link"
                          title="Remove keyword"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!window.confirm(`Remove "${keyword.text}" and its history?`)) return;
                            api.deleteKeyword(project.id, keyword.id).then(onChanged, (err: unknown) => onError(errorMessage(err)));
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="muted">
                      {filterTag ? 'No keywords with this tag.' : 'No keywords yet. Add them below or from the Opportunities tab.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="card form">
            <label>
              Add keywords (one per line or comma separated)
              <textarea rows={4} value={newKeywords} onChange={(e) => setNewKeywords(e.target.value)} />
            </label>
            <label>
              Tags for these keywords (optional, comma separated)
              <input value={newTags} onChange={(e) => setNewTags(e.target.value)} list="tag-options" />
            </label>
            <div className="row">
              <button className="primary" disabled={!newKeywords.trim()} onClick={() => void addKeywords()}>
                Add keywords
              </button>
              <span className="hint">Search Console only has data for queries your site showed up for. Sync after adding.</span>
            </div>
          </section>
          </div>
        </div>
      )}
    </div>
  );
}
