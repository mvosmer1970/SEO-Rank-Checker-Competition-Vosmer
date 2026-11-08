// "How to take over": the ranking page of a competitor next to your own page, with the on-page differences.
import { useEffect, useState, type ReactNode } from 'react';
import { rootDomain } from '../shared/competition';
import { api, errorMessage } from './api';

export interface ComparisonRequest {
  keyword: string;
  theirUrl: string;
  theirPosition: number;
  /** '' when you have no page for the keyword. */
  myUrl: string;
  myPosition: number | undefined;
}

interface PageAnalysis {
  url: string;
  status: number;
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  words: number;
  faq: boolean;
  schemaTypes: string[];
  internalLinks: number;
  externalLinks: number;
  keywordInTitle: boolean;
  keywordInH1: boolean;
}

function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** All @type values of the JSON-LD blocks, also nested ones and those in @graph. */
function schemaTypes(doc: Document): string[] {
  const types = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key === '@type') {
          for (const t of Array.isArray(child) ? child : [child]) if (typeof t === 'string') types.add(t);
        } else visit(child);
      }
    }
  };
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      visit(JSON.parse(script.textContent ?? ''));
    } catch {
      // Invalid JSON-LD is ignored.
    }
  });
  return [...types].sort();
}

/** Analyses fetched HTML. DOMParser builds an inert document: no scripts run and nothing is loaded. */
function analyze(html: string, url: string, status: number, keyword: string): PageAnalysis {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const types = schemaTypes(doc);
  const h1 = [...doc.querySelectorAll('h1')].map(text).filter(Boolean);
  const h2 = [...doc.querySelectorAll('h2')].map(text).filter(Boolean);
  const title = text(doc.querySelector('title'));

  const headings = [...doc.querySelectorAll('h2, h3, h4')].map(text);
  const faq =
    types.includes('FAQPage') ||
    headings.some((h) => /faq|veelgestelde vragen|frequently asked|veel gestelde vragen/i.test(h)) ||
    doc.querySelectorAll('details').length >= 3;

  const host = rootDomain(url);
  let internalLinks = 0;
  let externalLinks = 0;
  doc.querySelectorAll('a[href]').forEach((a) => {
    try {
      const target = new URL(a.getAttribute('href') ?? '', url);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return;
      if (rootDomain(target.hostname) === host) internalLinks++;
      else externalLinks++;
    } catch {
      // Invalid link.
    }
  });

  doc.querySelectorAll('script, style, noscript, template, svg').forEach((e) => e.remove());
  const words = (doc.body?.textContent ?? '').split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
  const needle = keyword.toLowerCase();

  return {
    url,
    status,
    title,
    metaDescription: doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
    h1,
    h2,
    words,
    faq,
    schemaTypes: types,
    internalLinks,
    externalLinks,
    keywordInTitle: title.toLowerCase().includes(needle),
    keywordInH1: h1.some((h) => h.toLowerCase().includes(needle)),
  };
}

async function load(url: string, keyword: string): Promise<PageAnalysis> {
  const page = await api.fetchPage(url);
  return analyze(page.html, page.finalUrl, page.status, keyword);
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'done'; page: PageAnalysis };

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

