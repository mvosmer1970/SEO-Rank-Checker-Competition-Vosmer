// Competition tab: the Google top 20 (Serper) of the tracked keywords, checked weekly or with the button.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  competitorOf,
  competitorStats,
  domainPosition,
  formatSerpPosition,
  gaps,
  latestResults,
  ownDomainSet,
} from '../shared/competition';
import { daysAgo, formatDate, formatPosition, summarize, validDays } from '../shared/metrics';
import type { Keyword, Project, ProjectHistory, SerpData, SerpEntry, SerperStatus } from '../shared/types';
import { api, errorMessage } from './api';
import { CompetitorChart } from './CompetitorChart';
import { CopyButton } from './CopyButton';
import { PageComparison, type ComparisonRequest } from './PageComparison';
import { shortUrl } from './ProjectView';
import { sortRows, useSort } from './table';

interface Props {
  project: Project;
  history: ProjectHistory;
  onChanged: (project: Project) => void;
  onError: (message: string) => void;
}

type View = 'competitors' | 'keywords' | 'gaps';

/** A URL of any site, shown with its host. */
function UrlLink({ url }: { url: string }) {
  return (
    <span className="page-cell" title={url}>
      <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {shortUrl(url, 'sc-domain:')}
      </a>
    </span>
  );
}

