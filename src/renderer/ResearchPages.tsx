// Site research, Content tab: every crawled page with its type, language, title, H1, length, date and 1-3 suggested
// keywords, with filters, Copy all and a CSV export. A click on a row shows the detail of the page.
import { useMemo, useState, type ReactNode } from 'react';
import type { ResearchPage } from '../shared/types';
import { api, errorMessage } from './api';
import { CopyButton } from './CopyButton';
import { h1Of, PAGE_TYPES, pathOf, type PageType } from './siteAnalysis';
import { ExternalLink, sortRows, useSort } from './table';

type SortKey = 'type' | 'language' | 'title' | 'h1' | 'words' | 'date' | 'keywords';

/** A page with what the Content table shows of it. */
export interface ContentRow {
  page: ResearchPage;
  type: PageType;
  language: string;
  keywords: string[];
}

interface Props {
  rows: ContentRow[];
  domain: string;
  search: string;
  onSearch: (search: string) => void;
  selectedUrl: string | undefined;
  onSelect: (url: string | undefined) => void;
  onError: (message: string) => void;
}

/** Release notes and legal pages are hidden at first, so the real content shows. */
const DEFAULT_TYPES = new Set<PageType>(['Product', 'Blog', 'Other']);

const dateOf = (p: ResearchPage) => p.published || p.modified;

const HEADERS = ['Type', 'Language', 'Title', 'URL', 'H1', 'Words', 'Date', 'Keywords'];

function cells(r: ContentRow): (string | number)[] {
  return [r.type, r.language, r.page.title, r.page.url, h1Of(r.page)[0] ?? '', r.page.words, dateOf(r.page), r.keywords.join(', ')];
}

