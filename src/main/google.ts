// Google sign-in (OAuth 2.0 for desktop apps: loopback redirect with PKCE) and the Search Console API.
import { shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { daysAgo, summarize, validDays } from '../shared/metrics';
import type {
  DayMetrics,
  KeywordPage,
  Opportunity,
  Project,
  RankAlert,
  RankingKeyword,
  RankingKeywordsFilter,
  SearchConsoleSite,
  SyncResult,
} from '../shared/types';
import * as store from './store';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_URL = 'https://www.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
/** Search Console keeps 16 months of data. */
const MAX_HISTORY_DAYS = 486;
/** The last days are refetched on every sync, as Search Console still updates them. */
const REFETCH_DAYS = 4;
const CONCURRENCY = 4;

let accessToken: { token: string; expiresAt: number } | undefined;

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function requireSettings(): { clientId: string; clientSecret: string } {
  const settings = store.getGoogleSettings();
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error('Enter the Google OAuth client ID and secret in Settings first');
  }
  return settings;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await response.json()) as TokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? response.statusText}`);
  }
  return body;
}

function rememberAccessToken(body: TokenResponse): string {
  const token = body.access_token ?? '';
  accessToken = { token, expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
  return token;
}

/**
 * Starts a local server that Google redirects the browser to after sign-in.
 * `code` resolves with the authorization code of that redirect.
 */
function startLoopback(state: string): Promise<{ redirectUri: string; code: Promise<string> }> {
  return new Promise((resolveStart, rejectStart) => {
    let finish: (code: string) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const code = new Promise<string>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    // Avoids an unhandled rejection when the code fails before signIn awaits it.
    code.catch(() => undefined);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const received = url.searchParams.get('code');
      const ok = !error && received && url.searchParams.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<html><body style="font-family:sans-serif;padding:2em"><h2>${
          ok ? 'Signed in. You can close this tab and return to SEO Rank Tracker.' : 'Sign-in failed. Return to SEO Rank Tracker and try again.'
        }</h2></body></html>`,
      );
      clearTimeout(timer);
      server.close();
      if (ok) finish(received);
      else fail(new Error(`Google sign-in failed: ${error ?? 'invalid response'}`));
    });
    const timer = setTimeout(() => {
      server.close();
      fail(new Error('Google sign-in timed out'));
    }, SIGN_IN_TIMEOUT_MS);

    server.on('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolveStart({ redirectUri: `http://127.0.0.1:${port}`, code });
    });
  });
}

export async function signIn(): Promise<void> {
  const { clientId, clientSecret } = requireSettings();
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(16));

  const listener = await startLoopback(state);
  const authUrl = new URL(AUTH_URL);
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: listener.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  }).toString();
  await shell.openExternal(authUrl.toString());

  const code = await listener.code;
  const body = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: listener.redirectUri,
    grant_type: 'authorization_code',
  });
  if (!body.refresh_token) throw new Error('Google returned no refresh token; sign in again');
  store.setRefreshToken(body.refresh_token);
  rememberAccessToken(body);
}

export function signOut(): void {
  accessToken = undefined;
  store.setRefreshToken('');
}

export function isSignedIn(): boolean {
  return store.getRefreshToken() !== '';
}

async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now()) return accessToken.token;
  const { clientId, clientSecret } = requireSettings();
  const refreshToken = store.getRefreshToken();
  if (!refreshToken) throw new Error('Sign in with Google in Settings first');
  return rememberAccessToken(
    await postToken({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  );
}

async function callApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`Search Console: ${json.error?.message ?? response.statusText}`);
  return json;
}

