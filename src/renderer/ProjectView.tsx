import { Fragment, useEffect, useMemo, useState } from 'react';
import { daysAgo, formatDate, formatPosition, isLowData, summarize, summarizeKeyword, validDays, type KeywordSummary } from '../shared/metrics';
import type { Keyword, KeywordPage, Project, ProjectHistory, RankAlert, SyncResult, TargetHistory } from '../shared/types';
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

/** A "Latest" position from a day longer ago than this is shown grey: it is no current position. */
const STALE_DAYS = 30;

type SortKey = 'text' | 'tags' | 'page' | 'latest' | 'week' | 'month' | 'change' | 'best' | 'bestPage' | 'clicks28' | 'impressions28';

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

/** The path of a URL, without the domain. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURI(`${parsed.pathname}${parsed.search}`);
  } catch {
    return url;
  }
}

/**
 * Another page that Google showed more often than the target page in the last 28 days (cannibalization), undefined
 * when the target page is shown most or there is no target page.
 */
function cannibal(keyword: Keyword): { page: KeywordPage; targetImpressions: number } | undefined {
  if (!keyword.targetPage) return undefined;
  const target = keyword.pages28.find((p) => samePage(p.url, keyword.targetPage));
  const targetImpressions = target?.impressions ?? 0;
  const other = keyword.pages28.find((p) => !samePage(p.url, keyword.targetPage) && p.impressions > targetImpressions);
  return other ? { page: other, targetImpressions } : undefined;
}

function samePage(a: string, b: string): boolean {
  return a.replace(/\/$/, '') === b.replace(/\/$/, '');
}

/** The page with the best position in the last 28 days ("Best"). */
function bestAnyPage(keyword: Keyword): KeywordPage | undefined {
  return keyword.pages28.reduce<KeywordPage | undefined>((best, p) => (!best || p.position < best.position ? p : best), undefined);
}

/** "Best page": the target page in the last 28 days, or without target page the page with the best position. */
function bestPage(keyword: Keyword): KeywordPage | undefined {
  return keyword.targetPage ? keyword.pages28.find((p) => samePage(p.url, keyword.targetPage)) : bestAnyPage(keyword);
}

interface PageRow {
  url: string;
  d7: KeywordPage | undefined;
  d28: KeywordPage | undefined;
}

/** Every page that ranked for the keyword in the last 7 or 28 days, the best position first. */
function pageRows(keyword: Keyword): PageRow[] {
  const rows = new Map<string, PageRow>();
  for (const p of keyword.pages28) rows.set(p.url, { url: p.url, d7: undefined, d28: p });
  for (const p of keyword.pages7) rows.set(p.url, { url: p.url, d28: rows.get(p.url)?.d28, d7: p });
  const position = (r: PageRow) => r.d28?.position ?? r.d7?.position ?? Infinity;
  return [...rows.values()].sort((a, b) => position(a) - position(b));
}

