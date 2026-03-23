import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import RSS from "rss";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH =
  process.env.CONFIG_PATH || path.join(process.cwd(), "config.json");

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const config = await readConfig();

const SEARCH_URL = process.env.SEARCH_URL || config.SEARCH_URL;
if (!SEARCH_URL) {
  console.error("Missing SEARCH_URL (set env var or config.json).");
  process.exit(1);
}

const FEED_TITLE =
  process.env.FEED_TITLE || config.FEED_TITLE || "Zalando Search Feed";
const FEED_DESCRIPTION =
  process.env.FEED_DESCRIPTION ||
  config.FEED_DESCRIPTION ||
  "Newest items from Zalando filtered search";
const FEED_LINK =
  process.env.FEED_LINK || config.FEED_LINK || SEARCH_URL;
const OUTPUT =
  process.env.OUTPUT || config.OUTPUT || path.join("public", "zalando.xml");
const MAX_ITEMS = Number.parseInt(
  process.env.MAX_ITEMS || config.MAX_ITEMS || "50",
  10
);
const USER_AGENT =
  process.env.USER_AGENT ||
  config.USER_AGENT ||
  "Mozilla/5.0 (compatible; zalando_rss/1.0)";
const MIN_FETCH_INTERVAL_MIN = Number.parseInt(
  process.env.MIN_FETCH_INTERVAL_MIN || config.MIN_FETCH_INTERVAL_MIN || "30",
  10
);

const cacheDir = path.join(process.cwd(), ".cache");
const cacheHtmlPath = path.join(cacheDir, "last.html");
const cacheMetaPath = path.join(cacheDir, "meta.json");

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function normalizeUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function textClean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function fetchHtml(url) {
  const meta = (await readJson(cacheMetaPath)) || {};
  const now = Date.now();
  const minIntervalMs = MIN_FETCH_INTERVAL_MIN * 60 * 1000;

  if (meta.lastFetched && now - meta.lastFetched < minIntervalMs) {
    try {
      return await fs.readFile(cacheHtmlPath, "utf8");
    } catch {
      // continue to fetch
    }
  }

  const headers = {
    "user-agent": USER_AGENT,
    "accept-language": "nl,en;q=0.9"
  };
  if (meta.etag) headers["if-none-match"] = meta.etag;
  if (meta.lastModified) headers["if-modified-since"] = meta.lastModified;

  const res = await fetch(url, { headers });
  if (res.status === 304) {
    const cached = await fs.readFile(cacheHtmlPath, "utf8");
    return cached;
  }
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cacheHtmlPath, html);
  await writeJson(cacheMetaPath, {
    lastFetched: now,
    etag: etag || meta.etag || null,
    lastModified: lastModified || meta.lastModified || null,
    contentHash: hashContent(html)
  });

  return html;
}

function collectFromJson(root, baseUrl) {
  const results = [];
  const seen = new Set();

  function maybeAdd(obj) {
    const url = obj.url || obj.link || obj.productUrl || obj.shopUrl;
    const name = obj.name || obj.title || obj.displayName;
    const brand = obj.brand?.name || obj.brand || obj.brandName;
    const price = obj.price?.value || obj.price?.amount || obj.price;
    const currency = obj.price?.currency || obj.currency;
    const image = obj.image || obj.imageUrl || obj.media?.images?.[0]?.url;
    const activation = obj.activationDate || obj.activation_date || obj.firstAvailable;

    if (!url || !name) return;
    const fullUrl = normalizeUrl(baseUrl, url);
    if (seen.has(fullUrl)) return;

    seen.add(fullUrl);
    results.push({
      url: fullUrl,
      name: textClean(name),
      brand: textClean(brand),
      price: price != null ? String(price) : "",
      currency: currency ? String(currency) : "",
      image: image ? normalizeUrl(baseUrl, image) : "",
      activation: activation ? new Date(activation) : null
    });
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    maybeAdd(node);
    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(root);
  return results;
}

function collectFromHtml(html, baseUrl) {
  const $ = load(html);
  const results = [];
  const seen = new Set();

  const cards = [
    "[data-testid='product-card']",
    "article",
    "div[data-id]"
  ];

  for (const selector of cards) {
    $(selector).each((_, el) => {
      const card = $(el);
      const linkEl = card.find("a[href]").first();
      const href = linkEl.attr("href");
      if (!href) return;

      const url = normalizeUrl(baseUrl, href);
      if (seen.has(url)) return;

      const title = textClean(
        card.find("[data-testid='product-card-title']").first().text() ||
          card.find("h3,h2").first().text()
      );
      const brand = textClean(
        card.find("[data-testid='product-card-brand']").first().text() ||
          card.find("[data-testid='product-card-brand-name']").first().text()
      );
      const priceText = textClean(
        card.find("[data-testid='product-card-price']").first().text() ||
          card.find("[data-testid='price']").first().text()
      );
      const img = card.find("img").first().attr("src");

      if (!title && !brand) return;

      seen.add(url);
      results.push({
        url,
        name: title || "(untitled)",
        brand,
        price: priceText,
        currency: "",
        image: img ? normalizeUrl(baseUrl, img) : "",
        activation: null
      });
    });

    if (results.length > 0) break;
  }

  return results;
}

function toFeedItems(items) {
  return items.slice(0, MAX_ITEMS).map((item) => {
    const parts = [];
    if (item.brand) parts.push(`Brand: ${item.brand}`);
    if (item.price)
      parts.push(`Price: ${item.price}${item.currency ? ` ${item.currency}` : ""}`);
    const textDescription = parts.join(" · ");
    const imageHtml = item.image
      ? `<p><img src="${item.image}" alt="${item.name}"/></p>`
      : "";
    const description = `<p>${textDescription}</p>${imageHtml}`;

    return {
      title: item.brand ? `${item.brand} — ${item.name}` : item.name,
      description,
      url: item.url,
      guid: item.url,
      date: item.activation || new Date(),
      enclosure: item.image
        ? {
            url: item.image,
            type: "image/jpeg"
          }
        : undefined
    };
  });
}

async function main() {
  const html = await fetchHtml(SEARCH_URL);
  const $ = load(html);

  let items = [];
  const nextData = $("script#__NEXT_DATA__").first().text();
  if (nextData) {
    try {
      const json = JSON.parse(nextData);
      items = collectFromJson(json, SEARCH_URL);
    } catch {
      items = [];
    }
  }

  if (items.length === 0) {
    items = collectFromHtml(html, SEARCH_URL);
  }

  if (items.length === 0) {
    console.error("No items found. You may need to update selectors.");
  }

  const feed = new RSS({
    title: FEED_TITLE,
    description: FEED_DESCRIPTION,
    feed_url: FEED_LINK,
    site_url: FEED_LINK,
    language: "nl",
    ttl: MIN_FETCH_INTERVAL_MIN
  });

  for (const item of toFeedItems(items)) {
    feed.item(item);
  }

  const xml = feed.xml({ indent: true });
  const outputPath = path.isAbsolute(OUTPUT)
    ? OUTPUT
    : path.join(process.cwd(), OUTPUT);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, xml);

  console.log(`Wrote ${Math.min(items.length, MAX_ITEMS)} items to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
