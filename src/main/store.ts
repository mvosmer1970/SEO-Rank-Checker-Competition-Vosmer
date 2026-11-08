// Local storage in JSON files in the user data folder of the app
// (%APPDATA%\seo-rank-tracker): data.json for projects and settings, history\<project id>.json per project,
// serp\<project id>.json with the competition checks per project.
import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_IGNORED_DOMAINS, rootDomain } from '../shared/competition';
import type { AppOptions, GoogleSettings, KeywordPage, Project, ProjectHistory, ProjectInput, SerpData } from '../shared/types';

interface StoredData {
  projects: Project[];
  google: GoogleSettings;
  options: AppOptions;
  /** OAuth refresh token, encrypted with safeStorage (base64), '' if not signed in. */
  refreshToken: string;
  /** Serper API key, encrypted with safeStorage (base64), '' if not set. */
  serperApiKey: string;
  /** The projects are in the user's order (dragged in the sidebar); before, they were listed by name. */
  projectsOrdered?: boolean;
}

const DEFAULT_OPTIONS: AppOptions = { autoSync: true, keepInTray: true, startWithWindows: false };


const EMPTY: StoredData = {
  projects: [],
  google: { clientId: '', clientSecret: '' },
  options: DEFAULT_OPTIONS,
  refreshToken: '',
  serperApiKey: '',
};

function serpDir(): string {
  const dir = join(dataDir(), 'serp');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function dataDir(): string {
  return app.getPath('userData');
}

function historyDir(): string {
  const dir = join(dataDir(), 'history');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Writes to a temporary file first, so a crash never leaves a half-written file. */
function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), 'utf8');
  renameSync(tmp, path);
}

let cache: StoredData | undefined;

function load(): StoredData {
  if (!cache) {
    mkdirSync(dataDir(), { recursive: true });
    const stored = readJson<Partial<StoredData>>(join(dataDir(), 'data.json'), {});
    // An earlier version had the own and ignored domains in the options, for all projects.
    const { ownDomains: oldOwn = [], ignoredDomains: oldIgnored = [], ...options } = (stored.options ?? {}) as Partial<AppOptions> & {
      ownDomains?: string[];
      ignoredDomains?: string[];
    };
    cache = { ...EMPTY, ...stored, options: { ...DEFAULT_OPTIONS, ...options } };
    // Keep the order that an earlier version showed (by name) as the starting order.
    if (!cache.projectsOrdered) {
      cache.projects.sort((a, b) => a.name.localeCompare(b.name));
      cache.projectsOrdered = true;
    }
    // Projects and keywords stored by an earlier version lack the newer fields.
    for (const project of cache.projects) {
      project.notes ??= '';
      project.serpCountry ??= 'nl';
      project.serpLanguage ??= 'nl';
      project.lastSerpCheckAt ??= '';
      project.ownDomains ??= normalizeDomains(oldOwn);
      project.ignoredDomains ??= normalizeDomains([...oldIgnored, ...DEFAULT_IGNORED_DOMAINS]);
      for (const keyword of project.keywords) {
        keyword.tags ??= [];
        keyword.pages ??= [];
        keyword.serpLanguage ??= '';
      }
    }
  }
  return cache;
}

/** Trimmed, without empty and duplicate tags (case insensitive, the first spelling wins). */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    result.push(tag);
  }
  return result;
}

function save(): void {
  writeJson(join(dataDir(), 'data.json'), load());
}

function findProject(id: string): Project {
  const project = load().projects.find((p) => p.id === id);
  if (!project) throw new Error('Project not found');
  return project;
}

