// Types shared by the main process (data, Google) and the renderer (UI).

/** Device filter of Search Console; '' means all devices. */
export type Device = '' | 'DESKTOP' | 'MOBILE' | 'TABLET';

/** A URL of the site that ranked for a keyword, over the last 28 days. */
export interface KeywordPage {
  url: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface Keyword {
  id: string;
  text: string;
  addedAt: string; // ISO timestamp
  tags: string[];
  /** Ranking URLs of the day that "Latest" comes from (most impressions first), as of the last sync. */
  pages: KeywordPage[];
  /** Ranking URLs of the last 7 and 28 days (most impressions first), as of the last sync. */
  pages7: KeywordPage[];
  pages28: KeywordPage[];
  /** The page that should rank for the keyword ('' = none): its own position is shown in the main columns. */
  targetPage: string;
  /** Google language (hl) of the competition check; '' = the project's language. */
  serpLanguage: string;
}

export interface Project {
  id: string;
  name: string;
  /** Search Console property, e.g. "https://www.example.com/" or "sc-domain:example.com". */
  siteUrl: string;
  /** ISO 3166-1 alpha-3 country code in lower case (Search Console format), '' for all countries. */
  country: string;
  device: Device;
  keywords: Keyword[];
  /** Free text notes of the user. */
  notes: string;
  /** Google country (gl) and language (hl) of the competition check through Serper, e.g. "nl" (hl per keyword can differ). */
  serpCountry: string;
  serpLanguage: string;
  lastSerpCheckAt: string; // ISO timestamp, '' if never
  /** Own domains in the competition data (the domain of the property always counts too). */
  ownDomains: string[];
  /** Domains left out of the competitors, share of voice and gaps (shown grey in the top 10). */
  ignoredDomains: string[];
  /** Last date (YYYY-MM-DD) that was synced from Search Console, '' if never. */
  lastSyncedDate: string;
  lastSyncAt: string; // ISO timestamp, '' if never
}

/** Search Console metrics of one keyword on one day. */
export interface DayMetrics {
  position: number; // average position (1 = top)
  clicks: number;
  impressions: number;
}

/** History of one project: keyword id -> date (YYYY-MM-DD) -> metrics. */
export type ProjectHistory = Record<string, Record<string, DayMetrics>>;

/** History of the target pages of a project: keyword id -> the target page and its metrics for the keyword per date. */
export type TargetHistory = Record<string, { page: string; days: Record<string, DayMetrics> }>;

export interface ProjectInput {
  name: string;
  siteUrl: string;
  country: string;
  device: Device;
  serpCountry: string;
  serpLanguage: string;
  ownDomains: string[];
  ignoredDomains: string[];
}

/** One organic Google result of a competition check. */
export interface SerpEntry {
  position: number; // 1..20
  url: string;
  title: string;
  /** Registrable domain without www, e.g. "example.com" (see competitorOf for marketplace apps). */
  domain: string;
}

/** Competition checks of one project: keyword id -> date (YYYY-MM-DD) -> top 20. */
export interface SerpData {
  results: Record<string, Record<string, SerpEntry[]>>;
}

export interface SerpCheckResult {
  projectId: string;
  date: string;
  keywordsChecked: number;
}

export interface SerperStatus {
  configured: boolean;
  /** Where the key comes from: Settings, or SERPER_API_KEY in .env / the environment. */
  source: 'settings' | 'env' | '';
}

/** A web page fetched for the comparison ("How to take over"). */
export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  /** Content-Type header of the response, '' if none. */
  contentType: string;
  html: string;
}

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
}

export interface AppOptions {
  /** Sync every project once a day, while the app runs. */
  autoSync: boolean;
  /** Closing the window keeps the app running in the system tray. */
  keepInTray: boolean;
  /** Start the app hidden in the tray when Windows starts. */
  startWithWindows: boolean;
}

export interface AuthStatus {
  configured: boolean; // client id and secret are set
  signedIn: boolean;
}

