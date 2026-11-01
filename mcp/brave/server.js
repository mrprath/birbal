// mcp/brave/server.js -- Brave Search MCP server
// WHY: Gives Claude Code direct access to Brave's web and news search APIs.
// Standalone stdio server (like ghidra), not routed through the birbal proxy.
// BRAVE_MOCK=1 enables mock responses for contract tests.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const USE_MOCK = process.env.BRAVE_MOCK === '1';

if (!BRAVE_API_KEY) {
  process.stderr.write('[BRAVE MCP] Fatal: BRAVE_API_KEY not set\n');
  process.exit(1);
}

// -- Mock data for testing --------------------------------------------------

const MOCK_WEB_RESULTS = {
  results: [
    { title: 'Mock Result 1', url: 'https://example.com/1', description: 'First mock result' },
    { title: 'Mock Result 2', url: 'https://example.com/2', description: 'Second mock result' },
  ],
};

const MOCK_NEWS_RESULTS = {
  results: [
    { title: 'Mock News 1', url: 'https://news.example.com/1', description: 'First mock news', age: '2h' },
    { title: 'Mock News 2', url: 'https://news.example.com/2', description: 'Second mock news', age: '4h' },
  ],
};

// -- HTTP layer --------------------------------------------------------------

async function braveGet(endpoint, params) {
  const url = new URL(`https://api.search.brave.com/res/v1/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const resp = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': BRAVE_API_KEY,
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Brave API ${resp.status}: ${body.slice(0, 200)}`);
  }

  return resp.json();
}

// -- Tool handlers -----------------------------------------------------------

async function webSearch({ query, count, offset, freshness }) {
  if (USE_MOCK) return MOCK_WEB_RESULTS;

  const data = await braveGet('web/search', { q: query, count, offset, freshness });
  const results = (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description || '',
    age: r.age || null,
    extra_snippets: r.extra_snippets || [],
  }));

  return { results, query, total: data.web?.totalEstimatedMatches || results.length };
}

async function newsSearch({ query, count, offset, freshness }) {
  if (USE_MOCK) return MOCK_NEWS_RESULTS;

  const data = await braveGet('news/search', { q: query, count, offset, freshness });
  const results = (data.results || []).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description || '',
    age: r.age || null,
    source: r.meta_url?.hostname || null,
  }));

  return { results, query };
}

// -- Tool definitions --------------------------------------------------------

const TOOLS = [
  {
    name: 'brave_web_search',
    description: 'Search the web using Brave Search. Returns titles, URLs, descriptions, and snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (max 20, default 10)' },
        offset: { type: 'number', description: 'Pagination offset' },
        freshness: { type: 'string', description: 'Time filter: pd (past day), pw (past week), pm (past month)' },
      },
      required: ['query'],
    },
    handler: webSearch,
  },
  {
    name: 'brave_news_search',
    description: 'Search news articles using Brave Search. Returns headlines, URLs, sources, and age.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'News search query' },
        count: { type: 'number', description: 'Number of results (max 20, default 10)' },
        offset: { type: 'number', description: 'Pagination offset' },
        freshness: { type: 'string', description: 'Time filter: pd (past day), pw (past week), pm (past month)' },
      },
      required: ['query'],
    },
    handler: newsSearch,
  },
];

// -- Server wiring -----------------------------------------------------------

const server = new Server(
  { name: 'brave-search', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }

  try {
    const result = await tool.handler(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  process.stderr.write('[BRAVE MCP] Server started\n');
}).catch(err => {
  process.stderr.write(`[BRAVE MCP] Fatal: ${err.message}\n`);
  process.exit(1);
});
