// mcp/vercel/server.js -- Vercel MCP server
// WHY: Gives Claude Code direct access to Vercel's deployment and config APIs.
// Standalone stdio server (like ghidra), not routed through the birbal proxy.
// VERCEL_MOCK=1 enables mock responses for contract tests.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const USE_MOCK = process.env.VERCEL_MOCK === '1';

if (!VERCEL_TOKEN) {
  process.stderr.write('[VERCEL MCP] Fatal: VERCEL_TOKEN not set\n');
  process.exit(1);
}

// -- Mock data for testing --------------------------------------------------

const MOCK_DEPLOYMENTS = {
  deployments: [
    { uid: 'dpl_mock1', name: 'my-site', state: 'READY', url: 'my-site-abc.vercel.app', created: 1696000000000 },
    { uid: 'dpl_mock2', name: 'my-site', state: 'BUILDING', url: 'my-site-def.vercel.app', created: 1696100000000 },
  ],
};

const MOCK_DEPLOYMENT_DETAIL = {
  id: 'dpl_mock123',
  name: 'my-site',
  state: 'READY',
  url: 'my-site-abc.vercel.app',
  created: 1696000000000,
  buildingAt: 1695999000000,
  ready: 1696000000000,
};

const MOCK_ENV_VARS = {
  envs: [
    { id: 'env_1', key: 'NODE_ENV', value: 'production', target: ['production'] },
    { id: 'env_2', key: 'API_URL', value: 'https://api.example.com', target: ['production', 'preview'] },
  ],
};

// -- HTTP layer --------------------------------------------------------------

async function vercelApi(method, path, body) {
  const url = `https://api.vercel.com${path}`;

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(url, opts);

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Vercel API ${resp.status}: ${text.slice(0, 200)}`);
  }

  if (resp.status === 204) return null;
  return resp.json();
}

// -- Tool handlers -----------------------------------------------------------

async function listDeployments({ project, limit }) {
  if (USE_MOCK) return MOCK_DEPLOYMENTS;

  const params = new URLSearchParams();
  if (project) params.set('projectId', project);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();

  const data = await vercelApi('GET', `/v6/deployments${qs ? '?' + qs : ''}`);
  return {
    deployments: (data.deployments || []).map(d => ({
      uid: d.uid,
      name: d.name,
      state: d.state || d.readyState,
      url: d.url,
      created: d.created,
    })),
  };
}

async function getDeployment({ deployment_id }) {
  if (USE_MOCK) return MOCK_DEPLOYMENT_DETAIL;

  const data = await vercelApi('GET', `/v13/deployments/${deployment_id}`);
  return {
    id: data.id,
    name: data.name,
    state: data.readyState || data.state,
    url: data.url,
    created: data.created,
    buildingAt: data.buildingAt,
    ready: data.ready,
    error: data.errorMessage || null,
  };
}

async function listEnvVars({ project_id }) {
  if (USE_MOCK) return MOCK_ENV_VARS;

  const data = await vercelApi('GET', `/v9/projects/${project_id}/env`);
  return {
    envs: (data.envs || []).map(e => ({
      id: e.id,
      key: e.key,
      target: e.target,
      type: e.type,
      // S6: never expose env var values in output
    })),
  };
}

async function setEnvVar({ project_id, key, value, target }) {
  if (USE_MOCK) return { created: true, key, target };

  await vercelApi('POST', `/v10/projects/${project_id}/env`, {
    key,
    value,
    target,
    type: 'encrypted',
  });

  return { created: true, key, target };
}

// -- Tool definitions --------------------------------------------------------

const TOOLS = [
  {
    name: 'vercel_list_deployments',
    description: 'List recent Vercel deployments. Optionally filter by project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID or name to filter by' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
    handler: listDeployments,
  },
  {
    name: 'vercel_get_deployment',
    description: 'Get details of a specific Vercel deployment by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        deployment_id: { type: 'string', description: 'Deployment ID (e.g. dpl_xxx)' },
      },
      required: ['deployment_id'],
    },
    handler: getDeployment,
  },
  {
    name: 'vercel_list_env_vars',
    description: 'List environment variables for a Vercel project. Values are not exposed (S6).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Vercel project ID' },
      },
      required: ['project_id'],
    },
    handler: listEnvVars,
  },
  {
    name: 'vercel_set_env_var',
    description: 'Create or update an encrypted environment variable on a Vercel project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Vercel project ID' },
        key: { type: 'string', description: 'Environment variable name' },
        value: { type: 'string', description: 'Environment variable value' },
        target: {
          type: 'array',
          items: { type: 'string', enum: ['production', 'preview', 'development'] },
          description: 'Deployment targets for this env var',
        },
      },
      required: ['project_id', 'key', 'value', 'target'],
    },
    handler: setEnvVar,
  },
];

// -- Server wiring -----------------------------------------------------------

const server = new Server(
  { name: 'vercel', version: '1.0.0' },
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
  process.stderr.write('[VERCEL MCP] Server started\n');
}).catch(err => {
  process.stderr.write(`[VERCEL MCP] Fatal: ${err.message}\n`);
  process.exit(1);
});