function validateInput(input: ProjectInput): ProjectInput {
  const name = input.name.trim();
  const siteUrl = input.siteUrl.trim();
  const country = input.country.trim().toLowerCase();
  if (!name) throw new Error('Name is required');
  if (!siteUrl) throw new Error('Search Console property is required');
  if (country && !/^[a-z]{3}$/.test(country)) throw new Error('Country must be a 3-letter code, e.g. nld');
  const serpCountry = input.serpCountry.trim().toLowerCase() || 'nl';
  const serpLanguage = input.serpLanguage.trim().toLowerCase() || 'nl';
  if (!/^[a-z]{2}$/.test(serpCountry)) throw new Error('Google country must be a 2-letter code, e.g. nl');
  if (!/^[a-z]{2}(-[a-z]{2})?$/.test(serpLanguage)) throw new Error('Google language must be a code like nl or en');
  return {
    name,
    siteUrl,
    country,
    device: input.device,
    serpCountry,
    serpLanguage,
    ownDomains: normalizeDomains(input.ownDomains),
    ignoredDomains: normalizeDomains(input.ignoredDomains),
  };
}

/** The projects in the user's order; the first one opens when the app starts. */
export function listProjects(): Project[] {
  return [...load().projects];
}

/** Puts the projects in the order of the ids (projects that are not in the list keep their place at the end). */
export function reorderProjects(ids: string[]): void {
  const data = load();
  const position = new Map(ids.map((id, i) => [id, i]));
  data.projects.sort((a, b) => (position.get(a.id) ?? ids.length) - (position.get(b.id) ?? ids.length));
  save();
}

export function getProject(id: string): Project {
  return findProject(id);
}

export function createProject(input: ProjectInput): Project {
  const project: Project = {
    id: randomUUID(),
    ...validateInput(input),
    keywords: [],
    notes: '',
    lastSyncedDate: '',
    lastSyncAt: '',
    lastSerpCheckAt: '',
  };
  load().projects.push(project);
  save();
  return project;
}

export function updateProject(id: string, input: ProjectInput): Project {
  const project = findProject(id);
  const valid = validateInput(input);
  // Other property, country or device: the stored history no longer matches, so sync from scratch.
  if (valid.siteUrl !== project.siteUrl || valid.country !== project.country || valid.device !== project.device) {
    project.lastSyncedDate = '';
    writeHistory(id, {});
  }
  Object.assign(project, valid);
  save();
  return project;
}

export function deleteProject(id: string): void {
  const data = load();
  data.projects = data.projects.filter((p) => p.id !== id);
  save();
  rmSync(join(historyDir(), `${id}.json`), { force: true });
  rmSync(join(serpDir(), `${id}.json`), { force: true });
}

/** Adds the keywords that the project does not have yet. Their history is fetched in full by the next sync. */
export function addKeywords(projectId: string, texts: string[], tags: string[]): Project {
  const project = findProject(projectId);
  const existing = new Set(project.keywords.map((k) => k.text));
  const now = new Date().toISOString();
  const validTags = normalizeTags(tags);
  for (const raw of texts) {
    // Search Console reports queries in lower case.
    const text = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!text || existing.has(text)) continue;
    existing.add(text);
    project.keywords.push({ id: randomUUID(), text, addedAt: now, tags: [...validTags], pages: [], serpLanguage: '' });
  }
  save();
  return project;
}

export function setKeywordTags(projectId: string, keywordId: string, tags: string[]): Project {
  const keyword = findProject(projectId).keywords.find((k) => k.id === keywordId);
  if (!keyword) throw new Error('Keyword not found');
  keyword.tags = normalizeTags(tags);
  save();
  return findProject(projectId);
}

export function setKeywordLanguage(projectId: string, keywordId: string, language: string): Project {
  const keyword = findProject(projectId).keywords.find((k) => k.id === keywordId);
  if (!keyword) throw new Error('Keyword not found');
  const value = language.trim().toLowerCase();
  if (value && !/^[a-z]{2}$/.test(value)) throw new Error('Language must be a 2-letter code, e.g. nl or en');
  keyword.serpLanguage = value;
  save();
  return findProject(projectId);
}

export function setProjectNotes(projectId: string, notes: string): Project {
  const project = findProject(projectId);
  project.notes = notes;
  save();
  return project;
}

