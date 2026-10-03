#!/usr/bin/env node
// scripts/gmail-auth.mjs — Gmail OAuth2 flow
// Runs a tiny local server, opens browser for consent, exchanges code for tokens.
// Saves GMAIL_ACCESS_TOKEN and GMAIL_REFRESH_TOKEN to .env via setEnv (DR-8).
// S6: tokens never printed to stdout.
//
// Prerequisites:
//   1. Create a Google Cloud project at console.cloud.google.com
//   2. Enable the Gmail API
//   3. Create OAuth2 credentials (Desktop app or Web app)
//      - For web app: add http://localhost:3847/callback as redirect URI
//   4. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to .env
//
// Usage:
//   node scripts/gmail-auth.mjs          # first-time auth (opens browser)
//   node scripts/gmail-auth.mjs refresh  # refresh an expired access token

import { createServer } from 'node:http';
import { URL } from 'node:url';
import { loadEnv, getEnv, setEnv } from '../lib/env.js';

loadEnv();

const CLIENT_ID = getEnv('GMAIL_CLIENT_ID');
const CLIENT_SECRET = getEnv('GMAIL_CLIENT_SECRET');
const REDIRECT_URI = 'http://localhost:3847/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env');
  console.error('See the header comment in this file for setup steps.');
  process.exit(1);
}

// --- Refresh mode ---
if (process.argv[2] === 'refresh') {
  const refreshToken = getEnv('GMAIL_REFRESH_TOKEN');
  if (!refreshToken) {
    console.error('No GMAIL_REFRESH_TOKEN in .env. Run without "refresh" first.');
    process.exit(1);
  }
  const tokens = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  setEnv('GMAIL_ACCESS_TOKEN', tokens.access_token);
  console.log('Access token refreshed and saved to .env');
  process.exit(0);
}

// --- Full auth flow ---
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl.toString());
console.log('\nWaiting for callback on port 3847...\n');

// Try to open browser automatically
try {
  const { spawn } = await import('node:child_process');
  const url = authUrl.toString();
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { shell: false });
  else if (process.platform === 'darwin') spawn('open', [url]);
  else spawn('xdg-open', [url]);
} catch { /* user can open manually */ }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:3847`);

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h2>Auth failed</h2><p>${error}</p>`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h2>No code received</h2>');
    return;
  }

  try {
    const tokens = await exchangeToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    });

    setEnv('GMAIL_ACCESS_TOKEN', tokens.access_token);
    if (tokens.refresh_token) {
      setEnv('GMAIL_REFRESH_TOKEN', tokens.refresh_token);
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Gmail authorized.</h2><p>You can close this tab. Tokens saved to .env.</p>');
    console.log('Tokens saved to .env. You can close this terminal.');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>Token exchange failed</h2><pre>${err.message}</pre>`);
  }

  server.close();
  process.exit(0);
});

server.listen(3847);

// --- Helpers ---
async function exchangeToken(params) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    ...params,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}