/** A position, grey with "?" when it is based on fewer than 5 impressions. */
function Position({ value, impressions, title = '' }: { value: number | undefined; impressions: number; title?: string }) {
  if (value === undefined) return <>–</>;
  const low = isLowData(impressions);
  return (
    <span className={low ? 'lowdata' : ''} title={`${title}${title ? '\n' : ''}Based on ${impressions} impression${impressions === 1 ? '' : 's'}${low ? ' (too few to be reliable)' : ''}`}>
      {formatPosition(value)}
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
  const [search, setSearch] = useState('');
  const [tagEdit, setTagEdit] = useState<{ id: string; text: string } | undefined>();
  const [targets, setTargets] = useState<TargetHistory>({});
  // The keywords whose pages are shown (the ▸ / ▾ in front of the keyword).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Reloaded after every sync of this project, also the automatic ones.
  useEffect(() => {
    api.getHistory(project.id).then(setHistory, (e: unknown) => onError(errorMessage(e)));
    api.getTargetHistory(project.id).then(setTargets, (e: unknown) => onError(errorMessage(e)));
  }, [project.id, lastSync, onError]);

  /** The days the main columns are computed from: of the target page when the keyword has one, else of all pages. */
  const daysOf = (keyword: Keyword) =>
    keyword.targetPage ? (targets[keyword.id]?.page === keyword.targetPage ? targets[keyword.id]?.days : undefined) ?? {} : (history[keyword.id] ?? {});

  /** A ranking page (path without domain) with the ◎ / ◉ to make it the target page or remove it. */
  const pageLink = (keyword: Keyword, url: string) => {
    const isTarget = !!keyword.targetPage && samePage(url, keyword.targetPage);
    return (
      <span className="page-cell" title={url}>
        <button
          className={`link target-button${isTarget ? ' set' : ''}`}
          title={isTarget ? 'Target page (click to remove)' : 'Make this the target page'}
          onClick={(e) => {
            e.stopPropagation();
            void saveTarget(keyword, isTarget ? '' : url);
          }}
        >
          {isTarget ? '◉' : '◎'}
        </button>
        <a href={url} target="_blank" rel="noreferrer" className={isTarget ? 'target-link' : ''} onClick={(e) => e.stopPropagation()}>
          {pathOf(url)}
        </a>
      </span>
    );
  };

  const saveTarget = async (keyword: Keyword, text: string) => {
    if (text.trim() === keyword.targetPage) return;
    try {
      onChanged(await api.setKeywordTarget(project.id, keyword.id, text));
      setTargets(await api.getTargetHistory(project.id));
    } catch (e) {
      onError(errorMessage(e));
    }
  };

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
    // Every word of the search text must match the keyword, one of its tags or one of its pages.
    const needles = search.toLowerCase().split(/\s+/).filter(Boolean);
    const list = project.keywords
      .filter((k) => !filterTag || k.tags.includes(filterTag))
      .filter((k) => {
        const haystack = [k.text, ...k.tags, ...k.pages.map((p) => p.url)].map((s) => s.toLowerCase());
        return needles.every((n) => haystack.some((s) => s.includes(n)));
      })
      .map((k) => ({ keyword: k, summary: summarizeKeyword(daysOf(k)), all: summarizeKeyword(history[k.id] ?? {}) }));
    const value = (r: (typeof list)[number]): string | number | undefined => {
      switch (sort.key) {
        case 'text':
          return r.keyword.text;
        case 'tags':
          return r.keyword.tags.join(', ').toLowerCase() || undefined;
        case 'page':
          return r.keyword.targetPage || r.keyword.pages[0]?.url;
        case 'best':
          return bestAnyPage(r.keyword)?.position;
        case 'bestPage':
          return bestPage(r.keyword)?.position;
        case 'latest':
          return r.summary.latestPosition;
        case 'week':
          return r.summary.week;
        case 'month':
          return r.summary.month;
        case 'change':
          return change(r.summary);
        case 'clicks28':
          return r.all.clicks28;
        case 'impressions28':
          return r.all.impressions28;
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
    // daysOf only reads history and targets.
  }, [project.keywords, history, targets, sort, filterTag, search]);

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
      onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : ['text', 'tags', 'page', 'latest', 'week', 'month', 'best', 'bestPage'].includes(key) }))}
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
      {signedIn &&
        project.keywords.some((k) => k.pages.length > 0) &&
        project.keywords.every((k) => k.pages7.length === 0 && k.pages28.length === 0) && (
          <div className="banner">
            Click “Sync now” once to load the pages per keyword over 7 and 28 days (for expanding the rows, Best, Best page and the
            target pages).
          </div>
        )}
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
                {selected.targetPage && <p className="muted small chart-note">Target page: {shortUrl(selected.targetPage, project.siteUrl)}</p>}
                <RankChart days={daysOf(selected)} />
              </section>
            )}
            <Notes project={project} onChanged={onChanged} onError={onError} />
          </div>
          <div className="keywords-main">

          {project.keywords.length > 0 && (
            <div className="row tag-filter">
              {tagSummaries.length > 0 && (
                <>
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
                </>
              )}
              <input
                type="search"
                className="keyword-search"
                placeholder="Search keyword, tag or page (all words)"
                spellCheck={false}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearch('');
                }}
              />
              {(search.trim() || filterTag) && <span className="muted small">{rows.length} shown</span>}
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
                  {header('tags', 'Tags')}
                  {header('page', 'Page')}
                  {header('latest', 'Latest', 'num')}
                  {header('week', 'Avg 7 days', 'num')}
                  {header('month', 'Avg 28 days', 'num')}
                  {header('change', 'Change', 'num')}
                  {header('best', 'Best', 'num')}
                  {header('bestPage', 'Best page', 'num')}
                  {header('clicks28', 'Clicks 28d', 'num')}
                  {header('impressions28', 'Impr. 28d', 'num')}
                  <th className="num">
                    <CopyButton
                      headers={[
                        'Keyword',
                        'Tags',
                        'Page',
                        'Target page',
                        'Latest',
                        'Avg 7 days',
                        'Avg 28 days',
                        'Change',
                        'Best',
                        'Best page position',
                        'Best page',
                        'Other page shown more',
                        'Clicks 28d',
                        'Impressions 28d',
                      ]}
                      rows={rows.map(({ keyword, summary, all }) => [
                        keyword.text,
                        keyword.tags.join(', '),
                        keyword.pages[0]?.url,
                        keyword.targetPage,
                        summary.latestPosition,
                        summary.week,
                        summary.month,
                        change(summary),
                        bestAnyPage(keyword)?.position,
                        bestPage(keyword)?.position,
                        bestPage(keyword)?.url,
                        cannibal(keyword)?.page.url,
                        all.clicks28,
                        all.impressions28,
                      ])}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ keyword, summary, all }) => {
                  const diff = change(summary);
                  const best = bestPage(keyword);
                  const allPages = keyword.targetPage ? `All pages together: ${formatPosition(all.week)} (7 days)` : '';
                  const changeImpressions = Math.min(summary.weekImpressions, summary.previousWeekImpressions);
                  const subRows = pageRows(keyword);
                  // With 2 or more pages they are rows below the keyword (▸ / ▾), one page is in the Page column.
                  const expandable = subRows.length > 1;
                  const isExpanded = expanded.has(keyword.id) && expandable;
                  const bestAny = bestAnyPage(keyword);
                  const conflict = cannibal(keyword);
                  return (
                    <Fragment key={keyword.id}>
                    <tr
                      className={`${keyword.id === selectedId ? 'selected' : ''}${conflict ? ' cannibal-row' : ''}`}
                      title={
                        conflict
                          ? `Google showed another page more often than the target page in the last 28 days:\n${conflict.page.url} (${conflict.page.impressions} impressions)\nTarget page: ${conflict.targetImpressions} impressions`
                          : undefined
                      }
                      onClick={() => setSelectedId(keyword.id)}
                    >
                      <td>
                        {expandable ? (
                          <button
                            className="link expand-arrow"
                            title={isExpanded ? 'Hide the pages' : `Show the ${subRows.length} pages that ranked (7 and 28 days)`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded(keyword.id);
                            }}
                          >
                            {isExpanded ? '▾' : '▸'}
                          </button>
                        ) : (
                          <span className="expand-arrow-space" />
                        )}
                        {keyword.text}
                      </td>
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
                      <td>{subRows.length === 1 && subRows[0] ? pageLink(keyword, subRows[0].url) : subRows.length === 0 ? <span className="muted">–</span> : null}</td>

                      <td
                        className={`num${summary.latestDate && summary.latestDate < daysAgo(STALE_DAYS) ? ' stale' : ''}`}
                      >
                        <Position
                          value={summary.latestPosition}
                          impressions={summary.latestImpressions}
                          title={[
                            summary.latestDate ? formatDate(summary.latestDate) : 'No impressions yet',
                            summary.latestDate && summary.latestDate < daysAgo(STALE_DAYS) ? `(older than ${STALE_DAYS} days)` : '',
                            allPages,
                          ]
                            .filter(Boolean)
                            .join('\n')}
                        />
                      </td>
                      <td className="num">
                        <Position value={summary.week} impressions={summary.weekImpressions} title={allPages} />
                      </td>
                      <td className="num">
                        <Position value={summary.month} impressions={summary.impressions28} />
                      </td>
                      <td
                        className={`num ${diff === undefined || Math.abs(diff) < 0.05 || isLowData(changeImpressions) ? '' : diff > 0 ? 'up' : 'down'}`}
                      >
                        {diff === undefined ? (
                          '–'
                        ) : (
                          <span
                            className={isLowData(changeImpressions) ? 'lowdata' : ''}
                            title={`This week ${summary.weekImpressions} impressions, the week before ${summary.previousWeekImpressions}${isLowData(changeImpressions) ? ' (too few to be reliable)' : ''}`}
                          >
                            {`${diff > 0 ? '▲' : diff < 0 ? '▼' : ''} ${Math.abs(diff).toFixed(1)}`}
                          </span>
                        )}
                      </td>
                      <td className="num">
                        <Position
                          value={bestAny?.position}
                          impressions={bestAny?.impressions ?? 0}
                          title={bestAny ? `Best position of a page, last 28 days\n${bestAny.url}` : ''}
                        />
                      </td>
                      <td className="num">
                        <Position
                          value={best?.position}
                          impressions={best?.impressions ?? 0}
                          title={best ? `${keyword.targetPage ? 'Target page' : 'Page with the best position'}, last 28 days\n${best.url}` : ''}
                        />
                      </td>
                      <td className="num">{all.clicks28.toLocaleString()}</td>
                      <td className="num">{all.impressions28.toLocaleString()}</td>
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
                    {isExpanded &&
                      subRows.map((p) => {
                        const isTarget = !!keyword.targetPage && samePage(p.url, keyword.targetPage);
                        return (
                          <tr key={`${keyword.id}:${p.url}`} className={`page-sub-row${isTarget ? ' target-row' : ''}`}>
                            <td />
                            <td />
                            <td>{pageLink(keyword, p.url)}</td>
                            <td />
                            <td className="num">
                              <Position value={p.d7?.position} impressions={p.d7?.impressions ?? 0} title="This page, last 7 days" />
                              <div className="muted small">{p.d7?.impressions ?? 0} impr.</div>
                            </td>
                            <td className="num">
                              <Position value={p.d28?.position} impressions={p.d28?.impressions ?? 0} title="This page, last 28 days" />
                              <div className="muted small">{p.d28?.impressions ?? 0} impr.</div>
                            </td>
                            <td />
                            <td />
                            <td />
                            <td className="num" title={`7 days: ${p.d7?.clicks ?? 0} clicks`}>
                              {p.d28?.clicks ?? 0}
                            </td>
                            <td className="num">{p.d28?.impressions ?? 0}</td>
                            <td />
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="muted">
                      {search.trim()
                        ? 'No keywords match the search.'
                        : filterTag
                          ? 'No keywords with this tag.'
                          : 'No keywords yet. Add them below or from the Opportunities tab.'}
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
