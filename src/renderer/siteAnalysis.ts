// On-page analysis of crawled HTML and the site-wide statistics of a researched site.
import type { ResearchHeading, ResearchKeyword, ResearchPage } from '../shared/types';

export function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Walks every JSON-LD block (also nested objects and @graph). */
function visitJsonLd(doc: Document, visitor: (key: string, value: unknown) => void): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        visitor(key, child);
        if (key !== '@type') visit(child);
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
}

/** All @type values of the JSON-LD blocks. */
export function schemaTypes(doc: Document): string[] {
  const types = new Set<string>();
  visitJsonLd(doc, (key, value) => {
    if (key !== '@type') return;
    for (const t of Array.isArray(value) ? value : [value]) if (typeof t === 'string') types.add(t);
  });
  return [...types].sort();
}

// ---------------------------------------------------------------- words

/** Common Dutch and English words that say nothing about the topic of a page. */
const STOPWORDS = new Set(
  `aan aangezien al alle alleen alles als altijd andere anders ben bent bij bijvoorbeeld binnen boven daar daarbij daardoor daarin daarna daarom
  daarmee dan dat de deze die dit doch doen door dus een eens eigen elk elke en enkele er erg even geen gehad gelijk gemaakt geweest gewoon
  graag haar had hadden heb hebben hebt heeft hem hen het hier hij hoe hoewel hun ieder iedere iemand iets ik in is ja je jij jou jouw jullie
  kan kon konden kun kunnen kunt laat maar maken me meer meest men met mij mijn minder misschien mogelijk moet moeten na naar naast niet niets
  nog nu of ofwel om omdat onder ons onze ook op over per steeds te tegen ten ter terwijl toch toe tot tussen u uit uw van veel verder via
  voor vooral vanaf waar waarbij waardoor waarin waarom wanneer want was waren wat we wel welk welke wie wij wil willen word worden wordt
  zal zelf zich zij zijn zo zoals zodat zonder zou zouden zeer echter ga gaan gaat komt komen krijgt krijgen hele heel goed nieuwe meer lees
  about above after again against all also am an and any are as at be because been before being below between both but by can could did do
  does doing down during each few for from further get gets got had has have having he her here hers him his how if in into is it its itself
  just let like make made many may me more most much must my no nor not now of off on once only or other our ours out over own read same
  see she should so some such than that the their theirs them then there these they this those through to too under until up us use used
  using very was we well were what when where which while who whom why will with within without would you your yours new one two three
  www http https com nl html cookie cookies privacy menu home click hier lees meer read more
  aber alle allem allen aller alles als also am an ander andere anderen auch auf aus bei bin bis bist da damit dann das dass dem den
  denn der des dich die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines er es etwas euch
  euer eure für gegen gibt hab habe haben hat hatte hier hin hinter ich ihm ihn ihnen ihr ihre im in ins ist ja jede jedem jeden jeder
  jedes jetzt kann kein keine können man mehr mein meine mit muss nach nicht nichts noch nun nur ob oder ohne sehr sein seine sich
  sie sind so solche soll sondern sonst über um und uns unser unsere unter viel vom von vor während war waren was weil weiter welche
  wenn werden wie wieder will wir wird wo wollen zu zum zur zwischen ihre ihren mehr neue neuen sowie bzw`.split(/\s+/),
);

/** The words of a text in lower case: letters and digits, at least one letter. */
export function tokenize(value: string): string[] {
  return value.toLowerCase().match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];
}

function isTopicWord(word: string): boolean {
  return word.length >= 3 && !STOPWORDS.has(word);
}

function top(counts: Map<string, number>, n: number, minCount = 1): [string, number][] {
  return [...counts]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
}

/** Word and phrase (2-3 words) counts of a text; phrases do not start or end with a stopword. */
export function countTerms(words: string[]): { terms: Map<string, number>; phrases: Map<string, number> } {
  const terms = new Map<string, number>();
  const phrases = new Map<string, number>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? '';
    if (isTopicWord(w)) terms.set(w, (terms.get(w) ?? 0) + 1);
    for (const size of [2, 3]) {
      const gram = words.slice(i, i + size);
      if (gram.length < size) continue;
      const first = gram[0] ?? '';
      const last = gram[size - 1] ?? '';
      if (!isTopicWord(first) || !isTopicWord(last) || gram.some((g) => g.length < 2)) continue;
      const phrase = gram.join(' ');
      phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
    }
  }
  return { terms, phrases };
}

