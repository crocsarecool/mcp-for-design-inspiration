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

// App hrefs look like: /apps/spotify-ios-UUID/UUID/screens
// Screen hrefs look like: /screens/UUID
const APP_HREF_RE = /^\/apps\/[a-z0-9][a-z0-9-]*-(?:ios|android|web)-[a-f0-9-]+\/[a-f0-9-]+\/screens/;
const SCREEN_HREF_RE = /^\/screens\/[a-f0-9-]{36}$/;

async function searchApps({ query, platform = 'ios', limit = 20 }) {
  const page = await newPage();
  try {
    // Mobbin search endpoint for apps
    const url = `${MOBBIN_BASE}/search/apps/${platform}?content_type=apps&sort=publishedAt&q=${encodeURIComponent(query)}`;
    await page.goto(url);
    await waitForContent(page);

    const apps = await page.evaluate(({ lim, reStr }) => {
      const re = new RegExp(reStr);
      const seen = new Set();
      const results = [];

      for (const a of document.querySelectorAll('a[href]')) {
        if (results.length >= lim) break;
        const href = a.getAttribute('href');
        if (!href || !re.test(href) || seen.has(href)) continue;
        seen.add(href);

        // Walk up to find the card container (li or article)
        const card = a.closest('li, article') || a;
        const img = card.querySelector('img');
        const nameEl = card.querySelector('h2, h3, p, span');
        const name = img?.getAttribute('alt') || nameEl?.textContent?.trim() || href.split('/')[2];

        results.push({
          name,
          // app_path is the full /apps/.../screens path — pass to get_app_screens
          app_path: href,
          url: 'https://mobbin.com' + href,
          thumbnail: img?.src || null,
        });
      }
      return results;
    }, { lim: limit, reStr: APP_HREF_RE.source });

    return {
      query,
      platform,
      total_found: apps.length,
      apps,
      hint: apps[0]
        ? `Use get_app_screens with app_path. E.g. get_app_screens({ app_path: "${apps[0].app_path}" })`
        : 'No apps found — try a different query',
    };
  } finally {
    await page.close();
  }
}

async function getAppScreens({ app_path, platform = 'ios', limit = 30 }) {
  const page = await newPage();
  try {
    // app_path is the full /apps/slug/uuid/screens path from search_apps
    const url = app_path.startsWith('http') ? app_path : `${MOBBIN_BASE}${app_path}`;
    await page.goto(url);
    await waitForContent(page);

    const result = await page.evaluate(({ lim, reStr }) => {
      const re = new RegExp(reStr);
      const appName =
        document.querySelector('h1')?.textContent?.trim() ||
        document.title.replace(' | Mobbin', '').trim();

      const screens = [];
      const seen = new Set();

      for (const a of document.querySelectorAll('a[href]')) {
        if (screens.length >= lim) break;
        const href = a.getAttribute('href');
        if (!href || !re.test(href) || seen.has(href)) continue;
        seen.add(href);

        const card = a.closest('li, article') || a;
        const img = card.querySelector('img');
        const label = img?.getAttribute('alt') || href.split('/').pop();

        screens.push({
          label,
          href: 'https://mobbin.com' + href,
          thumbnail: img?.src || null,
        });
      }

      return { appName, screens };
    }, { lim: limit, reStr: SCREEN_HREF_RE.source });

    return {
      app: result.appName,
      app_path,
      platform,
      screen_count: result.screens.length,
      screens: result.screens,
      hint: result.screens[0]
        ? `Use screenshot_url to view a screen. E.g. screenshot_url({ url: "${result.screens[0].href}" })`
        : 'No screens found',
    };
  } finally {
    await page.close();
  }
}

async function searchScreens({ query, platform = 'ios', limit = 30 }) {
  const page = await newPage();
  try {
    const url = `${MOBBIN_BASE}/search/apps/${platform}?content_type=screens&sort=publishedAt&q=${encodeURIComponent(query)}`;
    await page.goto(url);
    await waitForContent(page);

    const screens = await page.evaluate(({ lim, reStr }) => {
      const re = new RegExp(reStr);
      const seen = new Set();
      const results = [];

      for (const a of document.querySelectorAll('a[href]')) {
        if (results.length >= lim) break;
        const href = a.getAttribute('href');
        if (!href || !re.test(href) || seen.has(href)) continue;
        seen.add(href);

        const card = a.closest('li, article') || a;
        const img = card.querySelector('img');
        // Try to find app name from a sibling/parent app link
        const appLink = card.querySelector('a[href*="/apps/"]');
        const appName = appLink?.textContent?.trim() || img?.getAttribute('alt') || null;
        const label = img?.getAttribute('alt') || href.split('/').pop();

        results.push({
          label,
          app: appName,
          href: 'https://mobbin.com' + href,
          thumbnail: img?.src || null,
        });
      }
      return results;
    }, { lim: limit, reStr: SCREEN_HREF_RE.source });

    return {
      query,
      platform,
      total_found: screens.length,
      screens,
      hint: screens[0]
        ? `Use screenshot_url to view a screen. E.g. screenshot_url({ url: "${screens[0].href}" })`
        : 'No screens found — try a different query',
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