export function Competition({ project, history, onChanged, onError }: Props) {
  const [serp, setSerp] = useState<SerpData>({ results: {} });
  const [serper, setSerper] = useState<SerperStatus>({ configured: false, source: '' });
  const [view, setView] = useState<View>('competitors');
  const [competitorKey, setCompetitorKey] = useState<string | undefined>();
  const [keywordId, setKeywordId] = useState<string | undefined>();
  const [chartKeywordId, setChartKeywordId] = useState<string | undefined>();
  const [comparison, setComparison] = useState<ComparisonRequest | undefined>();
  const competitorSort = useSort<"label" | "top10" | "top20" | "avg" | "sov">({ key: "sov", asc: false }, ["label", "avg"]);
  const keywordSort = useSort<string>({ key: "", asc: true }, ["keyword", "lang", "gsc", "first"]);
  const gapSort = useSort<"keyword" | "competitors" | "mine" | "gsc">({ key: "keyword", asc: true }, ["keyword", "mine", "gsc"]);
  const detailSort = useSort<"keyword" | "theirs" | "mine" | "url">({ key: "theirs", asc: true }, ["keyword", "theirs", "mine", "url"]);

  const reload = useCallback(() => {
    api.getSerpData(project.id).then(setSerp, (e: unknown) => onError(errorMessage(e)));
  }, [project.id, onError]);

  useEffect(() => {
    reload();
    void api.getSerperStatus().then(setSerper);
  }, [reload]);

  // After every check: with Sync now, and weekly in the background.
  useEffect(() => api.onSerpChecked((result) => result.projectId === project.id && reload()), [project.id, reload]);

  const own = useMemo(() => ownDomainSet(project.ownDomains, project.siteUrl), [project.ownDomains, project.siteUrl]);
  const ownList = useMemo(() => [...own].sort(), [own]);
  const ignored = useMemo(() => new Set(project.ignoredDomains), [project.ignoredDomains]);
  // Filters: a tag limits the keywords that everything is computed over; the search text filters the lists.
  const [tagFilter, setTagFilter] = useState('');
  const [search, setSearch] = useState('');
  const allTags = useMemo(() => [...new Set(project.keywords.flatMap((k) => k.tags))].sort((a, b) => a.localeCompare(b)), [project.keywords]);
  const activeTag = allTags.includes(tagFilter) ? tagFilter : '';
  const latest = useMemo(
    () => latestResults(activeTag ? project.keywords.filter((k) => k.tags.includes(activeTag)) : project.keywords, serp),
    [project.keywords, serp, activeTag],
  );
  const hasData = useMemo(() => latestResults(project.keywords, serp).length > 0, [project.keywords, serp]);
  const needle = search.trim().toLowerCase();
  const matches = (...texts: string[]) => !needle || texts.some((t) => t.toLowerCase().includes(needle));
  const stats = useMemo(() => competitorStats(latest, own, ignored), [latest, own, ignored]);
  const gapList = useMemo(() => gaps(latest, own, ignored), [latest, own, ignored]);
  const lastDate = latest.map((l) => l.date).sort().pop();
  const counts = latest.map((l) => l.entries.length);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);

  /** Average position in Search Console over the last 28 days. */
  const gscAverage = (keyword: Keyword) => summarize(validDays(history[keyword.id] ?? {}), daysAgo(27), daysAgo(0)).position;

  const ignore = async (key: string) => {
    try {
      onChanged(
        await api.updateProject(project.id, {
          name: project.name,
          siteUrl: project.siteUrl,
          country: project.country,
          device: project.device,
          serpCountry: project.serpCountry,
          serpLanguage: project.serpLanguage,
          ownDomains: project.ownDomains,
          ignoredDomains: [...project.ignoredDomains, key],
        }),
      );
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const setLanguage = async (keyword: Keyword, language: string) => {
    try {
      onChanged(await api.setKeywordLanguage(project.id, keyword.id, language));
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const compare = (keyword: Keyword, entries: SerpEntry[], theirs: SerpEntry) => {
    const mine = domainPosition(entries, own);
    setComparison({
      keyword: keyword.text,
      theirUrl: theirs.url,
      theirPosition: theirs.position,
      // Your URL: from the check, or else the page of Search Console.
      myUrl: mine?.url ?? keyword.pages[0]?.url ?? '',
      myPosition: mine?.position,
    });
  };

  /** The best result that is not yours and not ignored. */
  const bestCompetitor = (entries: SerpEntry[]) =>
    entries.find((e) => {
      const { key } = competitorOf(e);
      return !own.has(key) && !ignored.has(key);
    });

  const languageSelect = (keyword: Keyword) => (
    <select
      className="small-select"
      value={keyword.serpLanguage}
      title="Google language (hl) of this keyword"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => void setLanguage(keyword, e.target.value)}
    >
      <option value="">Default ({project.serpLanguage})</option>
      <option value="nl">nl</option>
      <option value="en">en</option>
    </select>
  );

  const header = (
    <div className="row competition-header">
      <span className="muted small">
        Google {project.serpCountry.toUpperCase()} (Serper) · {project.keywords.length} keywords · last check {lastDate ? formatDate(lastDate) : 'never'}
        {latest.length > 0 && ` · ${minCount === maxCount ? maxCount : `${minCount}–${maxCount}`} results fetched per keyword`} · updated with
        Sync now and weekly
      </span>
      {hasData && (
        <div className="row">
          {allTags.length > 0 && (
            <select value={activeTag} onChange={(e) => setTagFilter(e.target.value)} title="Only the keywords with this tag (also for the stats)">
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <input
            className="competition-search"
            placeholder="Filter by keyword or competitor"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
    </div>
  );

  const hasDataNote = hasData && latest.length === 0 && (
    <div className="banner">No checked keywords with the tag “{activeTag}”.</div>
  );

  if (!serper.configured) {
    return (
      <>
        {header}
        <div className="banner">Enter your Serper.dev API key under Settings (or SERPER_API_KEY in .env) to check the competition.</div>
      </>
    );
  }

  if (latest.length === 0) {
    return (
      <>
        {header}
        {hasDataNote || <div className="banner">No competition data yet. Click “Sync now”.</div>}
      </>
    );
  }

  // ------------------------------------------------------------------ competitor detail
  if (competitorKey) {
    const keys = new Set([competitorKey]);
    const unsorted = latest.flatMap(({ keyword, entries }) => {
      const theirs = domainPosition(entries, keys);
      return theirs && matches(keyword.text) ? [{ keyword, entries, theirs, mine: domainPosition(entries, own) }] : [];
    });
    const { key: detailKey, asc: detailAsc } = detailSort.sort;
    const rows = sortRows(
      unsorted,
      (r) => (detailKey === "keyword" ? r.keyword.text : detailKey === "theirs" ? r.theirs.position : detailKey === "mine" ? r.mine?.position : r.theirs.url),
      detailAsc,
    );
    const label = rows[0] ? competitorOf(rows[0].theirs).label : competitorKey;
    const chartKeyword = rows.find((r) => r.keyword.id === chartKeywordId) ?? rows[0];
    const dates = chartKeyword ? Object.keys(serp.results[chartKeyword.keyword.id] ?? {}).sort() : [];
    const pointsOf = (set: Set<string>) =>
      Object.fromEntries(
        dates.flatMap((date) => {
          const entry = chartKeyword ? domainPosition(serp.results[chartKeyword.keyword.id]?.[date] ?? [], set) : undefined;
          return entry ? [[date, entry.position]] : [];
        }),
      );

    return (
      <>
        {header}
        {comparison && <PageComparison request={comparison} onClose={() => setComparison(undefined)} />}
        <section className="card">
          <div className="row comparison-header">
            <h3>{label}</h3>
            <button onClick={() => setCompetitorKey(undefined)}>← All competitors</button>
          </div>
          {chartKeyword && (
            <>
              <p className="muted small">Position history for “{chartKeyword.keyword.text}” (click a keyword below to switch).</p>
              <CompetitorChart
                dates={dates}
                series={[
                  { label, className: 'series-them', points: pointsOf(keys) },
                  { label: 'You', className: 'series-me', points: pointsOf(own) },
                ]}
              />
            </>
          )}
        </section>
        <section className="card">
          <table className="keywords">
            <thead>
              <tr>
                {detailSort.th("keyword", "Keyword")}
                {detailSort.th("theirs", "Their position", "num")}
                {detailSort.th("mine", "Your position", "num")}
                {detailSort.th("url", "Their URL")}
                <th className="num">
                  <CopyButton
                    headers={['Keyword', 'Their position', 'Your position', 'Their URL']}
                    rows={rows.map((r) => [r.keyword.text, r.theirs.position, formatSerpPosition(r.mine), r.theirs.url])}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.keyword.id}
                  className={r.keyword.id === chartKeyword?.keyword.id ? 'selected' : ''}
                  onClick={() => setChartKeywordId(r.keyword.id)}
                >
                  <td>{r.keyword.text}</td>
                  <td className="num">{r.theirs.position}</td>
                  <td className={`num ${r.mine && r.mine.position < r.theirs.position ? 'up' : 'down'}`}>{formatSerpPosition(r.mine)}</td>
                  <td>
                    <UrlLink url={r.theirs.url} />
                  </td>
                  <td className="num">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        compare(r.keyword, r.entries, r.theirs);
                      }}
                    >
                      How to take over
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </>
    );
  }

  // ------------------------------------------------------------------ overview
  // The search text matches the keyword, or a competitor in its results (e.g. all keywords where a competitor ranks).
  const { key: cKey, asc: cAsc } = competitorSort.sort;
  const visibleCompetitors = sortRows(
    stats.competitors.filter((s) => matches(s.label)),
    (s) => (cKey === "label" ? s.label : cKey === "top10" ? s.top10 : cKey === "top20" ? s.top20 : cKey === "avg" ? s.avgPosition : s.shareOfVoice),
    cAsc,
  );
  const { key: kKey, asc: kAsc } = keywordSort.sort;
  const filteredLatest = latest.filter((l) => matches(l.keyword.text, ...l.entries.map((e) => competitorOf(e).label)));
  const visibleLatest = kKey
    ? sortRows(
        filteredLatest,
        (l) => {
          if (kKey.startsWith("own:")) return domainPosition(l.entries, new Set([kKey.slice(4)]))?.position;
          if (kKey === "keyword") return l.keyword.text;
          if (kKey === "lang") return l.keyword.serpLanguage || project.serpLanguage;
          if (kKey === "gsc") return gscAverage(l.keyword);
          if (kKey === "first") return l.entries[0] ? competitorOf(l.entries[0]).label : undefined;
          return l.entries.length;
        },
        kAsc,
      )
    : filteredLatest;
  const { key: gKey, asc: gAsc } = gapSort.sort;
  const visibleGaps = sortRows(
    gapList.filter((g) => matches(g.keyword.text, ...g.competitors.map((c) => c.competitor.label))),
    (g) => (gKey === "keyword" ? g.keyword.text : gKey === "competitors" ? g.competitors.length : gKey === "mine" ? g.mine?.position : gscAverage(g.keyword)),
    gAsc,
  );
  const selectedKeyword = visibleLatest.find((l) => l.keyword.id === keywordId) ?? visibleLatest[0];

  return (
    <>
      {header}
      {comparison && <PageComparison request={comparison} onClose={() => setComparison(undefined)} />}
      <div className="row segmented">
        {(
          [
            ['competitors', `Competitors (${visibleCompetitors.length})`],
            ['keywords', `Keywords (${visibleLatest.length})`],
            ['gaps', `Gaps (${visibleGaps.length})`],
          ] as [View, string][]
        ).map(([value, label]) => (
          <button key={value} className={`chip${view === value ? ' active' : ''}`} onClick={() => setView(value)}>
            {label}
          </button>
        ))}
        {stats.own.map((s) => (
          <span key={s.key} className="badge ok" title="Your share of voice, keywords in the top 10 / top 20">
            {s.label}: {(s.shareOfVoice * 100).toFixed(1)}% · top 10: {s.top10} · top 20: {s.top20}
          </span>
        ))}
      </div>

      {view === 'competitors' && (
        <section className="card">
          <table className="keywords">
            <thead>
              <tr>
                {competitorSort.th("label", "Competitor")}
                {competitorSort.th("top10", "Top 10", "num")}
                {competitorSort.th("top20", "Top 20", "num")}
                {competitorSort.th("avg", "Avg position", "num")}
                {competitorSort.th("sov", "Share of voice", "num")}
                <th className="num">
                  <CopyButton
                    headers={['Competitor', 'Top 10', 'Top 20', 'Avg position', 'Share of voice %']}
                    rows={visibleCompetitors.map((s) => [s.label, s.top10, s.top20, s.avgPosition, s.shareOfVoice * 100])}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleCompetitors.map((s) => (
                <tr key={s.key} onClick={() => setCompetitorKey(s.key)}>
                  <td>{s.label}</td>
                  <td className="num">{s.top10}</td>
                  <td className="num">{s.top20}</td>
                  <td className="num">{s.avgPosition.toFixed(1)}</td>
                  <td className="num">{(s.shareOfVoice * 100).toFixed(1)}%</td>
                  <td className="num">
                    <button
                      className="link"
                      title="Ignore this competitor (Edit project → Ignored domains)"
                      onClick={(e) => {
                        e.stopPropagation();
                        void ignore(s.key);
                      }}
                    >
                      Ignore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {view === 'keywords' && selectedKeyword && (
        <div className="keywords-layout">
          <section className="card side-column">
            <div className="row comparison-header">
              <h3>
                Top 10 for “{selectedKeyword.keyword.text}”{' '}
                <span className="muted small">({selectedKeyword.entries.length} results fetched)</span>
              </h3>
              {bestCompetitor(selectedKeyword.entries) && (
                <button
                  className="primary"
                  onClick={() => {
                    const theirs = bestCompetitor(selectedKeyword.entries);
                    if (theirs) compare(selectedKeyword.keyword, selectedKeyword.entries, theirs);
                  }}
                >
                  How to take over
                </button>
              )}
            </div>
            <table className="keywords">
              <tbody>
                {selectedKeyword.entries
                  .filter((e) => e.position <= 10 || own.has(competitorOf(e).key))
                  .map((e) => {
                    const { key, label } = competitorOf(e);
                    const isOwn = own.has(key);
                    return (
                      <tr key={`${e.position}-${e.url}`} className={isOwn ? 'own-row' : ignored.has(key) ? 'ignored-row' : ''}>
                        <td className="num">{e.position}</td>
                        <td>
                          <div>{e.title}</div>
                          <div className="small">
                            <strong>{label}</strong> <UrlLink url={e.url} />
                          </div>
                        </td>
                        <td className="num">
                          {!isOwn && (
                            <button className="link" title="Compare with your page" onClick={() => compare(selectedKeyword.keyword, selectedKeyword.entries, e)}>
                              Compare
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                {!domainPosition(selectedKeyword.entries, own) && (
                  <tr className="own-row">
                    <td className="num">&gt;20</td>
                    <td colSpan={2}>You are not in the top 20.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          <section className="card keywords-main">
            <table className="keywords">
              <thead>
                <tr>
                  {keywordSort.th("keyword", "Keyword")}
                  {keywordSort.th("lang", "Lang")}
                  {ownList.map((d) => keywordSort.th(`own:${d}`, d, "num"))}
                  {keywordSort.th("gsc", "GSC avg", "num")}
                  {keywordSort.th("first", "#1")}
                  {keywordSort.th("results", "Results", "num")}
                  <th className="num">
                    <CopyButton
                      headers={['Keyword', 'Language', ...ownList.map((d) => `${d} (Google now)`), 'GSC avg (28d)', '#1', 'Results']}
                      rows={visibleLatest.map((l) => [
                        l.keyword.text,
                        l.keyword.serpLanguage || project.serpLanguage,
                        ...ownList.map((d) => formatSerpPosition(domainPosition(l.entries, new Set([d])))),
                        gscAverage(l.keyword),
                        l.entries[0] ? competitorOf(l.entries[0]).label : '',
                        l.entries.length,
                      ])}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleLatest.map((l) => (
                  <tr
                    key={l.keyword.id}
                    className={l.keyword.id === selectedKeyword.keyword.id ? 'selected' : ''}
                    onClick={() => setKeywordId(l.keyword.id)}
                  >
                    <td>{l.keyword.text}</td>
                    <td>{languageSelect(l.keyword)}</td>
                    {ownList.map((d) => (
                      <td key={d} className="num">
                        {formatSerpPosition(domainPosition(l.entries, new Set([d])))}
                      </td>
                    ))}
                    <td className="num">{formatPosition(gscAverage(l.keyword))}</td>
                    <td>{l.entries[0] ? competitorOf(l.entries[0]).label : '–'}</td>
                    <td className="num">{l.entries.length}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {view === 'keywords' && !selectedKeyword && <div className="banner">No keywords match the filter.</div>}

      {view === 'gaps' && (
        <section className="card">
          <p className="muted small">Keywords where a competitor (not ignored) is in the top 10 and none of your domains is.</p>
          <table className="keywords">
            <thead>
              <tr>
                {gapSort.th("keyword", "Keyword")}
                {gapSort.th("competitors", "Competitors in the top 10")}
                {gapSort.th("mine", "Your best", "num")}
                {gapSort.th("gsc", "GSC avg", "num")}
                <th className="num">
                  <CopyButton
                    headers={['Keyword', 'Competitors in the top 10', 'Your best', 'GSC avg (28d)']}
                    rows={visibleGaps.map((g) => [
                      g.keyword.text,
                      g.competitors.map((c) => `${c.competitor.label} (#${c.entry.position})`).join(', '),
                      formatSerpPosition(g.mine),
                      gscAverage(g.keyword),
                    ])}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleGaps.map((g) => {
                const entries = latest.find((l) => l.keyword.id === g.keyword.id)?.entries ?? [];
                const [first] = g.competitors;
                return (
                  <tr key={g.keyword.id}>
                    <td>{g.keyword.text}</td>
                    <td>
                      {g.competitors.map((c) => (
                        <span key={c.competitor.key} className="tag" title={c.entry.url}>
                          #{c.entry.position} {c.competitor.label}
                        </span>
                      ))}
                    </td>
                    <td className="num">{formatSerpPosition(g.mine)}</td>
                    <td className="num">{formatPosition(gscAverage(g.keyword))}</td>
                    <td className="num">
                      {first && <button onClick={() => compare(g.keyword, entries, first.entry)}>How to take over</button>}
                    </td>
                  </tr>
                );
              })}
              {visibleGaps.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No gaps.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