// ---------------------------------------------------------------- page analysis

/** Host name without www, used to decide whether a link stays on the site. */
export function siteHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A crawlable form of a URL: no fragment, and (for links found on pages) no query string. */
export function normalizeUrl(href: string, base: string, keepQuery: boolean): string | undefined {
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    if (!keepQuery) url.search = '';
    return url.href;
  } catch {
    return undefined;
  }
}

function isoDay(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (match?.[1]) return match[1];
  const time = Date.parse(value);
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
}

/** Schema.org types that only describe parts of other types (left out of the page's structured data types). */
const HELPER_TYPES = new Set([
  'Answer',
  'Question',
  'ListItem',
  'EntryPoint',
  'PropertyValueSpecification',
  'PropertyValue',
  'ImageObject',
  'PostalAddress',
  'ContactPoint',
  'GeoCoordinates',
  'ReadAction',
  'SearchAction',
  'Rating',
  'QuantitativeValue',
  'MonetaryAmount',
  'OpeningHoursSpecification',
  'WebPageElement',
  'SiteNavigationElement',
  'Thing',
]);

const MAX_HEADINGS = 120;
const MAX_HEADING_LENGTH = 160;

/** Word count, words and phrases of the text blocks of a page, without the blocks that are boilerplate. */
export function contentStats(texts: string[], boilerplate: Set<string>): Pick<ResearchPage, 'words' | 'terms' | 'phrases'> {
  const words = texts.filter((t) => !boilerplate.has(t)).flatMap(tokenize);
  const { terms, phrases } = countTerms(words);
  return { words: words.length, terms: top(terms, 20), phrases: top(phrases, 15, 2) };
}

/**
 * Text blocks that are on at least a quarter of the pages (and on 3 or more): template parts that are no navigation,
 * header or footer element, such as banners, author boxes and (rotating) "related" lists.
 */
