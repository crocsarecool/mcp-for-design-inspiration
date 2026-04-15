/**
 * Mobbin MCP Server
 * Lets Claude browse Mobbin design inspiration using your authenticated session.
 *
 * Setup:
 *   1. node login.js       — log in once to save session cookies
 *   2. Add this server to Claude Code (see README or below)
 *
 * Tools exposed:
 *   - search_apps       Search Mobbin apps by name/keyword
 *   - get_app_screens   Get screens for a specific app
 *   - search_screens    Search across all screens by UI pattern or keyword
 *   - screenshot_url    Fetch a screenshot of a specific Mobbin screen URL
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MCP_CJS = path.join(__dirname, 'node_modules/@modelcontextprotocol/sdk/dist/cjs');
const { Server } = require(path.join(MCP_CJS, 'server/index.js'));
const { StdioServerTransport } = require(path.join(MCP_CJS, 'server/stdio.js'));
const { CallToolRequestSchema, ListToolsRequestSchema } = require(path.join(MCP_CJS, 'types.js'));

const COOKIES_FILE = path.join(__dirname, 'mobbin-cookies.json');
const MOBBIN_BASE = 'https://mobbin.com';

// ─── Browser singleton ────────────────────────────────────────────────────────

let browser = null;
let context = null;

async function getBrowserContext() {
  if (context) return context;

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  if (fs.existsSync(COOKIES_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
    await context.addCookies(cookies);
  } else {
    throw new Error(
      'No session found. Run `node login.js` first to authenticate with Mobbin.'
    );
  }

  return context;
}

async function newPage() {
  const ctx = await getBrowserContext();
  return ctx.newPage();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wait for Mobbin's React content to settle */
