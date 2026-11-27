// Site research: crawls another site and shows its content (type, language and suggested keywords per page), its
// links and publishing, and where it ranks in Google for the keywords (Serper).
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { ResearchData, ResearchPage, ResearchSite, ResearchSiteInput } from '../shared/types';
import { api, errorMessage } from './api';
import { cancelCrawl, crawlProgress, isCrawling, startCrawl, subscribeCrawl, type CrawlProgress } from './crawler';
import { ResearchKeywords } from './ResearchKeywords';
import { ResearchPages, type ContentRow } from './ResearchPages';
import { bareTitle, brandWords, h1Of, isOk, pageKeywords, pageLanguage, pageType, pathOf, sharedTexts, titleSuffix } from './siteAnalysis';
import { ExternalLink } from './table';

export const PAGE_LIMITS = [25, 50, 100, 250, 500, 1000];

// ---------------------------------------------------------------- form

export function ResearchForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ResearchSiteInput;
  onSave: (input: ResearchSiteInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [input, setInput] = useState<ResearchSiteInput>(initial ?? { startUrl: '', maxPages: 100, serpCountry: 'nl', serpLanguage: 'nl' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave(input);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <form className="card form narrow-form" onSubmit={(e) => void submit(e)}>
      <h2>{initial ? 'Edit site research' : 'Research a site'}</h2>
      <p className="muted small">
        The app reads the sitemap of the site (or follows its links), fetches up to the maximum number of pages and analyses how they are built.
        It respects robots.txt. Rankings are estimated afterwards on the Keywords tab, through Serper.
      </p>
      <label>
        Site URL
        <input value={input.startUrl} onChange={(e) => setInput({ ...input, startUrl: e.target.value })} placeholder="https://www.example.com/" autoFocus />
      </label>
      <label>
        Maximum pages
        <select value={input.maxPages} onChange={(e) => setInput({ ...input, maxPages: Number(e.target.value) })}>
          {PAGE_LIMITS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <label>
          Google country (gl)
          <input value={input.serpCountry} onChange={(e) => setInput({ ...input, serpCountry: e.target.value })} placeholder="nl" maxLength={2} />
        </label>
        <label>
          Google language (hl)
          <input value={input.serpLanguage} onChange={(e) => setInput({ ...input, serpLanguage: e.target.value })} placeholder="nl" maxLength={5} />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={saving}>
          {initial ? 'Save' : 'Start research'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- view

type Tab = 'overview' | 'content' | 'keywords';

interface Props {
  site: ResearchSite;
  onChanged: (site: ResearchSite) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}

/** The rows of the Content tab: type, language and suggested keywords of every page that was fetched. */
function contentRows(pages: ResearchPage[], domain: string): ContentRow[] {
  const ok = pages.filter(isOk);
  const { suffix } = titleSuffix(ok);
  const brand = brandWords(ok, domain);
  const shared = sharedTexts(ok);
  return ok.map((page) => ({ page, type: pageType(page), language: pageLanguage(page), keywords: pageKeywords(page, suffix, brand, shared) }));
}

/** The suggested keywords of the content pages (no release notes or legal pages), with the number of pages for each. */
function keywordSuggestions(rows: ContentRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.type === 'Release' || r.type === 'Legal') continue;
    for (const k of r.keywords) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function ResearchView({ site, onChanged, onDeleted, onError }: Props) {
  const [data, setData] = useState<ResearchData | undefined>();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [progress, setProgress] = useState<CrawlProgress | undefined>(crawlProgress(site.id));
  const [pageSearch, setPageSearch] = useState('');
  const [pageUrl, setPageUrl] = useState<string | undefined>();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => subscribeCrawl(site.id, setProgress), [site.id]);
  useEffect(() => {
    api.getResearchData(site.id).then(setData, (e: unknown) => onError(errorMessage(e)));
  }, [site.id, site.lastCrawlAt, onError]);

  const crawling = progress !== undefined && isCrawling(site.id);
  const pages = useMemo(() => data?.pages ?? [], [data]);
  const rows = useMemo(() => contentRows(pages, site.domain), [pages, site.domain]);
  const suggestions = useMemo(() => keywordSuggestions(rows), [rows]);
  const keywordCount = useMemo(
    () => new Set([...suggestions.keys(), ...(data?.addedKeywords ?? [])].filter((k) => !data?.removedKeywords.includes(k))).size,
    [suggestions, data],
  );

  const showPage = (url: string) => {
    setPageSearch('');
    setPageUrl(url);
    setTab('content');
  };

  const copyAll = async () => {
    if (!data) return;
    try {
      await api.copyToClipboard(researchReport(site, data, rows));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  };

  if (editing) {
    return (
      <ResearchForm
        initial={{ startUrl: site.startUrl, maxPages: site.maxPages, serpCountry: site.serpCountry, serpLanguage: site.serpLanguage }}
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          onChanged(await api.updateResearchSite(site.id, input));
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="page">
      <header className="project-header">
        <div>
          <h2>{site.domain}</h2>
          <p className="muted small">
            <ExternalLink url={site.startUrl} /> · max {site.maxPages} pages · Google {site.serpCountry}/{site.serpLanguage} · crawled{' '}
            {site.lastCrawlAt ? `${new Date(site.lastCrawlAt).toLocaleString()} (${site.pageCount} pages)` : 'never'}
          </p>
        </div>
        <div className="row">
          <button onClick={() => void copyAll()} disabled={!data || pages.length === 0} title="Copy the full research report to the clipboard">
            {copyState === 'copied' ? 'Copied ✓' : copyState === 'failed' ? 'Copy failed' : 'Copy all'}
          </button>
          {crawling ? (
            <button onClick={() => cancelCrawl(site.id)}>Cancel crawl</button>
          ) : (
            <button className="primary" onClick={() => startCrawl(site, onChanged)}>
              {site.lastCrawlAt ? 'Crawl again' : 'Crawl'}
            </button>
          )}
          <button onClick={() => setEditing(true)} disabled={crawling}>
            Edit
          </button>
          <button
            className="danger"
            disabled={crawling}
            onClick={() => {
              if (!window.confirm(`Delete the research of ${site.domain}?`)) return;
              api.deleteResearchSite(site.id).then(onDeleted, (e: unknown) => onError(errorMessage(e)));
            }}
          >
            Delete
          </button>
        </div>
      </header>

      {progress && progress.phase !== 'done' && (
        <div className={`banner${progress.phase === 'error' ? ' error' : ''}`}>
          <div className="grow">
            {progress.phase === 'sitemap' && progress.message}
            {progress.phase === 'pages' && (
              <>
                <div>
                  Crawling: {progress.done} of {progress.planned} pages
                </div>
                <div className="progress">
                  <div style={{ width: `${progress.planned ? (progress.done / progress.planned) * 100 : 0}%` }} />
                </div>
                <div className="muted small research-path">{progress.message}</div>
              </>
            )}
            {(progress.phase === 'saving' || progress.phase === 'cancelled') && progress.message}
            {progress.phase === 'error' && `Crawl failed: ${progress.message}`}
          </div>
        </div>
      )}

      {data && pages.length === 0 && !crawling && <div className="banner">Not crawled yet. Click “Crawl”.</div>}

      {data && pages.length > 0 && (
        <>
          <div className="tabs">
            {(
              [
                ['overview', 'Overview'],
                ['content', `Content (${rows.length})`],
                ['keywords', `Keywords (${keywordCount})`],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button key={key} className={`tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && <Overview data={data} onPage={showPage} />}
          {tab === 'content' && (
            <ResearchPages
              rows={rows}
              domain={site.domain}
              search={pageSearch}
              onSearch={setPageSearch}
              selectedUrl={pageUrl}
              onSelect={setPageUrl}
              onError={onError}
            />
          )}
          {tab === 'keywords' && <ResearchKeywords site={site} data={data} suggestions={suggestions} onData={setData} onError={onError} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- overview

function Bars({ items }: { items: { label: ReactNode; value: number; onClick?: () => void }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <table className="bars">
      <tbody>
        {items.map((item, i) => (
          <tr key={i} className={item.onClick ? 'clickable' : ''} onClick={item.onClick}>
            <th>{item.label}</th>
            <td>
              <div className="bar" style={{ width: `${(item.value / max) * 100}%` }} />
            </td>
            <td className="num">{item.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Links to other sites and publishing (the structure, topics and SEO issues are kept in the crawl data). */
function Overview({ data, onPage }: { data: ResearchData; onPage: (url: string) => void }) {
  const ok = data.pages.filter(isOk);
  const { suffix } = titleSuffix(ok);
  const years = new Map<string, number>();
  for (const p of ok) if (p.published) years.set(p.published.slice(0, 4), (years.get(p.published.slice(0, 4)) ?? 0) + 1);
  const latestPublished = ok
    .filter((p) => p.published)
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, 8);
  const external = new Map<string, number>();
  for (const p of ok) for (const d of p.externalDomains) external.set(d, (external.get(d) ?? 0) + 1);

  return (
    <div className="research-grid">
      <section className="card">
        <h3>Links to other sites</h3>
        {external.size ? (
          <Bars
            items={[...external]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 12)
              .map(([d, n]) => ({ label: d, value: n }))}
          />
        ) : (
          <p className="muted">No external links.</p>
        )}
        <p className="muted small">Number of pages that link to the domain.</p>
      </section>

      <section className="card">
        <h3>Publishing</h3>
        {years.size ? (
          <>
            <Bars items={[...years].sort((a, b) => b[0].localeCompare(a[0])).map(([y, n]) => ({ label: y, value: n }))} />
            <h4>Latest published</h4>
            <ul className="compact-list link-list">
              {latestPublished.map((p) => (
                <li key={p.url}>
                  <button className="text-button" onClick={() => onPage(p.url)}>
                    {p.published} · {bareTitle(p.title, suffix) || pathOf(p.url)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">No publication dates found (no article:published_time or datePublished).</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- report

/** The research as Markdown, for the clipboard (e.g. to paste into an AI chat or a document): what the tabs show. */
function researchReport(site: ResearchSite, data: ResearchData, rows: ContentRow[]): string {
  const ok = data.pages.filter(isOk);
  const lines: string[] = [];
  const table = (headers: string[], cells: (string | number)[][]) => {
    lines.push(`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of cells) lines.push(`| ${row.map((c) => String(c).replace(/\|/g, '/').replace(/\s+/g, ' ')).join(' | ')} |`);
    lines.push('');
  };

  lines.push(`# Site research: ${site.domain}`, '');
  lines.push(`- URL: ${site.startUrl}`);
  lines.push(
    `- Crawled: ${site.lastCrawlAt ? new Date(site.lastCrawlAt).toLocaleString() : 'never'}, ${data.pages.length} pages (${data.pages.length - ok.length} errors)${data.skippedUrls ? `, ${data.skippedUrls} more URLs in the sitemap` : ''}`,
  );
  lines.push(`- Google: ${site.serpCountry}/${site.serpLanguage}`, '');

  const external = new Map<string, number>();
  for (const p of ok) for (const d of p.externalDomains) external.set(d, (external.get(d) ?? 0) + 1);
  lines.push('## Links to other sites', '');
  table(['Domain', 'Pages linking'], [...external].sort((a, b) => b[1] - a[1]).slice(0, 20));

  const years = new Map<string, number>();
  for (const p of ok) if (p.published) years.set(p.published.slice(0, 4), (years.get(p.published.slice(0, 4)) ?? 0) + 1);
  lines.push('## Publishing', '');
  table(['Year', 'Pages published'], [...years].sort((a, b) => b[0].localeCompare(a[0])));

  lines.push('## Content', '');
  table(
    ['Type', 'Language', 'Title', 'URL', 'H1', 'Words', 'Date', 'Keywords'],
    rows.map((r) => [r.type, r.language, r.page.title, pathOf(r.page.url), h1Of(r.page)[0] ?? '', r.page.words, r.page.published || r.page.modified, r.keywords.join(', ')]),
  );

  if (data.keywords.length) {
    lines.push('## Keyword rankings (Google, top 100)', '');
    table(
      ['Keyword', 'Position', 'Before', 'Ranking page', 'Top 3', 'Checked'],
      [...data.keywords]
        .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
        .map((k) => [
          k.keyword,
          positionText(k),
          k.previous ? `${positionText(k.previous)} (${k.previous.checkedAt})` : '',
          k.url,
          k.top
            .slice(0, 3)
            .map((e) => e.domain)
            .join(', '),
          k.checkedAt,
        ]),
    );
  }
  return lines.join('\n');
}

function positionText(k: { position: number | undefined; depth: number }): string {
  return k.position === undefined ? `>${k.depth}` : String(k.position);
}
