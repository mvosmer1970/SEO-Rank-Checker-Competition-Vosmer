# SEO Rank Tracker

Windows desktop app (Electron + React + TypeScript) that tracks the Google positions of keywords for your own sites, using the Google Search Console API.

- Projects: one Search Console property each, optionally filtered by country and device.
- Keywords per project. Each sync fetches the daily average position, clicks and impressions (up to 16 months back on the first sync).
- Keyword table: latest position, 7-day average, change from the previous 7 days, best position, clicks/impressions over 28 days.
- Position chart per keyword (30 days to 16 months).

Search Console only reports queries your site was shown for. A keyword your site does not rank for has no data ("–").

## Starting

```
npm install
npm run dev      # development (restart after changes in src/main or src/preload)
npm run build    # type check + build
npm start        # start the built app
```

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

## Structure

- `src/main`: Electron main process: window, local storage (`store.ts`), Google sign-in and Search Console sync (`google.ts`).
- `src/preload`: exposes the API to the UI as `window.rankTracker`.
- `src/shared`: types shared by both sides.
- `src/renderer`: the React UI.