export function PageComparison({ request, onClose }: { request: ComparisonRequest; onClose: () => void }) {
  const [theirs, setTheirs] = useState<State>({ kind: 'loading' });
  const [mine, setMine] = useState<State | undefined>(request.myUrl ? { kind: 'loading' } : undefined);

  useEffect(() => {
    load(request.theirUrl, request.keyword).then(
      (page) => setTheirs({ kind: 'done', page }),
      (e: unknown) => setTheirs({ kind: 'error', message: errorMessage(e) }),
    );
    if (request.myUrl) {
      load(request.myUrl, request.keyword).then(
        (page) => setMine({ kind: 'done', page }),
        (e: unknown) => setMine({ kind: 'error', message: errorMessage(e) }),
      );
    }
  }, [request]);

  const t = theirs.kind === 'done' ? theirs.page : undefined;
  const m = mine?.kind === 'done' ? mine.page : undefined;

  /** A row; `weaker` marks your value red when it falls short of theirs. */
  const row = (label: string, their: ReactNode, my: ReactNode, weaker = false) => (
    <tr key={label}>
      <th>{label}</th>
      <td>{t ? their : ''}</td>
      <td className={weaker ? 'weaker' : ''}>{m ? my : ''}</td>
    </tr>
  );
  const list = (items: string[]) =>
    items.length ? (
      <ul className="compact-list">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    ) : (
      <span className="muted">none</span>
    );
  const status = (state: State | undefined, url: string) =>
    !state ? (
      <span className="muted">You have no page for this keyword.</span>
    ) : state.kind === 'loading' ? (
      <span className="muted">Loading…</span>
    ) : state.kind === 'error' ? (
      <span className="error-text">{state.message}</span>
    ) : (
      <a href={url} target="_blank" rel="noreferrer">
        {url}
      </a>
    );

  const both = t && m;
  const relevantSchema = (types: string[]) => types.filter((x) => x === 'FAQPage' || x === 'Product');

  return (
    <section className="card comparison">
      <div className="row comparison-header">
        <h3>How to take over “{request.keyword}”</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <table className="compare-table">
        <thead>
          <tr>
            <th />
            <th>Competitor (#{request.theirPosition})</th>
            <th>You {request.myPosition ? `(#${request.myPosition})` : '(not in top 20)'}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Page</th>
            <td>{status(theirs, t?.url ?? request.theirUrl)}</td>
            <td>{status(mine, m?.url ?? request.myUrl)}</td>
          </tr>
          {row('Title', t?.title, m?.title, both ? !m.title : false)}
          {row('Keyword in title', yesNo(t?.keywordInTitle ?? false), yesNo(m?.keywordInTitle ?? false), both ? t.keywordInTitle && !m.keywordInTitle : false)}
          {row('Meta description', t?.metaDescription || '–', m?.metaDescription || '–', both ? !!t.metaDescription && !m.metaDescription : false)}
          {row('H1', list(t?.h1 ?? []), list(m?.h1 ?? []), both ? m.h1.length === 0 : false)}
          {row('Keyword in H1', yesNo(t?.keywordInH1 ?? false), yesNo(m?.keywordInH1 ?? false), both ? t.keywordInH1 && !m.keywordInH1 : false)}
          {row(`H2's`, <>{t?.h2.length} {list(t?.h2 ?? [])}</>, <>{m?.h2.length} {list(m?.h2 ?? [])}</>, both ? m.h2.length < t.h2.length : false)}
          {row('Words', t?.words.toLocaleString(), m?.words.toLocaleString(), both ? m.words < t.words * 0.8 : false)}
          {row('FAQ present', yesNo(t?.faq ?? false), yesNo(m?.faq ?? false), both ? t.faq && !m.faq : false)}
          {row(
            'Schema FAQ / Product',
            relevantSchema(t?.schemaTypes ?? []).join(', ') || 'none',
            relevantSchema(m?.schemaTypes ?? []).join(', ') || 'none',
            both ? relevantSchema(t.schemaTypes).some((x) => !m.schemaTypes.includes(x)) : false,
          )}
          {row('All schema types', t?.schemaTypes.join(', ') || 'none', m?.schemaTypes.join(', ') || 'none')}
          {row('Internal links', t?.internalLinks, m?.internalLinks, both ? m.internalLinks < t.internalLinks * 0.8 : false)}
          {row('External links', t?.externalLinks, m?.externalLinks)}
        </tbody>
      </table>
      <p className="hint">Red: your page falls short of the competitor on that point. Pages are fetched as they are now, without running scripts.</p>
    </section>
  );
}