async function waitForContent(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

/** Extract clean text, truncated to avoid bloating context */
function truncate(str, max = 300) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function searchApps({ query, platform = 'ios', limit = 20 }) {
  const page = await newPage();
  try {
    const url = `${MOBBIN_BASE}/discover/apps/${platform}/latest?q=${encodeURIComponent(query)}`;
    await page.goto(url);
    await waitForContent(page);

    // Grab app cards
    const apps = await page.evaluate((lim) => {
      const cards = Array.from(document.querySelectorAll('[data-testid="app-card"], a[href*="/apps/"]'));
      const seen = new Set();
      const results = [];

      for (const card of cards) {
        if (results.length >= lim) break;
        const href = card.getAttribute('href') || card.querySelector('a')?.getAttribute('href');
        if (!href || !href.includes('/apps/')) continue;
        const appSlug = href.split('/apps/')[1]?.split('/')[0];
        if (!appSlug || seen.has(appSlug)) continue;
        seen.add(appSlug);

        const name =
          card.querySelector('h2, h3, [class*="name"], [class*="title"]')?.textContent?.trim() ||
          card.getAttribute('aria-label') ||
          appSlug;
        const imgSrc = card.querySelector('img')?.getAttribute('src') || null;

        results.push({ name, slug: appSlug, href, thumbnail: imgSrc });
      }
      return results;
    }, limit);

    return {
      query,
      platform,
      total_found: apps.length,
      apps,
      hint: `Use get_app_screens with a slug to explore screens. E.g. get_app_screens({ app_slug: "${apps[0]?.slug}" })`,
    };
  } finally {
    await page.close();
  }
}

async function getAppScreens({ app_slug, platform = 'ios', category = null, limit = 30 }) {
  const page = await newPage();
  try {
    let url = `${MOBBIN_BASE}/apps/${app_slug}/${platform}/screens`;
    if (category) url += `?category=${encodeURIComponent(category)}`;
    await page.goto(url);
    await waitForContent(page);

    const result = await page.evaluate(({ lim }) => {
      // App metadata
      const appName =
        document.querySelector('h1')?.textContent?.trim() ||
        document.title.replace(' | Mobbin', '');

      // Category filter options
      const categoryLinks = Array.from(
        document.querySelectorAll('[href*="category="], [data-testid*="category"]')
      ).map((el) => ({
        name: el.textContent?.trim(),
        href: el.getAttribute('href'),
      })).filter((c) => c.name);

      // Screen cards
      const screenEls = Array.from(
        document.querySelectorAll(
          '[data-testid="screen-card"], a[href*="/screens/"], [class*="screen"]'
        )
      );

      const screens = [];
      const seen = new Set();

      for (const el of screenEls) {
        if (screens.length >= lim) break;
        const anchor = el.tagName === 'A' ? el : el.querySelector('a[href*="/screens/"]');
        const href = anchor?.getAttribute('href');
        if (!href || !href.includes('/screens/')) continue;
        if (seen.has(href)) continue;
        seen.add(href);

        const img = el.querySelector('img');
        const label =
          el.querySelector('[class*="title"], [class*="label"], [class*="name"]')?.textContent?.trim() ||
          img?.getAttribute('alt') ||
          href.split('/').pop();

        screens.push({
          label,
          href: 'https://mobbin.com' + href,
          thumbnail: img?.getAttribute('src') || null,
        });
      }

      return { appName, categoryLinks: categoryLinks.slice(0, 20), screens };
    }, { lim: limit });

    return {
      app: result.appName,
      app_slug,
      platform,
      screen_count: result.screens.length,
      available_categories: result.categoryLinks,
      screens: result.screens,
    };
  } finally {
    await page.close();
  }
}

async function searchScreens({ query, platform = 'ios', limit = 30 }) {
  const page = await newPage();
  try {
    const url = `${MOBBIN_BASE}/discover/screens/${platform}/latest?q=${encodeURIComponent(query)}`;
    await page.goto(url);
    await waitForContent(page);

    const screens = await page.evaluate((lim) => {
      const els = Array.from(
        document.querySelectorAll('a[href*="/screens/"]')
      );
      const seen = new Set();
      const results = [];

      for (const el of els) {
        if (results.length >= lim) break;
        const href = el.getAttribute('href');
        if (!href || seen.has(href)) continue;
        seen.add(href);

        const img = el.querySelector('img');
        const label =
          el.querySelector('[class*="title"], [class*="label"]')?.textContent?.trim() ||
          img?.getAttribute('alt') ||
          href.split('/').pop();
        const appName = el.querySelector('[class*="app"]')?.textContent?.trim() || null;

        results.push({
          label,
          app: appName,
          href: 'https://mobbin.com' + href,
          thumbnail: img?.getAttribute('src') || null,
        });
      }
      return results;
    }, limit);

    return {
      query,
      platform,
      total_found: screens.length,
      screens,
    };
  } finally {
    await page.close();
  }
}

async function screenshotUrl({ url }) {
  const page = await newPage();
  try {
    await page.goto(url);
    await waitForContent(page);

    // Try to find the main screen image
    const imageUrl = await page.evaluate(() => {
      const img =
        document.querySelector('[data-testid="screen-image"] img') ||
        document.querySelector('main img') ||
        document.querySelector('img[src*="cdn"]');
      return img?.src || null;
    });

    const title = await page.evaluate(() => document.title.replace(' | Mobbin', '').trim());
    const description = await page.evaluate(() => {
      return (
        document.querySelector('meta[name="description"]')?.getAttribute('content') || null
      );
    });

    // Take a page screenshot as base64 (cropped to viewport)
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
    const screenshotBase64 = screenshotBuffer.toString('base64');

    return {
      url,
      title,
      description: truncate(description),
      image_url: imageUrl,
      screenshot_base64: screenshotBase64,
      screenshot_mime: 'image/jpeg',
    };
  } finally {
    await page.close();
  }
}

// ─── Tool schema ──────────────────────────────────────────────────────────────

const TOOLS = require('./tools.js');

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'mobbin-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    switch (name) {
      case 'search_apps':
        result = await searchApps(args);
        break;
      case 'get_app_screens':
        result = await getAppScreens(args);
        break;
      case 'search_screens':
        result = await searchScreens(args);
        break;
      case 'screenshot_url':
        result = await screenshotUrl(args);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // For screenshot tool, return image content
    if (name === 'screenshot_url' && result.screenshot_base64) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: result.url,
              title: result.title,
              description: result.description,
              image_url: result.image_url,
            }, null, 2),
          },
          {
            type: 'image',
            data: result.screenshot_base64,
            mimeType: result.screenshot_mime,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Mobbin MCP server running\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