/** Stores the ranking URLs per keyword id; keywords deleted in the meantime are skipped. */
export function setKeywordPages(projectId: string, pages: Map<string, KeywordPage[]>): void {
  for (const keyword of findProject(projectId).keywords) {
    const keywordPages = pages.get(keyword.id);
    if (keywordPages) keyword.pages = keywordPages;
  }
  save();
}

export function deleteKeyword(projectId: string, keywordId: string): Project {
  const project = findProject(projectId);
  project.keywords = project.keywords.filter((k) => k.id !== keywordId);
  save();
  const history = readHistory(projectId);
  delete history[keywordId];
  writeHistory(projectId, history);
  const serp = readSerp(projectId);
  delete serp.results[keywordId];
  writeSerp(projectId, serp);
  return project;
}

export function readSerp(projectId: string): SerpData {
  return readJson<SerpData>(join(serpDir(), `${projectId}.json`), { results: {} });
}

export function writeSerp(projectId: string, serp: SerpData): void {
  writeJson(join(serpDir(), `${projectId}.json`), serp);
}

export function markSerpChecked(projectId: string): void {
  findProject(projectId).lastSerpCheckAt = new Date().toISOString();
  save();
}

/** The Serper key of the settings, or else SERPER_API_KEY of the environment (or .env, which main loads). */
export function getSerperApiKey(): { key: string; source: 'settings' | 'env' | '' } {
  const stored = load().serperApiKey;
  if (stored) return { key: safeStorage.decryptString(Buffer.from(stored, 'base64')), source: 'settings' };
  const env = process.env.SERPER_API_KEY?.trim();
  return env ? { key: env, source: 'env' } : { key: '', source: '' };
}

export function setSerperApiKey(key: string): void {
  const trimmed = key.trim();
  load().serperApiKey = trimmed ? safeStorage.encryptString(trimmed).toString('base64') : '';
  save();
}

export function markSynced(projectId: string, lastSyncedDate: string): void {
  const project = findProject(projectId);
  project.lastSyncedDate = lastSyncedDate;
  project.lastSyncAt = new Date().toISOString();
  save();
}

export function readHistory(projectId: string): ProjectHistory {
  return readJson<ProjectHistory>(join(historyDir(), `${projectId}.json`), {});
}

export function writeHistory(projectId: string, history: ProjectHistory): void {
  writeJson(join(historyDir(), `${projectId}.json`), history);
}

export function getGoogleSettings(): GoogleSettings {
  return { ...load().google };
}

export function saveGoogleSettings(settings: GoogleSettings): void {
  const data = load();
  const changed = settings.clientId.trim() !== data.google.clientId;
  data.google = { clientId: settings.clientId.trim(), clientSecret: settings.clientSecret.trim() };
  // A token belongs to a client: another client means signing in again.
  if (changed) data.refreshToken = '';
  save();
}

export function getOptions(): AppOptions {
  return { ...load().options };
}

/**
 * Domains as entered (URLs, www. etc.), as registrable domains without duplicates. A marketplace app
 * ("marketplace:<product>", see competitorOf) is kept as it is.
 */
function normalizeDomains(domains: string[]): string[] {
  const normalized = domains.map((d) => {
    const value = d.trim().toLowerCase();
    return value.startsWith('marketplace:') ? value : rootDomain(value);
  });
  return [...new Set(normalized.filter((d) => d.includes('.') || d.startsWith('marketplace:')))].sort();
}

export function saveOptions(options: AppOptions): void {
  load().options = { ...options };
  save();
}

export function getRefreshToken(): string {
  const stored = load().refreshToken;
  if (!stored) return '';
  return safeStorage.decryptString(Buffer.from(stored, 'base64'));
}

export function setRefreshToken(token: string): void {
  load().refreshToken = token ? safeStorage.encryptString(token).toString('base64') : '';
  save();
}
