// Competition analysis of the Serper top 20 results of the tracked keywords.
import type { Keyword, SerpData, SerpEntry } from './types';

/** Second-level suffixes under which the registrable domain has three labels (e.g. example.co.uk). */
const SECOND_LEVEL = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'co.jp', 'co.za', 'com.tr']);

function hostOf(urlOrHost: string): string {
  let host = urlOrHost.trim().toLowerCase();
  try {
    if (host.includes('://')) host = new URL(host).hostname;
  } catch {
    // Not a URL: use it as host name.
  }
  return host.replace(/^sc-domain:/, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

/** The registrable domain of a URL or host name, without www: "https://learn.microsoft.com/x" -> "microsoft.com". */
export function rootDomain(urlOrHost: string): string {
  const labels = hostOf(urlOrHost).split('.').filter(Boolean);
  const lastTwo = labels.slice(-2).join('.');
  return labels.slice(SECOND_LEVEL.has(lastTwo) ? -3 : -2).join('.');
}

/** Ignored domains of a new project (the user can change them per project). */
export const DEFAULT_IGNORED_DOMAINS = ['facebook.com', 'linkedin.com', 'microsoft.com', 'portalsystems.de', 'reddit.com', 'youtube.com'];

/** App stores whose results are products of other companies (competing apps), not of the store owner. */
const MARKETPLACE_HOSTS = new Set(['marketplace.microsoft.com', 'appsource.microsoft.com']);

export interface Competitor {
  /** Identity: the registrable domain, or "marketplace:<product>" for an app in a marketplace. */
  key: string;
  /** Shown name: the domain, or "<product> (Marketplace)". */
  label: string;
}

/** The product name of a marketplace title, e.g. "Contracts365 - Microsoft Marketplace" -> "Contracts365". */
function productName(title: string, url: string): string {
  const name = title.split(/\s[-–|:]\s/)[0]?.trim();
  if (name) return name;
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? url);
  } catch {
    return url;
  }
}

/** Who a result belongs to. A marketplace app counts as its own competitor, so ignoring microsoft.com keeps it. */
export function competitorOf(entry: SerpEntry): Competitor {
  if (MARKETPLACE_HOSTS.has(hostOf(entry.url))) {
    const name = productName(entry.title, entry.url);
    return { key: `marketplace:${name.toLowerCase()}`, label: `${name} (Marketplace)` };
  }
  const domain = rootDomain(entry.url);
  return { key: domain, label: domain };
}

/** The own domains of a project: its list plus the domain of its property. */
export function ownDomainSet(ownDomains: string[], siteUrl: string): Set<string> {
  return new Set([...ownDomains.map(rootDomain), rootDomain(siteUrl)].filter(Boolean));
}

/** Estimated click-through rate per position, used for the share of voice. */
const CTR = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];

export function estimatedCtr(position: number): number {
  return CTR[position - 1] ?? Math.max(0.002, 0.012 - (position - 11) * 0.001);
}

/** The last check date of a keyword, undefined if it was never checked. */
export function latestDate(dates: Record<string, SerpEntry[]> | undefined): string | undefined {
  return dates ? Object.keys(dates).sort().pop() : undefined;
}

export interface LatestResult {
  keyword: Keyword;
  entries: SerpEntry[];
  date: string;
}

/** The latest top 20 per keyword (keywords that were never checked are left out). */
export function latestResults(keywords: Keyword[], serp: SerpData): LatestResult[] {
  return keywords.flatMap((keyword) => {
    const dates = serp.results[keyword.id];
    const date = latestDate(dates);
    const entries = date ? dates?.[date] : undefined;
    return date && entries ? [{ keyword, entries, date }] : [];
  });
}

/** The best result of the given competitor keys (domains), undefined if none is in the list. */
export function domainPosition(entries: SerpEntry[], keys: Set<string>): SerpEntry | undefined {
  return entries.find((e) => keys.has(competitorOf(e).key));
}

/** A position for display: 1–20, or ">20" when not in the results. */
export function formatSerpPosition(entry: SerpEntry | undefined): string {
  return entry ? String(entry.position) : '>20';
}

export interface CompetitorStats {
  key: string;
  label: string;
  top10: number;
  top20: number;
  /** Average of the best position per keyword where it ranks. */
  avgPosition: number;
  /** Share of the estimated clicks of all top 20 results that are not ignored (0..1). */
  shareOfVoice: number;
}

/**
 * Stats per competitor (and, separately, per own domain). Ignored domains are left out completely,
 * also of the total of the share of voice; own domains are in the total but never competitors.
 */
export function competitorStats(
  latest: { entries: SerpEntry[] }[],
  own: Set<string>,
  ignored: Set<string>,
): { competitors: CompetitorStats[]; own: CompetitorStats[] } {
  const stats = new Map<string, { label: string; top10: number; top20: number; positions: number[]; clicks: number }>();
  let totalClicks = 0;
  for (const { entries } of latest) {
    const seen = new Set<string>();
    for (const entry of entries) {
      const { key, label } = competitorOf(entry);
      if (ignored.has(key)) continue;
      totalClicks += estimatedCtr(entry.position);
      const s = stats.get(key) ?? { label, top10: 0, top20: 0, positions: [], clicks: 0 };
      s.clicks += estimatedCtr(entry.position);
      // Counts and average use the best position per keyword.
      if (!seen.has(key)) {
        seen.add(key);
        s.top20 += 1;
        if (entry.position <= 10) s.top10 += 1;
        s.positions.push(entry.position);
      }
      stats.set(key, s);
    }
  }
  const all = [...stats.entries()]
    .map(([key, s]) => ({
      key,
      label: s.label,
      top10: s.top10,
      top20: s.top20,
      avgPosition: s.positions.reduce((a, b) => a + b, 0) / s.positions.length,
      shareOfVoice: totalClicks > 0 ? s.clicks / totalClicks : 0,
    }))
    .sort((a, b) => b.shareOfVoice - a.shareOfVoice);
  return { competitors: all.filter((s) => !own.has(s.key)), own: all.filter((s) => own.has(s.key)) };
}

export interface Gap {
  keyword: Keyword;
  /** Competitors (not own, not ignored) in the top 10, each once with its best position. */
  competitors: { competitor: Competitor; entry: SerpEntry }[];
  /** Best own result in the top 20, undefined if none. */
  mine: SerpEntry | undefined;
}

/** Keywords where a competitor that is not ignored is in the top 10, and none of the own domains is. */
export function gaps(latest: LatestResult[], own: Set<string>, ignored: Set<string>): Gap[] {
  return latest.flatMap(({ keyword, entries }) => {
    const mine = domainPosition(entries, own);
    if (mine && mine.position <= 10) return [];
    const competitors = new Map<string, { competitor: Competitor; entry: SerpEntry }>();
    for (const entry of entries) {
      const competitor = competitorOf(entry);
      if (entry.position > 10 || own.has(competitor.key) || ignored.has(competitor.key) || competitors.has(competitor.key)) continue;
      competitors.set(competitor.key, { competitor, entry });
    }
    return competitors.size ? [{ keyword, competitors: [...competitors.values()], mine }] : [];
  });
}
