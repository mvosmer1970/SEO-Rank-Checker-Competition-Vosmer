// Crawls a researched site: robots.txt and the sitemaps for the list of pages (else the links from the home page),
// then fetches and analyses the pages a few at a time. The crawl keeps running when another view is opened.
import type { ResearchPage, ResearchSite } from '../shared/types';
import { api, errorMessage } from './api';
import { analyzeHtml, boilerplateTexts, contentStats, depthOf, failedPage, normalizeUrl, sectionOf, siteHost } from './siteAnalysis';

export interface CrawlProgress {
  phase: 'sitemap' | 'pages' | 'saving' | 'done' | 'error' | 'cancelled';
  /** Pages planned (the limit or the pages found, whichever is smaller). */
  planned: number;
  done: number;
  message: string;
}

const CONCURRENCY = 4;
const MAX_SITEMAPS = 40;
const MAX_SITEMAP_URLS = 20000;
/** Files that are no web pages (not fetched). */
const NOT_HTML = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|7z|gz|docx?|xlsx?|pptx?|mp4|mp3|avi|mov|wmv|css|js|json|xml|txt|csv|woff2?|ttf|eot|exe|msi|dmg)$/i;

interface Crawl {
  progress: CrawlProgress;
  cancelled: boolean;
  listeners: Set<(progress: CrawlProgress) => void>;
}

const crawls = new Map<string, Crawl>();

export function crawlProgress(siteId: string): CrawlProgress | undefined {
  return crawls.get(siteId)?.progress;
}

export function isCrawling(siteId: string): boolean {
  const phase = crawls.get(siteId)?.progress.phase;
  return phase === 'sitemap' || phase === 'pages' || phase === 'saving';
}

export function subscribeCrawl(siteId: string, listener: (progress: CrawlProgress) => void): () => void {
  let crawl = crawls.get(siteId);
  if (!crawl) {
    crawl = { progress: { phase: 'done', planned: 0, done: 0, message: '' }, cancelled: false, listeners: new Set() };
    crawls.set(siteId, crawl);
  }
  crawl.listeners.add(listener);
  const current = crawl;
  return () => {
    current.listeners.delete(listener);
  };
}

export function cancelCrawl(siteId: string): void {
  const crawl = crawls.get(siteId);
  if (crawl) crawl.cancelled = true;
}

function update(crawl: Crawl, change: Partial<CrawlProgress>): void {
  crawl.progress = { ...crawl.progress, ...change };
  for (const listener of crawl.listeners) listener(crawl.progress);
}

// ---------------------------------------------------------------- robots.txt

interface Robots {
  disallow: string[];
  allow: string[];
  sitemaps: string[];
}

/** The rules for all crawlers ("User-agent: *") and the sitemaps of a robots.txt. */
function parseRobots(content: string): Robots {
  const robots: Robots = { disallow: [], allow: [], sitemaps: [] };
  let forAll = false;
  let inAgents = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (field === 'sitemap') {
      if (value) robots.sitemaps.push(value);
    } else if (field === 'user-agent') {
      // Consecutive User-agent lines form one group.
      forAll = (inAgents && forAll) || value === '*';
      inAgents = true;
    } else {
      inAgents = false;
      if (!forAll || !value) continue;
      if (field === 'disallow') robots.disallow.push(value);
      if (field === 'allow') robots.allow.push(value);
    }
  }
  return robots;
}