export function boilerplateTexts(textsPerPage: string[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const texts of textsPerPage) for (const t of new Set(texts)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const min = Math.max(3, textsPerPage.length / 4);
  return new Set([...counts].filter(([, n]) => n >= min).map(([t]) => t));
}

/**
 * Analyses fetched HTML. DOMParser builds an inert document: no scripts run and nothing is loaded. `texts` are the
 * text blocks of the main content, to leave out the boilerplate at the end of the crawl (see contentStats).
 */
export function analyzeHtml(html: string, url: string, status: number): { page: ResearchPage; links: string[]; texts: string[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const host = siteHost(url);
  const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content')?.trim() ?? '';

  let published = meta('meta[property="article:published_time"]') || meta('meta[name="date"]');
  let modified = meta('meta[property="article:modified_time"]') || meta('meta[property="og:updated_time"]');
  visitJsonLd(doc, (key, value) => {
    if (typeof value !== 'string') return;
    if (key === 'datePublished' && !published) published = value;
    if (key === 'dateModified' && !modified) modified = value;
  });

  const headings: ResearchHeading[] = [...doc.querySelectorAll('h1, h2, h3')]
    .map((h) => ({ level: Number(h.tagName.slice(1)), text: text(h).slice(0, MAX_HEADING_LENGTH) }))
    .filter((h) => h.text)
    .slice(0, MAX_HEADINGS);

  const links = new Set<string>();
  const externalDomains = new Map<string, number>();
  let internalLinks = 0;
  let externalLinks = 0;
  doc.querySelectorAll('a[href]').forEach((a) => {
    const target = normalizeUrl(a.getAttribute('href') ?? '', url, false);
    if (!target) return;
    const targetHost = siteHost(target);
    if (targetHost === host) {
      internalLinks++;
      links.add(target);
    } else {
      externalLinks++;
      externalDomains.set(targetHost, (externalDomains.get(targetHost) ?? 0) + 1);
    }
  });

  const images = [...doc.querySelectorAll('img')];
  const canonicalHref = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
  const types = schemaTypes(doc).filter((t) => !HELPER_TYPES.has(t));

  // The main content: <main> or <article> when the page has one, without navigation, header, footer and forms.
  doc.querySelectorAll('script, style, noscript, template, svg, iframe').forEach((e) => e.remove());
  const container = doc.querySelector('main, [role="main"], article') ?? doc.body;
  container?.querySelectorAll('nav, header, footer, aside, form, [role="navigation"]').forEach((e) => e.remove());
  const texts: string[] = [];
  if (container) {
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (value) texts.push(value);
    }
  }

  return {
    links: [...links],
    texts,
    page: {
      url,
      status,
      error: '',
      title: text(doc.querySelector('title')),
      metaDescription: meta('meta[name="description"]'),
      canonical: canonicalHref ? (normalizeUrl(canonicalHref, url, true) ?? '') : '',
      noindex: /noindex/i.test(meta('meta[name="robots"]')),
      lang: doc.documentElement.getAttribute('lang') ?? '',
      headings,
      ...contentStats(texts, new Set()),
      internalLinks,
      externalLinks,
      externalDomains: top(externalDomains, 15).map(([d]) => d),
      inbound: 0,
      images: images.length,
      imagesWithoutAlt: images.filter((img) => !img.hasAttribute('alt')).length,
      schemaTypes: types,
      ogType: meta('meta[property="og:type"]'),
      published: published ? isoDay(published) : '',
      modified: modified ? isoDay(modified) : '',
      inSitemap: false,
    },
  };
}

/** A page that could not be fetched or is no HTML page. */
export function failedPage(url: string, status: number, error: string): ResearchPage {
  return {
    url,
    status,
    error,
    title: '',
    metaDescription: '',
    canonical: '',
    noindex: false,
    lang: '',
    headings: [],
    words: 0,
    internalLinks: 0,
    externalLinks: 0,
    externalDomains: [],
    inbound: 0,
    images: 0,
    imagesWithoutAlt: 0,
    schemaTypes: [],
    ogType: '',
    published: '',
    modified: '',
    terms: [],
    phrases: [],
    inSitemap: false,
  };
}

// ---------------------------------------------------------------- site statistics

export function isOk(page: ResearchPage): boolean {
  return page.status >= 200 && page.status < 300 && !page.error;
}

/** The path of a URL, e.g. "/blog/post/" ("/" for the home page). */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURI(parsed.pathname) + parsed.search;
  } catch {
    return url;
  }
}

/** The first folder of the path ("/" for pages in the root), the section of the site that a page belongs to. */
export function sectionOf(url: string): string {
  const segments = pathOf(url).split('?')[0]?.split('/').filter(Boolean) ?? [];
  return segments.length > 1 ? `/${segments[0]}/` : '/';
}

export function depthOf(url: string): number {
  return (pathOf(url).split('?')[0]?.split('/').filter(Boolean) ?? []).length;
}

