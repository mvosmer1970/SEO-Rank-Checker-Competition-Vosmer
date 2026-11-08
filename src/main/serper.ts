// Competition checks through the Serper.dev API (Google top 20 per tracked keyword), and fetching pages to compare.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootDomain } from '../shared/competition';
import { daysAgo } from '../shared/metrics';
import type { FetchedPage, SerpCheckResult, SerpEntry } from '../shared/types';
import * as store from './store';

const SERPER_URL = 'https://google.serper.dev/search';
const RESULTS = 20;
const CONCURRENCY = 3;
const PAGE_TIMEOUT_MS = 20000;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

/** Sets SERPER_API_KEY (and other variables that are not set yet) from a .env file in one of the folders. */
export function loadEnvFile(folders: string[]): void {
  for (const folder of folders) {
    const path = join(folder, '.env');
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match?.[1] || line.trim().startsWith('#')) continue;
      const value = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
      process.env[match[1]] ??= value;
    }
    return;
  }
}

interface SerperResponse {
  organic?: { title?: string; link?: string }[];
  message?: string;
}

/** Serper's location per Google country (gl); a country that is not listed is sent without location. */
const LOCATIONS: Record<string, string> = {
  nl: 'Netherlands',
  be: 'Belgium',
  de: 'Germany',
  fr: 'France',
  gb: 'United Kingdom',
  us: 'United States',
  es: 'Spain',
  it: 'Italy',
  hu: 'Hungary',
  pl: 'Poland',
};

/** Pages of 10 results; a third page fills up when Google shows fewer than 10 organic results on a page. */
const MAX_PAGES = 3;

async function searchPage(apiKey: string, q: string, gl: string, hl: string, page: number) {
  const location = LOCATIONS[gl];
  const response = await fetch(SERPER_URL, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl, hl, ...(location ? { location } : {}), num: 10, page }),
  });
  const body = (await response.json()) as SerperResponse;
  if (!response.ok) throw new Error(`Serper: ${body.message ?? response.statusText}`);
  return body.organic ?? [];
}

/** The first 20 organic results, numbered 1–20 in the order of the pages (duplicates of earlier pages left out). */
async function search(apiKey: string, q: string, gl: string, hl: string): Promise<SerpEntry[]> {
  const entries: SerpEntry[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES && entries.length < RESULTS; page++) {
    const organic = await searchPage(apiKey, q, gl, hl, page);
    for (const r of organic) {
      if (!r.link || seen.has(r.link) || entries.length >= RESULTS) continue;
      seen.add(r.link);
      entries.push({ position: entries.length + 1, url: r.link, title: r.title ?? '', domain: rootDomain(r.link) });
    }
    if (organic.length === 0) break; // No more results.
  }
  return entries;
}

const running = new Map<string, Promise<SerpCheckResult>>();

/** Fetches the Google top 20 of every keyword of the project and stores it under today's date. */
export function checkCompetition(projectId: string): Promise<SerpCheckResult> {
  let check = running.get(projectId);
  if (!check) {
    check = runCheck(projectId).finally(() => running.delete(projectId));
    running.set(projectId, check);
  }
  return check;
}

async function runCheck(projectId: string): Promise<SerpCheckResult> {
  const { key } = store.getSerperApiKey();
  if (!key) throw new Error('Enter the Serper API key in Settings first (or SERPER_API_KEY in .env)');
  const project = store.getProject(projectId);
  const date = daysAgo(0);
  const results = new Map<string, SerpEntry[]>();

  const queue = [...project.keywords];
  const worker = async (): Promise<void> => {
    for (let keyword = queue.shift(); keyword; keyword = queue.shift()) {
      // The project's language, unless the keyword has its own.
      const hl = keyword.serpLanguage || project.serpLanguage;
      results.set(keyword.id, await search(key, keyword.text, project.serpCountry, hl));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Read again: a keyword may have been deleted during the check.
  const serp = store.readSerp(projectId);
  const current = new Set(store.getProject(projectId).keywords.map((k) => k.id));
  for (const [keywordId, entries] of results) {
    if (!current.has(keywordId)) continue;
    serp.results[keywordId] = { ...serp.results[keywordId], [date]: entries };
  }
  store.writeSerp(projectId, serp);
  store.markSerpChecked(projectId);
  return { projectId, date, keywordsChecked: results.size };
}

/** Fetches a web page (http/https only) as text, for the comparison in the UI. */
export async function fetchPage(url: string): Promise<FetchedPage> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only http and https pages can be fetched');
  const response = await fetch(parsed, {
    redirect: 'follow',
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_PAGE_BYTES) throw new Error(`Page too large: ${url}`);
  return { url, finalUrl: response.url || url, status: response.status, html: new TextDecoder().decode(buffer) };
}