export async function listSites(): Promise<SearchConsoleSite[]> {
  const result = await callApi<{ siteEntry?: SearchConsoleSite[] }>('/sites');
  return (result.siteEntry ?? [])
    .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

interface QueryRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  position: number;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The country and device filters of the project, plus `extra`. */
function filterGroups(project: Project, extra: { dimension: string; operator: string; expression: string }[] = []) {
  const filters = [...extra];
  if (project.country) filters.push({ dimension: 'country', operator: 'equals', expression: project.country });
  if (project.device) filters.push({ dimension: 'device', operator: 'equals', expression: project.device });
  return filters.length ? [{ groupType: 'and', filters }] : [];
}

async function query(project: Project, body: Record<string, unknown>): Promise<QueryRow[]> {
  const result = await callApi<{ rows?: QueryRow[] }>(`/sites/${encodeURIComponent(project.siteUrl)}/searchAnalytics/query`, {
    dataState: 'all',
    ...body,
  });
  return result.rows ?? [];
}

/** Rows without impressions (Search Console then reports position 0) have no position. */
function hasPosition(row: QueryRow): boolean {
  return row.impressions > 0 && row.position > 0;
}

async function fetchKeywordDays(project: Project, keyword: string, startDate: string, endDate: string): Promise<Record<string, DayMetrics>> {
  const rows = await query(project, {
    startDate,
    endDate,
    dimensions: ['date'],
    dimensionFilterGroups: filterGroups(project, [{ dimension: 'query', operator: 'equals', expression: keyword }]),
    rowLimit: 25000,
  });
  const days: Record<string, DayMetrics> = {};
  for (const row of rows.filter(hasPosition)) {
    const date = row.keys?.[0];
    if (date) days[date] = { position: row.position, clicks: row.clicks, impressions: row.impressions };
  }
  return days;
}

async function fetchKeywordPages(project: Project, keyword: string, startDate: string, endDate: string): Promise<KeywordPage[]> {
  const rows = await query(project, {
    startDate,
    endDate,
    dimensions: ['page'],
    dimensionFilterGroups: filterGroups(project, [{ dimension: 'query', operator: 'equals', expression: keyword }]),
    rowLimit: 10,
  });
  return rows
    .filter(hasPosition)
    .flatMap((row) => (row.keys?.[0] ? [{ url: row.keys[0], clicks: row.clicks, impressions: row.impressions, position: row.position }] : []))
    .sort((a, b) => b.impressions - a.impressions);
}

/**
 * The ranking URLs of the day that "Latest" comes from (the last day with impressions), or of the whole
 * 16 months when that day has none. Nothing without any day with impressions.
 */
async function fetchLatestPages(
  project: Project,
  keyword: string,
  days: Record<string, DayMetrics>,
  earliest: string,
  toDate: string,
): Promise<KeywordPage[]> {
  const latest = Object.keys(validDays(days)).sort().pop();
  if (!latest) return [];
  const pages = await fetchKeywordPages(project, keyword, latest, latest);
  return pages.length ? pages : fetchKeywordPages(project, keyword, earliest, toDate);
}

/** 7-day average position before and after a sync: a drop of more than this many positions is reported. */
const ALERT_DROP = 5;

function compareWeeks(keyword: string, before: Record<string, DayMetrics>, after: Record<string, DayMetrics>): RankAlert | undefined {
  const today = daysAgo(0);
  const from = summarize(validDays(before), daysAgo(6), today).position;
  const to = summarize(validDays(after), daysAgo(6), today).position;
  if (to === undefined) return undefined;
  if (from !== undefined && to - from > ALERT_DROP) return { keyword, kind: 'drop', from, to };
  if (to <= 10 && (from === undefined || from > 10)) return { keyword, kind: 'top10', from, to };
  return undefined;
}

const running = new Map<string, Promise<SyncResult>>();

/**
 * Fetches the daily metrics and the ranking URLs of every keyword of the project. Keywords that were synced before
 * are fetched from the last sync on, new keywords 16 months back. A sync of a project that is already running is joined.
 */
export function syncProject(projectId: string): Promise<SyncResult> {
  let sync = running.get(projectId);
  if (!sync) {
    sync = runSync(projectId).finally(() => running.delete(projectId));
    running.set(projectId, sync);
  }
  return sync;
}

async function runSync(projectId: string): Promise<SyncResult> {
  const project = store.getProject(projectId);
  const toDate = daysAgo(0);
  const earliest = addDays(toDate, -MAX_HISTORY_DAYS);
  const sinceLastSync = project.lastSyncedDate ? addDays(project.lastSyncedDate, -REFETCH_DAYS) : earliest;
  const history = store.readHistory(projectId);
  const pages = new Map<string, KeywordPage[]>();
  const alerts: RankAlert[] = [];

  const queue = [...project.keywords];
  const worker = async (): Promise<void> => {
    for (let keyword = queue.shift(); keyword; keyword = queue.shift()) {
      const previous = history[keyword.id];
      const fromDate = previous ? sinceLastSync : earliest;
      const days = await fetchKeywordDays(project, keyword.text, fromDate, toDate);
      const updated = { ...previous };
      // Replace the fetched range: a day without data in the new response has no impressions.
      for (const date of Object.keys(updated)) {
        if (date >= fromDate || date < earliest) delete updated[date];
      }
      Object.assign(updated, days);
      history[keyword.id] = updated;
      pages.set(keyword.id, await fetchLatestPages(project, keyword.text, updated, earliest, toDate));
      // A new keyword has nothing to compare with.
      const alert = previous ? compareWeeks(keyword.text, previous, updated) : undefined;
      if (alert) alerts.push(alert);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Keep only the keywords that still exist (one may have been deleted during the sync).
  const current = new Set(store.getProject(projectId).keywords.map((k) => k.id));
  for (const id of Object.keys(history)) if (!current.has(id)) delete history[id];
  store.writeHistory(projectId, history);
  store.setKeywordPages(projectId, pages);
  store.markSynced(projectId, toDate);
  return { projectId, keywordsSynced: project.keywords.length, fromDate: sinceLastSync, toDate, alerts };
}

/** Opportunities: queries of the last 28 days at position 5–20 with at least 5 impressions, not tracked yet. */
const OPPORTUNITY_MIN_POSITION = 5;
const OPPORTUNITY_MAX_POSITION = 20;
const OPPORTUNITY_MIN_IMPRESSIONS = 5;
const PAGE_SIZE = 25000;

export async function getOpportunities(projectId: string): Promise<Opportunity[]> {
  const project = store.getProject(projectId);
  const tracked = new Set(project.keywords.map((k) => k.text));
  const result: Opportunity[] = [];
  for (let startRow = 0; ; startRow += PAGE_SIZE) {
    const rows = await query(project, {
      startDate: daysAgo(27),
      endDate: daysAgo(0),
      dimensions: ['query'],
      dimensionFilterGroups: filterGroups(project),
      rowLimit: PAGE_SIZE,
      startRow,
    });
    for (const row of rows) {
      const text = row.keys?.[0]?.toLowerCase();
      if (
        text &&
        !tracked.has(text) &&
        row.impressions >= OPPORTUNITY_MIN_IMPRESSIONS &&
        row.position >= OPPORTUNITY_MIN_POSITION &&
        row.position <= OPPORTUNITY_MAX_POSITION
      ) {
        result.push({ query: text, clicks: row.clicks, impressions: row.impressions, position: row.position });
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return result.sort((a, b) => b.impressions - a.impressions);
}

/** At most this many rows per Search Console request, and this many requests for one list. */
const MAX_PAGES = 8;

async function queryAll(project: Project, body: Record<string, unknown>): Promise<QueryRow[]> {
  const all: QueryRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await query(project, { ...body, rowLimit: PAGE_SIZE, startRow: page * PAGE_SIZE });
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Ranking keywords: every query the property ranked for in the period, with the given country and device
 * (instead of those of the project) and a position up to `maxPosition`, with the URL that had the most impressions.
 */
export async function getRankingKeywords(projectId: string, filter: RankingKeywordsFilter): Promise<RankingKeyword[]> {
  const project = { ...store.getProject(projectId), country: filter.country, device: filter.device };
  const tracked = new Set(project.keywords.map((k) => k.text));
  const body = { startDate: daysAgo(filter.days - 1), endDate: daysAgo(0), dimensionFilterGroups: filterGroups(project) };
  const [queries, queryPages] = await Promise.all([
    queryAll(project, { ...body, dimensions: ['query'] }),
    queryAll(project, { ...body, dimensions: ['query', 'page'] }),
  ]);

  const topPage = new Map<string, { url: string; impressions: number }>();
  for (const row of queryPages.filter(hasPosition)) {
    const [text, url] = row.keys ?? [];
    if (!text || !url) continue;
    const current = topPage.get(text);
    if (!current || row.impressions > current.impressions) topPage.set(text, { url, impressions: row.impressions });
  }

  return queries
    .filter((row) => hasPosition(row) && row.position <= filter.maxPosition)
    .flatMap((row) => {
      const text = row.keys?.[0];
      if (!text) return [];
      return [
        {
          query: text,
          position: row.position,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.clicks / row.impressions,
          page: topPage.get(text)?.url ?? '',
          tracked: tracked.has(text.toLowerCase()),
        },
      ];
    })
    .sort((a, b) => b.impressions - a.impressions);
}