export function h1Of(page: ResearchPage): string[] {
  return page.headings.filter((h) => h.level === 1).map((h) => h.text);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

const TITLE_SEPARATORS = /\s+[|–—\-·:•»]\s+/;

/**
 * The brand part that most titles share at the end (e.g. " | Example"), '' when fewer than a third of the titles
 * have the same last part.
 */
export function titleSuffix(pages: ResearchPage[]): { suffix: string; share: number } {
  const counts = new Map<string, number>();
  const titles = pages.map((p) => p.title).filter(Boolean);
  for (const title of titles) {
    const match = /(\s+[|–—\-·:•»]\s+[^|–—·:•»]+)$/.exec(title);
    if (match?.[1]) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  const [best] = top(counts, 1);
  if (!best || best[1] < Math.max(2, titles.length / 3)) return { suffix: '', share: 0 };
  return { suffix: best[0], share: best[1] / titles.length };
}

/** The title without the brand suffix. */
export function bareTitle(title: string, suffix: string): string {
  return suffix && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title.trim();
}

export interface SectionStats {
  section: string;
  pages: number;
  avgWords: number;
  avgInbound: number;
  schemaTypes: string[];
  dated: number;
  latest: string;
  examples: string[];
}

export function sectionStats(pages: ResearchPage[], suffix: string): SectionStats[] {
  const groups = new Map<string, ResearchPage[]>();
  for (const page of pages.filter(isOk)) {
    const section = sectionOf(page.url);
    groups.set(section, [...(groups.get(section) ?? []), page]);
  }
  return [...groups].map(([section, list]) => {
    const types = new Map<string, number>();
    for (const p of list) for (const t of p.schemaTypes) types.set(t, (types.get(t) ?? 0) + 1);
    const dates = list.map((p) => p.published || p.modified).filter(Boolean).sort();
    return {
      section,
      pages: list.length,
      avgWords: average(list.map((p) => p.words)),
      avgInbound: average(list.map((p) => p.inbound)),
      schemaTypes: top(types, 4).map(([t]) => t),
      dated: dates.length,
      latest: dates[dates.length - 1] ?? '',
      examples: list.slice(0, 3).map((p) => bareTitle(p.title, suffix) || pathOf(p.url)),
    };
  });
}

export interface TermStats {
  term: string;
  /** Pages that use it. */
  pages: number;
  /** Total occurrences over all pages (of the counted top terms per page). */
  count: number;
  /** Pages with it in the title or H1. */
  inTitle: number;
}

/** Site-wide terms or phrases: in how many pages they are among the most used, and in how many titles/H1s. */
export function siteTerms(pages: ResearchPage[], kind: 'terms' | 'phrases'): TermStats[] {
  const stats = new Map<string, TermStats>();
  for (const page of pages.filter(isOk)) {
    const heading = `${page.title} ${h1Of(page).join(' ')}`.toLowerCase();
    for (const [term, count] of page[kind]) {
      const s = stats.get(term) ?? { term, pages: 0, count: 0, inTitle: 0 };
      s.pages++;
      s.count += count;
      if (heading.includes(term)) s.inTitle++;
      stats.set(term, s);
    }
  }
  return [...stats.values()].sort((a, b) => b.pages - a.pages || b.count - a.count);
}

export interface Issue {
  key: string;
  label: string;
  description: string;
  pages: ResearchPage[];
}

/** `complete`: the whole site was crawled (only then do pages without internal links say something). */
export function siteIssues(pages: ResearchPage[], complete: boolean): Issue[] {
  const ok = pages.filter(isOk);
  const titleCounts = new Map<string, number>();
  for (const p of ok) if (p.title) titleCounts.set(p.title, (titleCounts.get(p.title) ?? 0) + 1);
  const issue = (key: string, label: string, description: string, list: ResearchPage[]): Issue => ({ key, label, description, pages: list });
  return [
    issue('errors', 'Errors', 'Pages that returned an error or could not be fetched.', pages.filter((p) => !isOk(p))),
    issue('noTitle', 'Missing title', 'Pages without a <title>.', ok.filter((p) => !p.title)),
    issue('longTitle', 'Title over 60 characters', 'Google usually cuts these off in the results.', ok.filter((p) => p.title.length > 60)),
    issue('duplicateTitle', 'Duplicate title', 'Pages that share their title with another page.', ok.filter((p) => p.title && (titleCounts.get(p.title) ?? 0) > 1)),
    issue('noDescription', 'Missing meta description', 'Google writes its own snippet for these.', ok.filter((p) => !p.metaDescription)),
    issue('longDescription', 'Meta description over 160 characters', 'Usually cut off in the results.', ok.filter((p) => p.metaDescription.length > 160)),
    issue('noH1', 'No H1', 'Pages without a main heading.', ok.filter((p) => h1Of(p).length === 0)),
    issue('multipleH1', 'More than one H1', 'Pages with several main headings.', ok.filter((p) => h1Of(p).length > 1)),
    issue('thin', 'Thin content (under 300 words)', 'Little text in the main content.', ok.filter((p) => p.words < 300)),
    issue('noindex', 'Noindex', 'Pages that ask search engines not to index them.', ok.filter((p) => p.noindex)),
    issue(
      'canonicalElsewhere',
      'Canonical to another URL',
      'The page names another URL as the original.',
      ok.filter((p) => p.canonical && p.canonical.replace(/\/$/, '') !== p.url.replace(/\/$/, '')),
    ),
    issue('altMissing', 'Images without alt', 'Pages with images that have no alt attribute.', ok.filter((p) => p.imagesWithoutAlt > 0)),
    ...(complete
      ? [issue('orphan', 'No internal links to it', 'Pages (from the sitemap) that no other page links to.', ok.filter((p) => p.inbound === 0 && depthOf(p.url) > 0))]
      : []),
  ];
}

// ---------------------------------------------------------------- keyword candidates

export interface KeywordCandidate {
  keyword: string;
  /** Where it was found: page titles, H1s or the content of several pages. */
  source: 'title' | 'h1' | 'content';
  /** Pages it was found on. */
  pages: number;
  /** An example page. */
  url: string;
  /** Internal links to the example page (important pages are linked more). */
  inbound: number;
}

/** Pages with less text (thank-you pages, forms) say little about the keywords the site targets. */
const MIN_CANDIDATE_WORDS = 200;

const MIN_WORDS = 2;
const MAX_WORDS = 6;

function phraseOf(value: string): string | undefined {
  const words = tokenize(value);
  if (words.length < MIN_WORDS || words.length > MAX_WORDS) return undefined;
  return words.join(' ');
}

/**
 * Keywords the site probably targets: the titles (without brand, split at separators) and H1s of its pages, and
 * phrases that several pages use often. The most likely first.
 */
export function keywordCandidates(pages: ResearchPage[], checked: ResearchKeyword[]): KeywordCandidate[] {
  const { suffix } = titleSuffix(pages);
  const done = new Set(checked.map((c) => c.keyword));
  const candidates = new Map<string, KeywordCandidate>();
  const add = (keyword: string | undefined, source: KeywordCandidate['source'], page: ResearchPage | undefined, weight = 1) => {
    if (!keyword || done.has(keyword)) return;
    const c = candidates.get(keyword);
    if (c) c.pages += weight;
    else candidates.set(keyword, { keyword, source, pages: weight, url: page?.url ?? '', inbound: page?.inbound ?? 0 });
  };
  const ok = pages.filter((p) => isOk(p) && !p.noindex && p.words >= MIN_CANDIDATE_WORDS);
  for (const page of ok) {
    for (const part of bareTitle(page.title, suffix).split(TITLE_SEPARATORS)) add(phraseOf(part), 'title', page);
    const [h1] = h1Of(page);
    if (h1) add(phraseOf(h1), 'h1', page);
  }
  for (const s of siteTerms(ok, 'phrases')) {
    if (s.pages >= 2) add(s.term, 'content', ok.find((p) => p.phrases.some(([t]) => t === s.term)), s.pages);
  }
  const rank = { title: 0, h1: 1, content: 2 };
  return [...candidates.values()]
    .sort((a, b) => rank[a.source] - rank[b.source] || b.pages - a.pages || b.inbound - a.inbound)
    .slice(0, 300);
}

// ---------------------------------------------------------------- content table: type, language, keywords per page

export type PageType = 'Product' | 'Blog' | 'Release' | 'Legal' | 'Other';

export const PAGE_TYPES: PageType[] = ['Product', 'Blog', 'Release', 'Legal', 'Other'];

/** Release notes: a version number like "1.13.2" (or "version 2.1") in the title. */
const RELEASE_TITLE = /\b\d+\.\d+\.\d+\b|\b(version|release|versie)\s+v?\d+(\.\d+)+\b/i;
const LEGAL_PATH = /impressum|privacy|datenschutz|legal|barrierefreiheit|accessibility|cookie|terms|agb|disclaimer|voorwaarden|nutzungsbedingungen/i;
const PRODUCT_PATH = /product|betriebsmodelle|operating-models|demo|faq|partner|pricing|preise|prijzen|features|funktionen|solutions|loesungen|oplossingen/i;
const BLOG_PATH = /blog|news|nieuws|aktuelles|artikel|article|insights|magazin|stories|posts/i;
const ARTICLE_TYPES = new Set(['Article', 'BlogPosting', 'NewsArticle', 'TechArticle']);

/** The kind of page, from its title (release), URL and structured data. */
export function pageType(page: ResearchPage): PageType {
  const path = pathOf(page.url).toLowerCase();
  // A page in a /blog/ folder is always a blog post, also when its title sounds like a product.
  if (/(^|\/)blog(\/|$)/.test(path)) return 'Blog';
  if (RELEASE_TITLE.test(page.title) || /release-?notes|changelog/.test(path)) return 'Release';
  if (LEGAL_PATH.test(path)) return 'Legal';
  if (PRODUCT_PATH.test(path)) return 'Product';
  if (BLOG_PATH.test(path) || page.schemaTypes.some((t) => ARTICLE_TYPES.has(t))) return 'Blog';
  return 'Other';
}

/** The language of a page: a language folder in the URL (/de/, /en-gb/), else the lang attribute of <html>. */
export function pageLanguage(page: ResearchPage): string {
  const first = pathOf(page.url).split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(first)) return first.slice(0, 2);
  return page.lang.toLowerCase().slice(0, 2);
}

/** Words that are the brand of the site: its domain name and the words of the brand suffix of the titles. */
export function brandWords(pages: ResearchPage[], domain: string): Set<string> {
  const words = new Set(tokenize(domain.split('.').slice(0, -1).join(' ')));
  for (const w of tokenize(titleSuffix(pages).suffix)) words.add(w);
  return words;
}

/** Meta descriptions and H1s that 3 or more pages share: the defaults of the site, which say nothing about a page. */
export function sharedTexts(pages: ResearchPage[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const t of new Set([p.metaDescription, h1Of(p)[0] ?? ''].filter(Boolean))) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= 3).map(([t]) => t));
}

