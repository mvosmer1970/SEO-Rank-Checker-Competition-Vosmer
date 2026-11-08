// "Copy all" of a project: its settings (no API keys or Google credentials) and all its data, as Markdown text.
import {
  competitorOf,
  competitorStats,
  domainPosition,
  formatSerpPosition,
  gaps,
  latestResults,
  ownDomainSet,
} from '../shared/competition';
import { daysAgo, summarize, summarizeKeyword, validDays } from '../shared/metrics';
import type { DayMetrics, Project, ProjectHistory, SerpData } from '../shared/types';
import { api, errorMessage } from './api';

type Cell = string | number | undefined;

function cell(value: Cell): string {
  if (value === undefined || value === '') return '–';
  const text = typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(1)) : value;
  return text.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function table(headers: string[], rows: Cell[][]): string {
  if (rows.length === 0) return '_None._';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

/** Impression-weighted average position per month (YYYY-MM). */
function monthly(days: Record<string, DayMetrics>): Map<string, number> {
  const sums = new Map<string, { weighted: number; impressions: number }>();
  for (const [date, m] of Object.entries(validDays(days))) {
    const month = date.slice(0, 7);
    const s = sums.get(month) ?? { weighted: 0, impressions: 0 };
    s.weighted += m.position * m.impressions;
    s.impressions += m.impressions;
    sums.set(month, s);
  }
  return new Map([...sums].map(([month, s]) => [month, s.weighted / s.impressions]));
}

const DEVICE_LABELS: Record<string, string> = { '': 'All devices', DESKTOP: 'Desktop', MOBILE: 'Mobile', TABLET: 'Tablet' };

export async function buildProjectReport(project: Project, history: ProjectHistory, signedIn: boolean): Promise<string> {
  const out: string[] = [];
  const own = ownDomainSet(project.ownDomains, project.siteUrl);
  const ownList = [...own].sort();
  const ignored = new Set(project.ignoredDomains);
  const gscAverage = (id: string) => summarize(validDays(history[id] ?? {}), daysAgo(27), daysAgo(0)).position;

  out.push(`# SEO Rank Tracker – ${project.name}`, `Exported ${new Date().toLocaleString()}`);

  out.push(
    '## Settings',
    [
      `- Search Console property: ${project.siteUrl}`,
      `- Country (Search Console): ${project.country ? project.country.toUpperCase() : 'All countries'}`,
      `- Device: ${DEVICE_LABELS[project.device] ?? project.device}`,
      `- Competition: Google country ${project.serpCountry}, language ${project.serpLanguage}`,
      `- Own domains: ${ownList.join(', ')}`,
      `- Ignored domains: ${project.ignoredDomains.join(', ') || 'none'}`,
      `- Keywords: ${project.keywords.length}`,
      `- Last Search Console sync: ${project.lastSyncAt ? new Date(project.lastSyncAt).toLocaleString() : 'never'}`,
      `- Last competition check: ${project.lastSerpCheckAt ? new Date(project.lastSerpCheckAt).toLocaleString() : 'never'}`,
    ].join('\n'),
  );

  out.push('## Notes', project.notes.trim() || '_None._');

  // ---------------------------------------------------------------- keywords (Search Console)
  out.push(
    '## Keywords (Search Console)',
    table(
      ['Keyword', 'Tags', 'Page', 'Latest', 'Latest date', 'Avg 7d', 'Change vs prev. 7d', 'Best', 'Avg 28d', 'Clicks 28d', 'Impr. 28d', 'Language'],
      project.keywords.map((k) => {
        const s = summarizeKeyword(history[k.id] ?? {});
        const change = s.week !== undefined && s.previousWeek !== undefined ? s.previousWeek - s.week : undefined;
        return [
          k.text,
          k.tags.join(', '),
          k.pages[0]?.url,
          s.latestPosition,
          s.latestDate,
          s.week,
          change === undefined ? undefined : `${change > 0 ? '+' : ''}${change.toFixed(1)}`,
          s.bestPosition,
          gscAverage(k.id),
          s.clicks28,
          s.impressions28,
          k.serpLanguage || project.serpLanguage,
        ];
      }),
    ),
  );

  const perKeyword = project.keywords.map((k) => ({ keyword: k, months: monthly(history[k.id] ?? {}) }));
  const months = [...new Set(perKeyword.flatMap((p) => [...p.months.keys()]))].sort();
  out.push(
    '## Position history (Search Console, monthly average)',
    months.length ? table(['Keyword', ...months], perKeyword.map((p) => [p.keyword.text, ...months.map((m) => p.months.get(m))])) : '_No history._',
  );

  // ---------------------------------------------------------------- competition (Serper)
  let serp: SerpData = { results: {} };
  try {
    serp = await api.getSerpData(project.id);
  } catch (e) {
    out.push('## Competition', `_Could not be loaded: ${errorMessage(e)}_`);
  }
  const latest = latestResults(project.keywords, serp);
  if (latest.length === 0) {
    out.push('## Competition', '_No competition checks yet._');
  } else {
    const stats = competitorStats(latest, own, ignored);
    const lastDate = latest.map((l) => l.date).sort().pop();
    out.push(`## Competition (Google ${project.serpCountry.toUpperCase()}, last check ${lastDate ?? ''})`);
    out.push(
      '### Your positions per keyword',
      table(
        ['Keyword', ...ownList.map((d) => `${d} (Google now)`), 'GSC avg 28d', '#1', 'Results fetched'],
        latest.map((l) => [
          l.keyword.text,
          ...ownList.map((d) => formatSerpPosition(domainPosition(l.entries, new Set([d])))),
          gscAverage(l.keyword.id),
          l.entries[0] ? competitorOf(l.entries[0]).label : undefined,
          l.entries.length,
        ]),
      ),
    );
    out.push(
      '### Your share of voice',
      table(
        ['Domain', 'Top 10', 'Top 20', 'Avg position', 'Share of voice %'],
        stats.own.map((s) => [s.label, s.top10, s.top20, s.avgPosition, s.shareOfVoice * 100]),
      ),
    );
    out.push(
      '### Competitors',
      table(
        ['Competitor', 'Top 10', 'Top 20', 'Avg position', 'Share of voice %'],
        stats.competitors.map((s) => [s.label, s.top10, s.top20, s.avgPosition, s.shareOfVoice * 100]),
      ),
    );
    out.push(
      '### Gaps (a competitor in the top 10, none of your domains)',
      table(
        ['Keyword', 'Competitors in the top 10', 'Your best', 'GSC avg 28d'],
        gaps(latest, own, ignored).map((g) => [
          g.keyword.text,
          g.competitors.map((c) => `${c.competitor.label} (#${c.entry.position})`).join(', '),
          formatSerpPosition(g.mine),
          gscAverage(g.keyword.id),
        ]),
      ),
    );
    out.push('### Top 20 per keyword');
    for (const l of latest) {
      out.push(
        `#### ${l.keyword.text} (${l.date})`,
        table(
          ['#', 'Competitor', 'Title', 'URL', 'Note'],
          l.entries.map((e) => {
            const c = competitorOf(e);
            return [e.position, c.label, e.title, e.url, own.has(c.key) ? 'own' : ignored.has(c.key) ? 'ignored' : ''];
          }),
        ),
      );
    }
  }

  // ---------------------------------------------------------------- live Search Console lists
  if (signedIn) {
    try {
      const opportunities = await api.getOpportunities(project.id);
      out.push(
        '## Opportunities (Search Console, last 28 days, position 5–20, ≥5 impressions, not tracked)',
        table(['Query', 'Position', 'Impressions', 'Clicks'], opportunities.map((o) => [o.query, o.position, o.impressions, o.clicks])),
      );
    } catch (e) {
      out.push('## Opportunities', `_Could not be loaded: ${errorMessage(e)}_`);
    }
    try {
      const ranking = await api.getRankingKeywords(project.id, {
        days: 28,
        country: project.country,
        device: project.device,
        maxPosition: 100,
      });
      out.push(
        '## Ranking keywords (Search Console, last 28 days, top 100)',
        table(
          ['Keyword', 'Position', 'Clicks', 'Impressions', 'CTR %', 'Page', 'Tracked'],
          ranking.map((r) => [r.query, r.position, r.clicks, r.impressions, r.ctr * 100, r.page, r.tracked ? 'yes' : 'no']),
        ),
      );
    } catch (e) {
      out.push('## Ranking keywords', `_Could not be loaded: ${errorMessage(e)}_`);
    }
  } else {
    out.push('## Opportunities and ranking keywords', '_Not signed in to Google: not included._');
  }

  return out.join('\n\n') + '\n';
}
