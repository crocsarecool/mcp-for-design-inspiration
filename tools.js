/** Shared tool definitions — imported by both index.js and test.js */
module.exports = [
  {
    name: 'search_apps',
    description:
      'Search Mobbin for apps by name or keyword. Returns a list of apps with their slugs and thumbnails. Use this to discover what apps are available.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'App name or keyword (e.g. "spotify", "onboarding", "fintech")' },
        platform: { type: 'string', enum: ['ios', 'android', 'web'], default: 'ios', description: 'Platform to search' },
        limit: { type: 'number', default: 20, description: 'Max number of results (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_app_screens',
    description:
      'Get the screens for a specific Mobbin app. Pass the app_path returned by search_apps (e.g. "/apps/spotify-ios-UUID/UUID/screens"). Returns screen links you can pass to screenshot_url.',
    inputSchema: {
      type: 'object',
      properties: {
        app_path: { type: 'string', description: 'The app_path from search_apps results (e.g. "/apps/spotify-ios-UUID/UUID/screens")' },
        platform: { type: 'string', enum: ['ios', 'android', 'web'], default: 'ios' },
        limit: { type: 'number', default: 30, description: 'Max number of screens to return' },
      },
      required: ['app_path'],
    },
  },
  {
    name: 'search_screens',
    description:
      'Search across all Mobbin screens by UI pattern, component, or keyword. Great for finding specific UI elements like "empty state", "tab bar", "bottom sheet", "paywall", etc.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'UI pattern or keyword (e.g. "empty state", "onboarding", "paywall", "bottom sheet")' },
        platform: { type: 'string', enum: ['ios', 'android', 'web'], default: 'ios' },
        limit: { type: 'number', default: 30, description: 'Max number of screens to return' },
      },
      required: ['query'],
    },
  },
  {
    name: 'screenshot_url',
    description:
      'Open a specific Mobbin screen URL and capture a screenshot. Use this to get a visual of a specific screen after finding its href from search_apps or get_app_screens.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full Mobbin URL to visit (e.g. from get_app_screens results)' },
      },
      required: ['url'],
    },
  },
];