/** Punctuation that ends a phrase: a keyword never spans "Notfallarbeitsplatz: Sozialversicherer". */
const PHRASE_BREAK = /[|:;,.!?()[\]{}"“”„«»…/]+|\s[-–—·•]\s/;

/**
 * 1 to 3 suggested keywords of a page: word combinations of 2 to 4 words from the title (without brand suffix), the H1
 * and the meta description (not when other pages share them, `shared`), without stopwords, brand words and numbers.
 * A phrase from more of them (the title counts most) comes first, then the shorter one; a phrase that overlaps one
 * that was chosen is left out.
 */
export function pageKeywords(page: ResearchPage, suffix: string, brand: Set<string>, shared: Set<string>): string[] {
  const h1 = h1Of(page)[0] ?? '';
  const sources: [string, number][] = [
    [bareTitle(page.title, suffix), 3],
    [shared.has(h1) ? '' : h1, 2],
    [shared.has(page.metaDescription) ? '' : page.metaDescription, 1],
  ];
  const scores = new Map<string, { score: number; sources: number }>();
  for (const [textValue, weight] of sources) {
    const seen = new Set<string>();
    // Runs of words without stopwords, brand words, numbers and punctuation: a phrase never spans one of those.
    const runs: string[][] = [];
    for (const segment of textValue.split(PHRASE_BREAK)) {
      runs.push([]);
      for (const word of tokenize(segment)) {
        if (word.length < 2 || STOPWORDS.has(word) || brand.has(word) || /\d/.test(word)) runs.push([]);
        else runs[runs.length - 1]?.push(word);
      }
    }
    for (const run of runs) {
      for (let size = 2; size <= 4; size++) {
        for (let i = 0; i + size <= run.length; i++) {
          const phrase = run.slice(i, i + size).join(' ');
          if (seen.has(phrase)) continue;
          seen.add(phrase);
          const s = scores.get(phrase) ?? { score: 0, sources: 0 };
          scores.set(phrase, { score: s.score + weight, sources: s.sources + 1 });
        }
      }
    }
  }
  const words = (phrase: string) => phrase.split(' ').length;
  const ranked = [...scores].sort(
    (a, b) => b[1].score - a[1].score || b[1].sources - a[1].sources || words(a[0]) - words(b[0]) || a[0].localeCompare(b[0]),
  );
  const chosen: string[] = [];
  for (const [phrase] of ranked) {
    if (chosen.length === 3) break;
    if (chosen.some((c) => c.includes(phrase) || phrase.includes(c))) continue;
    chosen.push(phrase);
  }
  return chosen;
}
