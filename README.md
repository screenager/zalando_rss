# zalando_rss

Generate an RSS feed from a filtered Zalando search page (e.g. newest items first).

## Setup

```
npm install
```

## Run

```
npm run build
```

Generated feed is written to `public/zalando.xml` by default.

## Configuration

You can configure via `config.json` (default) or environment variables. Env vars override `config.json`.

`config.json` example:

```json
{
  "SEARCH_URL": "https://www.zalando.be/...",
  "FEED_TITLE": "Zalando Search Feed",
  "FEED_DESCRIPTION": "Newest items from Zalando filtered search",
  "FEED_LINK": "https://www.zalando.be/...",
  "OUTPUT": "public/zalando.xml",
  "MAX_ITEMS": 50,
  "USER_AGENT": "Mozilla/5.0 (compatible; zalando_rss/1.0)",
  "MIN_FETCH_INTERVAL_MIN": 30
}
```

Environment variables:

- `CONFIG_PATH` (default: `./config.json`)
- `SEARCH_URL` (required if not in config) — the Zalando search URL to scrape
- `FEED_TITLE` (default: `Zalando Search Feed`)
- `FEED_DESCRIPTION` (default: `Newest items from Zalando filtered search`)
- `FEED_LINK` (default: `SEARCH_URL`)
- `OUTPUT` (default: `public/zalando.xml`)
- `MAX_ITEMS` (default: `50`)
- `USER_AGENT` (default: `Mozilla/5.0 (compatible; zalando_rss/1.0)`)
- `MIN_FETCH_INTERVAL_MIN` (default: `30`)

## Notes

- The scraper tries structured JSON first (e.g. `__NEXT_DATA__`) and falls back to HTML parsing.
- Sites change markup often; if results are empty, update selectors in `scripts/build-rss.js`.
- Keep request rates low to be polite and compatible with site terms.

## Deployment (GitHub Pages)

The workflow `.github/workflows/pages.yml` builds and deploys `public/` to GitHub Pages on a daily schedule (06:00 UTC) and on manual trigger.

Once Pages is enabled for the repository, your feed URL will be:

```
https://<your-username>.github.io/<repo-name>/zalando.xml
```