export interface SearchConsoleSite {
  siteUrl: string;
  permissionLevel: string;
}

/** A change in the 7-day average position of a keyword between two syncs. */
export interface RankAlert {
  keyword: string;
  kind: 'drop' | 'top10';
  /** 7-day average before the sync, undefined if it had no impressions. */
  from: number | undefined;
  to: number;
}

export interface SyncResult {
  projectId: string;
  keywordsSynced: number;
  fromDate: string;
  toDate: string;
  alerts: RankAlert[];
}

/** A Search Console query of the project that is not tracked yet and ranks just below the top. */
export interface Opportunity {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

/** Filters of the Ranking keywords tab. */
export interface RankingKeywordsFilter {
  /** Period: the last N days. */
  days: number;
  /** ISO 3166-1 alpha-3 in lower case, '' for all countries. */
  country: string;
  device: Device;
  /** Top N: only queries with an average position up to this. */
  maxPosition: number;
}

/** A query that the property ranked for in the period. */
export interface RankingKeyword {
  query: string;
  position: number;
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  /** The URL with the most impressions for this query, '' if unknown. */
  page: string;
  /** The project tracks this query already. */
  tracked: boolean;
}

// ---------------------------------------------------------------- site research

/** Another site that is researched: crawled and analysed, with its rankings estimated through Serper. */
export interface ResearchSite {
  id: string;
  /** Host name without www, e.g. "example.com". */
  domain: string;
  /** The URL the crawl starts at (home page). */
  startUrl: string;
  /** Maximum number of pages per crawl. */
  maxPages: number;
  /** Google country (gl) and language (hl) of the keyword checks. */
  serpCountry: string;
  serpLanguage: string;
  createdAt: string; // ISO timestamp
  lastCrawlAt: string; // ISO timestamp, '' if never
  pageCount: number;
}

export interface ResearchSiteInput {
  startUrl: string;
  maxPages: number;
  serpCountry: string;
  serpLanguage: string;
}

export interface ResearchHeading {
  level: number; // 1..3
  text: string;
}

/** The on-page analysis of one crawled page (the HTML itself is not stored). */
export interface ResearchPage {
  url: string;
  /** HTTP status, 0 when the page could not be fetched. */
  status: number;
  error: string;
  title: string;
  metaDescription: string;
  canonical: string;
  noindex: boolean;
  lang: string;
  /** The H1-H3 headings in the order of the page. */
  headings: ResearchHeading[];
  /** Words of the main content (without navigation, header and footer). */
  words: number;
  internalLinks: number;
  externalLinks: number;
  /** Domains the page links to (most links first). */
  externalDomains: string[];
  /** Internal links to this page from the other crawled pages. */
  inbound: number;
  images: number;
  imagesWithoutAlt: number;
  schemaTypes: string[];
  ogType: string;
  /** Publication and modification date (YYYY-MM-DD) from the meta tags or structured data, '' if unknown. */
  published: string;
  modified: string;
  /** Most frequent words and phrases (2-3 words) of the main content, with their count. */
  terms: [string, number][];
  phrases: [string, number][];
  /** Listed in the sitemap of the site (else found through a link). */
  inSitemap: boolean;
}

/** The estimated ranking of a researched site for one keyword (Serper). */
export interface ResearchKeyword {
  keyword: string;
  checkedAt: string; // YYYY-MM-DD
  /** Best position of the site (1..depth), undefined when it is not in the results that were fetched. */
  position: number | undefined;
  /** The ranking URL of the site, '' when it does not rank. */
  url: string;
  /** The number of results that were fetched (up to 100). */
  depth: number;
  /** The top 10 of Google. */
  top: SerpEntry[];
  /** The result of the check before this one, to show the change (undefined before a second check). */
  previous?: { checkedAt: string; position: number | undefined; depth: number };
}

export interface ResearchData {
  pages: ResearchPage[];
  /** Sitemap URLs that were not crawled because of the page limit. */
  skippedUrls: number;
  /** Ranking checks, one per keyword (the last one, with the one before as `previous`). */
  keywords: ResearchKeyword[];
  /** The keyword list of the Keywords tab: the suggestions of the pages, plus these, minus the removed ones. */
  addedKeywords: string[];
  removedKeywords: string[];
}

/** The API that the preload script exposes to the renderer as window.rankTracker. */
export interface RankTrackerApi {
  listProjects(): Promise<Project[]>;
  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, input: ProjectInput): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  /** Saves the order of the projects in the sidebar. */
  reorderProjects(ids: string[]): Promise<void>;
  addKeywords(projectId: string, texts: string[], tags: string[]): Promise<Project>;
  deleteKeyword(projectId: string, keywordId: string): Promise<Project>;
  setKeywordTags(projectId: string, keywordId: string, tags: string[]): Promise<Project>;
  setProjectNotes(projectId: string, notes: string): Promise<Project>;
  /** '' = the project's language. */
  setKeywordLanguage(projectId: string, keywordId: string, language: string): Promise<Project>;
  getHistory(projectId: string): Promise<ProjectHistory>;
  getTargetHistory(projectId: string): Promise<TargetHistory>;
  /** Sets the page that should rank for the keyword ('' = none) and fetches its history (when signed in). */
  setKeywordTarget(projectId: string, keywordId: string, url: string): Promise<Project>;
  syncProject(projectId: string): Promise<SyncResult>;
  getOpportunities(projectId: string): Promise<Opportunity[]>;
  getRankingKeywords(projectId: string, filter: RankingKeywordsFilter): Promise<RankingKeyword[]>;
  getSerpData(projectId: string): Promise<SerpData>;
  checkCompetition(projectId: string): Promise<SerpCheckResult>;
  fetchPage(url: string): Promise<FetchedPage>;
  getSerperStatus(): Promise<SerperStatus>;
  /** Writes text to the system clipboard (also after a long wait, unlike the browser clipboard). */
  copyToClipboard(text: string): Promise<void>;
  /** Colors of the window title bar (behind the minimize/maximize/close buttons), to match the theme. */
  setTitleBarColors(color: string, symbolColor: string): Promise<void>;
  /** Asks where to save a text file (e.g. a CSV export) and saves it; false when the user cancelled. */
  saveTextFile(defaultName: string, content: string): Promise<boolean>;
  saveSerperApiKey(key: string): Promise<void>;