function ruleMatches(rule: string, path: string): boolean {
  const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${pattern.endsWith('\\$') ? `${pattern.slice(0, -2)}$` : pattern}`).test(path);
}

/** The longest matching rule wins; Allow wins a tie. */
function isAllowed(robots: Robots, url: string): boolean {
  const parsed = new URL(url);
  const path = parsed.pathname + parsed.search;
  const longest = (rules: string[]) => Math.max(-1, ...rules.filter((r) => ruleMatches(r, path)).map((r) => r.length));
  return longest(robots.allow) >= longest(robots.disallow);
}

// ---------------------------------------------------------------- sitemaps

async function fetchText(url: string): Promise<string | undefined> {
  try {
    const page = await api.fetchPage(url);
    return page.status >= 200 && page.status < 300 ? page.html : undefined;
  } catch {
    return undefined;
  }
}

/** All page URLs of the sitemaps (sitemap indexes followed), on the host of the site. */
async function sitemapUrls(crawl: Crawl, sitemaps: string[], host: string): Promise<string[]> {
  const queue = [...sitemaps];
  const seenSitemaps = new Set<string>();
  const urls = new Set<string>();
  while (queue.length && seenSitemaps.size < MAX_SITEMAPS && urls.size < MAX_SITEMAP_URLS && !crawl.cancelled) {
    const sitemap = queue.shift() ?? '';
    if (seenSitemaps.has(sitemap)) continue;
    seenSitemaps.add(sitemap);
    const content = await fetchText(sitemap);
    if (!content || !/<(urlset|sitemapindex)[\s>]/i.test(content)) continue;
    const doc = new DOMParser().parseFromString(content, 'application/xml');
    for (const loc of doc.getElementsByTagName('loc')) {
      const value = (loc.textContent ?? '').trim();
      if (!value) continue;
      if (loc.parentElement?.localName === 'sitemap') queue.push(value);
      else {
        const url = normalizeUrl(value, sitemap, true);
        if (url && siteHost(url) === host) urls.add(url);
      }
    }
    update(crawl, { message: `Reading sitemaps: ${urls.size} pages found` });
  }
  return [...urls];
}

/**
 * The pages to crawl when the sitemap has more than the limit: a sample of every section of the site in proportion
 * to its size (at least one page each, the largest sections first), the least deep pages of a section first, so
 * the crawl shows the structure of the whole site.
 */
function spread(urls: string[], limit: number): string[] {
  if (urls.length <= limit) return urls;
  const groups = new Map<string, string[]>();
  for (const url of urls) {
    const section = sectionOf(url);
    groups.set(section, [...(groups.get(section) ?? []), url]);
  }
  const lists = [...groups.values()]
    .map((list) => list.sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b)))
    .sort((a, b) => b.length - a.length);
  const quota = lists.map((list) => Math.min(list.length, Math.max(1, Math.floor((limit * list.length) / urls.length))));
  const result: string[] = [];
  lists.forEach((list, i) => result.push(...list.slice(0, quota[i])));
  // Rounding leaves room: fill it from the sections in order of size.
  for (let i = 0; result.length < limit && i < lists.length; i++) {
    const list = lists[i] ?? [];
    const taken = quota[i] ?? 0;
    result.push(...list.slice(taken, taken + limit - result.length));
  }
  return result.slice(0, limit);
}

// ---------------------------------------------------------------- crawl

/** Starts a crawl of the site (nothing happens when one is running). `onSaved` gets the updated site. */
export function startCrawl(site: ResearchSite, onSaved: (site: ResearchSite) => void): void {
  if (isCrawling(site.id)) return;
  const existing = crawls.get(site.id);
  const crawl: Crawl = {
    progress: { phase: 'sitemap', planned: 0, done: 0, message: 'Reading robots.txt and sitemaps…' },
    cancelled: false,
    listeners: existing?.listeners ?? new Set(),
  };
  crawls.set(site.id, crawl);
  update(crawl, {});
  run(crawl, site).then(onSaved, (e: unknown) => {
    update(crawl, { phase: crawl.cancelled ? 'cancelled' : 'error', message: crawl.cancelled ? 'Crawl cancelled' : errorMessage(e) });
  });
}

async function run(crawl: Crawl, site: ResearchSite): Promise<ResearchSite> {
  const start = new URL(site.startUrl);
  const host = siteHost(site.startUrl);
  const origin = start.origin;

  const robotsText = (await fetchText(`${origin}/robots.txt`)) ?? '';
  const robots = parseRobots(robotsText);
  const sitemaps = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  const fromSitemap = (await sitemapUrls(crawl, sitemaps, host)).filter((u) => !NOT_HTML.test(new URL(u).pathname) && isAllowed(robots, u));
  if (crawl.cancelled) throw new Error('cancelled');
  const inSitemap = new Set(fromSitemap);

  const home = normalizeUrl(site.startUrl, site.startUrl, true) ?? site.startUrl;
  const others = fromSitemap.filter((u) => u !== home);
  const planned = [home, ...spread(others, site.maxPages - 1)];
  const skippedUrls = others.length - (planned.length - 1);

  const queue = [...planned];
  const seen = new Set(queue);
  const pages = new Map<string, ResearchPage>();
  const linksOf = new Map<string, string[]>();
  const textsOf = new Map<string, string[]>();
  update(crawl, { phase: 'pages', planned: Math.min(site.maxPages, queue.length), done: 0, message: '' });

  let active = 0;
  const worker = async (): Promise<void> => {
    while (!crawl.cancelled) {
      const url = queue.shift();
      if (!url) {
        // Another worker may still add links of the page it is fetching.
        if (active === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      active++;
      try {
        await crawlPage(url);
      } finally {
        active--;
      }
    }
  };

  const crawlPage = async (url: string): Promise<void> => {
    {
      let page: ResearchPage;
      let links: string[] = [];
      let texts: string[] = [];
      try {
        const fetched = await api.fetchPage(url);
        const finalUrl = normalizeUrl(fetched.finalUrl, fetched.finalUrl, true) ?? url;
        if (siteHost(finalUrl) !== host) page = failedPage(url, fetched.status, `Redirects to another site: ${finalUrl}`);
        else if (fetched.contentType && !/html/i.test(fetched.contentType)) page = failedPage(url, fetched.status, `Not a web page (${fetched.contentType})`);
        else if (fetched.status >= 400) page = failedPage(url, fetched.status, `HTTP ${fetched.status}`);
        else if (finalUrl !== url && pages.has(finalUrl)) page = failedPage(url, fetched.status, `Redirects to ${finalUrl} (crawled already)`);
        else ({ page, links, texts } = analyzeHtml(fetched.html, finalUrl, fetched.status));
      } catch (e) {
        page = failedPage(url, 0, errorMessage(e));
      }
      // Files that are no web pages, and redirects to a page that was crawled, do not count as crawled pages.
      if (page.error.startsWith('Not a web page') || page.error.endsWith('(crawled already)')) {
        update(crawl, { planned: Math.max(crawl.progress.planned - 1, crawl.progress.done) });
        return;
      }
      page.inSitemap = inSitemap.has(page.url) || inSitemap.has(url);
      pages.set(page.url, page);
      linksOf.set(page.url, links);
      if (texts.length) textsOf.set(page.url, texts);
      seen.add(page.url);

      // Without (enough) sitemap URLs, the links on the pages fill the crawl up to the limit.
      for (const link of links) {
        if (seen.size >= site.maxPages) break;
        if (seen.has(link) || NOT_HTML.test(new URL(link).pathname) || !isAllowed(robots, link)) continue;
        seen.add(link);
        queue.push(link);
      }
      update(crawl, { done: crawl.progress.done + 1, planned: Math.max(crawl.progress.planned, Math.min(site.maxPages, seen.size)), message: page.url });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (crawl.cancelled) throw new Error('cancelled');

  // Internal links to every page from the other crawled pages (once per linking page).
  for (const [from, links] of linksOf) {
    for (const link of new Set(links)) {
      const target = pages.get(link) ?? pages.get(link.endsWith('/') ? link.slice(0, -1) : `${link}/`);
      if (target && target.url !== from) target.inbound++;
    }
  }

  // Words and topics without the text that most pages share (template parts).
  const boilerplate = boilerplateTexts([...textsOf.values()]);
  for (const [url, texts] of textsOf) {
    const page = pages.get(url);
    if (page) Object.assign(page, contentStats(texts, boilerplate));
  }

  update(crawl, { phase: 'saving', message: 'Saving…' });
  const saved = await api.saveResearchCrawl(site.id, [...pages.values()], skippedUrls);
  update(crawl, { phase: 'done', message: `${pages.size} pages crawled` });
  return saved;
}
