# SEO Rank Tracker

Windows desktop app (Electron + React + TypeScript) that tracks the Google positions of keywords for your own sites, using the Google Search Console API.

- Projects: one Search Console property each, optionally filtered by country and device.
- Keywords per project. Each sync fetches the daily average position, clicks and impressions (up to 16 months back on the first sync).
- Keyword table: latest position, 7-day average, change from the previous 7 days, best position, clicks/impressions over 28 days.
- Position chart per keyword (30 days to 16 months).
- Pages per keyword: one ranking page is in the Page column; with 2 or more, the ▸ in front of the keyword shows a row per page (▾ hides them) with its position, impressions and clicks over 7 and 28 days, best position first.
- Target page per keyword (◎ / ◉, stored as `targetPage`): the main columns and the chart then show the position of that page, "Best page" its position over 28 days, and the row turns orange when Google showed another page more often (cannibalization). "Best" is the best position of any page over 28 days.
- Positions based on fewer than 5 impressions are grey with "?", and give no alerts after a sync.

Search Console only reports queries your site was shown for. A keyword your site does not rank for has no data ("–").

## Starting

```
npm install
npm run dev      # development (restart after changes in src/main or src/preload)
npm run build    # type check + build
npm start        # start the built app
```

`npm run dist` builds the Windows installer `release\SEO-Rank-Tracker-Setup-<version>.exe` (electron-builder, NSIS; installs or updates `C:\Program Files\SEO Rank Tracker` after the Windows admin prompt, closes a running app and starts the new version, with a desktop and Start menu shortcut). First it says whether it updates an installed version (and which), reinstalls the same version or installs anew, and can be cancelled (`build/installer.nsh`; a silent install with `/S` asks nothing). It is not code-signed, so Windows SmartScreen warns on the first run ("More info" → "Run anyway"). Raise `version` in package.json for a new release.

Data is stored in `%APPDATA%\seo-rank-tracker` (`data.json` and `history\*.json`). The Google refresh token is encrypted with Windows DPAPI (Electron safeStorage).

## Google setup (once)

1. Go to https://console.cloud.google.com/ and create a project (or pick one).
2. **APIs & Services → Library**: enable **Google Search Console API**.
3. **APIs & Services → OAuth consent screen**: user type *External* (or *Internal* in a Workspace organisation). Add the scope `.../auth/webmasters.readonly`, and add your own Google account as a test user.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: application type **Desktop app**.
5. Copy the client ID and secret into the app under **Settings**, save, and click **Sign in with Google**.

While the consent screen is in *Testing* mode, Google expires the sign-in after 7 days. Publish the app on the consent screen to avoid that.

## Competition (Serper.dev)

The Competition tab checks the Google top 20 of every tracked keyword through https://serper.dev (pages 1–2, a third page when needed), weekly (while the app runs) and with "Sync now" (which syncs Search Console and checks the competition together). Every check is stored with its date (`serp\<project id>.json`). The Google country (`gl`, sent with its `location`) is set per project; so is the language (`hl`), which a keyword can override on the tab.

Set the API key under Settings, or put `SERPER_API_KEY=...` in a `.env` file in the project folder. Own domains (never competitors, a position column each) and ignored domains (left out of competitors, share of voice and gaps) are set per project (Edit). Apps on marketplace.microsoft.com / appsource.microsoft.com count as competitors of their own, named after the product.

## Site research

"Research a site" (sidebar) analyses any other site, e.g. a competitor. The app reads robots.txt and the sitemaps (else it follows the links from the home page), and fetches up to the chosen number of pages (25–1000), four at a time, respecting the Disallow rules of robots.txt. When the sitemap has more pages than the limit, it takes a sample of every section in proportion to its size. Per page it stores the analysis, not the HTML (`research\<site id>.json`):

- Overview: links to other sites, and publishing (pages per year, latest published).
- Content: every page with its type (Product, Blog, Release: a version number like 1.13.2 in the title, Legal, Other; from the URL, title and structured data), language (from the URL, else `<html lang>`), title, H1, words, date and 1-3 suggested keywords (word combinations of 2-4 words from the title, H1 and meta description, without stopwords (NL/DE/EN), the brand, numbers and texts that 3 or more pages share). Filters for type (Release and Legal are hidden at first), language and text; Copy all and a CSV export (semicolons, UTF-8). A click on a row shows the detail of the page (heading outline, words, links).
- Keywords: the suggested keywords of the Content pages (no Release or Legal pages), without duplicates, plus your own and minus the ones you removed. "Check rankings" looks each up in Google through Serper (one search per keyword, top 100, at most 200 per check) with the country and language of the research, and stores the position of the site with its ranking page and the top 10 (the top 3 domains are shown), with the date. The next check shows the change.

The structure, topics and SEO issues of the crawl are still stored (`research\<site id>.json`), for later use.

"Copy all" copies the whole research as Markdown.

## Layout

The theme (System, Light, Dark or Streo: dark grey with orange, with a very dark orange title bar) is chosen at the top right and remembered. The window title bar is drawn by the app in the colors of the theme.

Every column of a table can be sorted (click the header) and resized: drag the edge between two headers. The right-hand panel (chart and notes, page detail) and the sidebar can be resized by dragging their edge. The widths are remembered; a double click on an edge restores the automatic width.

## Structure

- `src/main`: Electron main process: window, local storage (`store.ts`), Google sign-in and Search Console sync (`google.ts`).
- `src/preload`: exposes the API to the UI as `window.rankTracker`.
- `src/shared`: types shared by both sides.
- `src/renderer`: the React UI.