  listResearchSites(): Promise<ResearchSite[]>;
  createResearchSite(input: ResearchSiteInput): Promise<ResearchSite>;
  updateResearchSite(id: string, input: ResearchSiteInput): Promise<ResearchSite>;
  deleteResearchSite(id: string): Promise<void>;
  getResearchData(id: string): Promise<ResearchData>;
  /** Stores the result of a crawl (replacing the previous pages, keeping the keyword checks). */
  saveResearchCrawl(id: string, pages: ResearchPage[], skippedUrls: number): Promise<ResearchSite>;
  /** Looks the keywords up in Google (top 100, one Serper search each) and stores the position of the site for each. */
  checkResearchKeywords(id: string, keywords: string[]): Promise<ResearchData>;
  /** Saves the keywords the user added to and removed from the suggestions. */
  setResearchKeywordList(id: string, added: string[], removed: string[]): Promise<ResearchData>;

  getGoogleSettings(): Promise<GoogleSettings>;
  saveGoogleSettings(settings: GoogleSettings): Promise<void>;
  getOptions(): Promise<AppOptions>;
  saveOptions(options: AppOptions): Promise<void>;
  getAuthStatus(): Promise<AuthStatus>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  listSites(): Promise<SearchConsoleSite[]>;

  /** Called after every sync, also the automatic ones in the background. Returns an unsubscribe function. */
  onSynced(callback: (result: SyncResult) => void): () => void;
  /** Called after every competition check, also the weekly ones. Returns an unsubscribe function. */
  onSerpChecked(callback: (result: SerpCheckResult) => void): () => void;
}