/** CSV with semicolons (what Excel expects with Dutch and German settings) and a BOM, so Excel reads it as UTF-8. */
function toCsv(rows: ContentRow[]): string {
  const quote = (value: string | number) => {
    const text = String(value);
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${[HEADERS, ...rows.map(cells)].map((row) => row.map(quote).join(';')).join('\r\n')}\r\n`;
}

export function ResearchPages({ rows, domain, search, onSearch, selectedUrl, onSelect, onError }: Props) {
  const { sort, th } = useSort<SortKey>({ key: 'type', asc: true }, ['type', 'language', 'title', 'h1', 'keywords']);
  const [types, setTypes] = useState<Set<PageType>>(DEFAULT_TYPES);
  const [language, setLanguage] = useState('');
  const languages = useMemo(() => [...new Set(rows.map((r) => r.language).filter(Boolean))].sort(), [rows]);

  const typeCounts = useMemo(() => {
    const counts = new Map<PageType, number>();
    for (const r of rows) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
    return counts;
  }, [rows]);

  const visible = useMemo(() => {
    // Every word must be in the URL, title, H1, meta description or the suggested keywords.
    const needles = search.toLowerCase().split(/\s+/).filter(Boolean);
    const list = rows.filter((r) => {
      if (!types.has(r.type) || (language && r.language !== language)) return false;
      if (!needles.length) return true;
      const haystack = [r.page.url, r.page.title, r.page.metaDescription, ...h1Of(r.page), ...r.keywords].join('\n').toLowerCase();
      return needles.every((n) => haystack.includes(n));
    });
    const value = (r: ContentRow): string | number | undefined => {
      switch (sort.key) {
        case 'type':
          return PAGE_TYPES.indexOf(r.type);
        case 'language':
          return r.language;
        case 'title':
          return r.page.title;
        case 'h1':
          return h1Of(r.page)[0];
        case 'words':
          return r.page.words;
        case 'date':
          return dateOf(r.page);
        case 'keywords':
          return r.keywords[0];
      }
    };
    return sortRows(list, value, sort.asc);
  }, [rows, types, language, search, sort]);

  const selected = rows.find((r) => r.page.url === selectedUrl)?.page;

  const exportCsv = () => {
    api.saveTextFile(`${domain}-content.csv`, toCsv(visible)).catch((e: unknown) => onError(errorMessage(e)));
  };

  return (
    <div className="keywords-layout">
      {selected && (
        <div className="side-column">
          <PageDetail page={selected} onClose={() => onSelect(undefined)} />
        </div>
      )}
      <div className="keywords-main">
        <div className="row">
          {PAGE_TYPES.map((t) => (
            <button
              key={t}
              className={`chip${types.has(t) ? ' active' : ''}`}
              title={types.has(t) ? 'Shown: click to hide' : 'Hidden: click to show'}
              onClick={() => {
                const next = new Set(types);
                if (next.has(t)) next.delete(t);
                else next.add(t);
                setTypes(next);
              }}
            >
              {t} · {typeCounts.get(t) ?? 0}
            </button>
          ))}
          <select value={language} onChange={(e) => setLanguage(e.target.value)} title="Language (from the URL or <html lang>)">
            <option value="">All languages</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <input
            type="search"
            className="keyword-search"
            placeholder="Search URL, title, H1 or keywords (all words)"
            spellCheck={false}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onSearch('');
            }}
          />
          <span className="muted small">
            {visible.length} of {rows.length} pages
          </span>
          <button onClick={exportCsv} disabled={visible.length === 0} title="Save the pages shown as a CSV file (opens in Excel)">
            Export CSV
          </button>
        </div>
        <section className="card">
          <table className="keywords research-table">
            <thead>
              <tr>
                {th('type', 'Type')}
                {th('language', 'Language')}
                {th('title', 'Title')}
                {th('h1', 'H1')}
                {th('words', 'Words', 'num')}
                {th('date', 'Date')}
                {th('keywords', 'Keywords')}
                <th className="num">
                  <CopyButton headers={HEADERS} rows={visible.map(cells)} />
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.page.url}
                  className={r.page.url === selectedUrl ? 'selected' : ''}
                  onClick={() => onSelect(r.page.url === selectedUrl ? undefined : r.page.url)}
                >
                  <td className="small">{r.type}</td>
                  <td className="small">{r.language}</td>
                  <td className="page-title-cell">
                    <ExternalLink url={r.page.url} label={r.page.title || pathOf(r.page.url)} />
                    <div className="muted small research-path">{pathOf(r.page.url)}</div>
                  </td>
                  <td className="small">{h1Of(r.page)[0] ?? ''}</td>
                  <td className={`num${r.page.words < 300 ? ' down' : ''}`}>{r.page.words}</td>
                  <td className="small nowrap">{dateOf(r.page)}</td>
                  <td>
                    {r.keywords.map((k) => (
                      <span key={k} className="tag">
                        {k}
                      </span>
                    ))}
                  </td>
                  <td />
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No pages match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{children}</td>
    </tr>
  );
}

function PageDetail({ page, onClose }: { page: ResearchPage; onClose: () => void }) {
  return (
    <section className="card page-detail">
      <div className="row comparison-header">
        <h3>{page.title || pathOf(page.url)}</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="small">
        <ExternalLink url={page.url} />
      </p>
      {page.error && <div className="banner error">{page.error}</div>}
      <table className="compare-table">
        <tbody>
          <Field label="Title">
            {page.title} <span className="muted small">({page.title.length} characters)</span>
          </Field>
          <Field label="Meta description">
            {page.metaDescription || <span className="muted">–</span>}{' '}
            {page.metaDescription && <span className="muted small">({page.metaDescription.length} characters)</span>}
          </Field>
          <Field label="Words">{page.words}</Field>
          <Field label="Structured data">{page.schemaTypes.join(', ') || '–'}</Field>
          <Field label="Dates">
            {page.published ? `Published ${page.published}` : ''}
            {page.published && page.modified ? ' · ' : ''}
            {page.modified ? `Modified ${page.modified}` : ''}
            {!page.published && !page.modified && '–'}
          </Field>
          <Field label="Links">
            {page.inbound} in from crawled pages · {page.internalLinks} internal out · {page.externalLinks} external out
          </Field>
          {page.externalDomains.length > 0 && <Field label="Links to">{page.externalDomains.join(', ')}</Field>}
          <Field label="Images">
            {page.images}
            {page.imagesWithoutAlt > 0 && <span className="down"> ({page.imagesWithoutAlt} without alt)</span>}
          </Field>
          <Field label="Other">
            {[
              page.lang && `lang=${page.lang}`,
              page.ogType && `og:type=${page.ogType}`,
              page.noindex && 'noindex',
              page.canonical && page.canonical !== page.url && `canonical ${page.canonical}`,
              page.inSitemap ? 'in sitemap' : 'not in sitemap',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Field>
        </tbody>
      </table>

      {page.headings.length > 0 && (
        <>
          <h4>Heading outline</h4>
          <ul className="outline">
            {page.headings.map((h, i) => (
              <li key={i} className={`outline-h${h.level}`}>
                <span className="outline-level">H{h.level}</span> {h.text}
              </li>
            ))}
          </ul>
        </>
      )}

      {page.terms.length > 0 && (
        <>
          <h4>Most used words</h4>
          <div className="term-cloud">
            {page.terms.map(([t, c]) => (
              <span key={t} className="tag">
                {t} <span className="muted">{c}</span>
              </span>
            ))}
          </div>
        </>
      )}
      {page.phrases.length > 0 && (
        <>
          <h4>Most used phrases</h4>
          <div className="term-cloud">
            {page.phrases.map(([t, c]) => (
              <span key={t} className="tag">
                {t} <span className="muted">{c}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
