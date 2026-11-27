// Summaries of the daily Search Console metrics of a keyword.
import type { DayMetrics } from './types';

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}

/**
 * Only the days with real data: impressions and a position above 0 (position 0 means no data).
 * History synced before this check may still contain such days.
 */
export function validDays(days: Record<string, DayMetrics>): Record<string, DayMetrics> {
  return Object.fromEntries(Object.entries(days).filter(([, m]) => m.impressions > 0 && m.position > 0));
}

interface RangeSummary {
  /** Impression-weighted average position, undefined without impressions. */
  position: number | undefined;
  clicks: number;
  impressions: number;
}

/** A position based on fewer impressions than this is shown as uncertain (grey with "?") and gives no alerts. */
export const LOW_DATA_IMPRESSIONS = 5;

export function isLowData(impressions: number): boolean {
  return impressions < LOW_DATA_IMPRESSIONS;
}

/** Summary of the days from `from` up to and including `to` (YYYY-MM-DD). */
export function summarize(days: Record<string, DayMetrics>, from: string, to: string): RangeSummary {
  let weighted = 0;
  let clicks = 0;
  let impressions = 0;
  for (const [date, metrics] of Object.entries(days)) {
    if (date < from || date > to) continue;
    weighted += metrics.position * metrics.impressions;
    clicks += metrics.clicks;
    impressions += metrics.impressions;
  }
  return { position: impressions > 0 ? weighted / impressions : undefined, clicks, impressions };
}

export interface KeywordSummary {
  latestDate: string | undefined;
  latestPosition: number | undefined;
  latestImpressions: number;
  /** Impression-weighted average of the last 7 days and of the 7 days before, with their impressions. */
  week: number | undefined;
  weekImpressions: number;
  previousWeek: number | undefined;
  previousWeekImpressions: number;
  /** Impression-weighted average of the last 28 days. */
  month: number | undefined;
  clicks28: number;
  impressions28: number;
  /** Best day, with the impressions of that day. */
  bestPosition: number | undefined;
  bestImpressions: number;
}

export function summarizeKeyword(allDays: Record<string, DayMetrics>): KeywordSummary {
  const days = validDays(allDays);
  const dates = Object.keys(days).sort();
  const latestDate = dates[dates.length - 1];
  const today = daysAgo(0);
  const last28 = summarize(days, daysAgo(27), today);
  const week = summarize(days, daysAgo(6), today);
  const previousWeek = summarize(days, daysAgo(13), daysAgo(7));
  // The best day with enough impressions; only without such days the best day of all (shown as uncertain).
  let best: DayMetrics | undefined;
  let bestReliable: DayMetrics | undefined;
  for (const metrics of Object.values(days)) {
    if (!best || metrics.position < best.position) best = metrics;
    if (!isLowData(metrics.impressions) && (!bestReliable || metrics.position < bestReliable.position)) bestReliable = metrics;
  }
  best = bestReliable ?? best;
  const latest = latestDate ? days[latestDate] : undefined;
  return {
    latestDate,
    latestPosition: latest?.position,
    latestImpressions: latest?.impressions ?? 0,
    week: week.position,
    weekImpressions: week.impressions,
    previousWeek: previousWeek.position,
    previousWeekImpressions: previousWeek.impressions,
    month: last28.position,
    clicks28: last28.clicks,
    impressions28: last28.impressions,
    bestPosition: best?.position,
    bestImpressions: best?.impressions ?? 0,
  };
}

export function formatPosition(position: number | undefined): string {
  return position === undefined ? '–' : position.toFixed(1);
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
