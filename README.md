# Mobbin MCP

Browse Mobbin design inspiration from Claude Code. Requires a paid Mobbin account.

## Setup

### 1. Log in once

```bash
node login.js
```

A browser window opens. Sign into Mobbin, then press Enter in the terminal. Your session cookies are saved to `mobbin-cookies.json` (gitignored).

### 2. Add to Claude Code

Add this to your Claude Code MCP config (`~/.claude/settings.json` or `~/.claude.json`):

```json
{
  "mcpServers": {
    "mobbin": {
      "command": "node",
      "args": ["/Users/raunaqvaisoha/code/.claude/worktrees/modest-tereshkova/mobbin-mcp/index.js"]
    }
  }
}
```

Then restart Claude Code.

### 3. Use it

Just ask Claude naturally:

- *"Find onboarding screens from fintech apps on Mobbin"*
- *"Show me empty state designs from top iOS apps"*
- *"What does the Duolingo onboarding flow look like?"*
- *"Find paywall screens across productivity apps"*

## Tools

| Tool | Description |
|------|-------------|
| `search_apps` | Find apps by name or keyword |
| `get_app_screens` | Browse all screens for a specific app, optionally filtered by category |
| `search_screens` | Search screens by UI pattern (e.g. "bottom sheet", "empty state") |
| `screenshot_url` | Open a Mobbin screen URL and get a visual screenshot |

## Re-authenticating

If Mobbin logs you out, just run `node login.js` again to refresh your session.

## Notes

- Cookies are saved locally and never leave your machine
- The browser runs headless in the background while the MCP server is active
- `mobbin-cookies.json` is gitignored — keep it out of version control
