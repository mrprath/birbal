// mcp/youtube/server.js -- YouTube MCP server
// WHY: Gives Claude the ability to read YouTube video content: transcripts,
// metadata, frame extraction, and transcript search. Birbal-native, no
// third-party MCP packages. Uses yt-dlp (subprocess) for download/subtitles
// and ffmpeg (subprocess) for frame extraction.
//
// YT_MOCK=1 enables mock responses for contract tests.
// stdout is sacred: JSON-RPC only. All diagnostics go to stderr.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const USE_MOCK = process.env.YT_MOCK === '1';

// Cache lives outside the repo: ~/.birbal/yt-cache/<video_id>/
const CACHE_ROOT = resolve(homedir(), '.birbal', 'yt-cache');

// -- Video ID extraction (pure) ----------------------------------------------

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function extractVideoId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  if (YT_ID_RE.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtube.com')) {
      return url.searchParams.get('v') || null;
    }
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return YT_ID_RE.test(id) ? id : null;
    }
  } catch { /* not a URL */ }

  return null;
}

// -- In-memory session cache --------------------------------------------------
// WHY: avoid re-reading state.json for every tool call in the same session.

const sessionCache = new Map();

function cacheDir(videoId) {
  return join(CACHE_ROOT, videoId);
}

function statePath(videoId) {
  return join(cacheDir(videoId), 'state.json');
}

async function readState(videoId) {
  if (sessionCache.has(videoId)) return sessionCache.get(videoId);
  try {
    const raw = await readFile(statePath(videoId), 'utf8');
    const state = JSON.parse(raw);
    sessionCache.set(videoId, state);
    return state;
  } catch {
    return null;
  }
}

async function writeState(videoId, state) {
  const dir = cacheDir(videoId);
  await mkdir(dir, { recursive: true });
  await writeFile(statePath(videoId), JSON.stringify(state, null, 2));
  sessionCache.set(videoId, state);
}

function requireCached(videoId) {
  if (sessionCache.has(videoId)) return sessionCache.get(videoId);
  return null;
}

// -- Subprocess helper --------------------------------------------------------

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout: options.timeout || 120_000,
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${err.message}\n${stderr || ''}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// -- yt-dlp wrappers ----------------------------------------------------------
// WHY: yt-dlp via `python -m yt_dlp` because the exe may not be on PATH.
// Each function does one thing. No shared state.

async function ytdlpMetadata(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const { stdout } = await run('python', [
    '-m', 'yt_dlp',
    '--dump-json',
    '--no-download',
    '--no-warnings',
    url,
  ]);
  return JSON.parse(stdout);
}

async function ytdlpSubtitles(videoId, dir) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  // Try auto-generated subs first (wider coverage), then manual
  await run('python', [
    '-m', 'yt_dlp',
    '--write-auto-subs',
    '--write-subs',
    '--sub-langs', 'en.*,en',
    '--sub-format', 'json3',
    '--skip-download',
    '--no-warnings',
    '-o', join(dir, 'subs'),
    url,
  ]);

  // Find the subtitle file yt-dlp wrote
  const files = await readdir(dir);
  const subFile = files.find(f => f.startsWith('subs') && f.endsWith('.json3'));
  if (!subFile) return null;

  const raw = await readFile(join(dir, subFile), 'utf8');
  return JSON.parse(raw);
}

async function ytdlpDownloadSegment(videoId, dir, startSec, endSec) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outPath = join(dir, `segment_${startSec}_${endSec}.mp4`);
  const section = `*${startSec}-${endSec}`;
  await run('python', [
    '-m', 'yt_dlp',
    '--download-sections', section,
    '-f', 'bv*[height<=720]',
    '--no-warnings',
    '-o', outPath,
    url,
  ], { timeout: 180_000 });
  return outPath;
}

// -- Subtitle parsing ---------------------------------------------------------
// WHY: yt-dlp json3 format has events[] with segs[]. We normalize to
// { text, start, end } segments.

function parseJson3Subs(json3) {
  const events = json3.events || [];
  const segments = [];

  for (const evt of events) {
    if (!evt.segs || !evt.segs.length) continue;
    const text = evt.segs.map(s => s.utf8 || '').join('').trim();
    if (!text) continue;

    const startMs = evt.tStartMs || 0;
    const durationMs = evt.dDurationMs || 0;

    segments.push({
      text,
      start: Math.round(startMs / 1000 * 100) / 100,
      end: Math.round((startMs + durationMs) / 1000 * 100) / 100,
    });
  }

  return segments;
}

// -- ffmpeg frame extraction --------------------------------------------------

async function extractFrames(videoPath, timestamps, outDir, quality) {
  const width = quality === 'high' ? 1280 : quality === 'medium' ? 854 : 480;
  const frames = [];

  for (const ts of timestamps) {
    const outFile = join(outDir, `frame_${ts}.jpg`);
    await run('ffmpeg', [
      '-ss', String(ts),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', `scale=${width}:-1`,
      '-q:v', '2',
      '-y',
      outFile,
    ]);
    frames.push({ timestamp: ts, path: outFile });
  }

  return frames;
}

// -- Mock data ----------------------------------------------------------------

const MOCK_META = {
  id: 'dQw4w9WgXcQ',
  title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
  channel: 'Rick Astley',
  uploader: 'Rick Astley',
  description: 'The official video for "Never Gonna Give You Up" by Rick Astley.',
  duration: 212,
  view_count: 1_500_000_000,
  upload_date: '20091025',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
};

const MOCK_SEGMENTS = [
  { text: 'Hello and welcome to this video.', start: 0, end: 3.2 },
  { text: 'Today we are going to talk about something interesting.', start: 3.2, end: 7.3 },
  { text: 'Let us dive right in.', start: 7.3, end: 9.8 },
  { text: 'First, let me give you some background.', start: 9.8, end: 12.8 },
  { text: 'This topic has been on my mind for a while now.', start: 12.8, end: 16.3 },
  { text: 'Let me show you the code on screen.', start: 16.3, end: 19.5 },
  { text: 'As you can see, the function takes two arguments.', start: 19.5, end: 23.0 },
  { text: 'And that wraps up our discussion for today.', start: 23.0, end: 26.5 },
];

const MOCK_FRAMES = [
  { timestamp: 5, path: '/mock/frames/frame_5.jpg' },
  { timestamp: 10, path: '/mock/frames/frame_10.jpg' },
];

// -- Tool handlers ------------------------------------------------------------

async function handleProcess({ url }) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`Could not extract video ID from: ${url}`);

  if (USE_MOCK) {
    const state = {
      video_id: videoId,
      title: MOCK_META.title,
      channel: MOCK_META.channel,
      description: MOCK_META.description,
      duration_seconds: MOCK_META.duration,
      views: MOCK_META.view_count,
      upload_date: MOCK_META.upload_date,
      thumbnail: MOCK_META.thumbnail,
      segments: MOCK_SEGMENTS,
      transcript: MOCK_SEGMENTS.map(s => s.text).join(' '),
    };
    sessionCache.set(videoId, state);
    return state;
  }

  // Cheap first: check cache
  const cached = await readState(videoId);
  if (cached && cached.transcript) return cached;

  // 1. Metadata
  const meta = await ytdlpMetadata(videoId);

  const state = {
    video_id: videoId,
    title: meta.title || 'Unknown',
    channel: meta.uploader || meta.channel || 'Unknown',
    description: (meta.description || '').slice(0, 2000),
    duration_seconds: meta.duration || 0,
    views: meta.view_count || 0,
    upload_date: meta.upload_date || '',
    thumbnail: meta.thumbnail || '',
    segments: [],
    transcript: '',
  };

  // 2. Subtitles (free path: no whisper needed)
  const dir = cacheDir(videoId);
  await mkdir(dir, { recursive: true });

  try {
    const json3 = await ytdlpSubtitles(videoId, dir);
    if (json3) {
      state.segments = parseJson3Subs(json3);
      state.transcript = state.segments.map(s => s.text).join(' ');
    }
  } catch (err) {
    process.stderr.write(`[YOUTUBE MCP] Subtitle fetch failed: ${err.message}\n`);
  }

  // If no subtitles, note it but don't block: metadata alone is still valuable
  if (!state.transcript) {
    state.transcript = '[No captions available for this video]';
  }

  await writeState(videoId, state);
  return state;
}

async function handleTranscript({ video_id, format }) {
  const videoId = video_id;
  const state = USE_MOCK ? requireCached(videoId) : await readState(videoId);
  if (!state) throw new Error(`Video not cached: ${videoId}. Run yt_process first.`);

  if (format === 'srt') {
    return { video_id: videoId, segments: state.segments };
  }

  return { video_id: videoId, text: state.transcript };
}

async function handleInfo({ url }) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`Could not extract video ID from: ${url}`);

  if (USE_MOCK) {
    return {
      video_id: videoId,
      title: MOCK_META.title,
      channel: MOCK_META.channel,
      description: MOCK_META.description,
      duration_seconds: MOCK_META.duration,
      views: MOCK_META.view_count,
      upload_date: MOCK_META.upload_date,
      thumbnail: MOCK_META.thumbnail,
    };
  }

  // Check cache first
  const cached = await readState(videoId);
  if (cached) {
    const { segments, transcript, ...info } = cached;
    return info;
  }

  // Metadata only: no download
  const meta = await ytdlpMetadata(videoId);
  return {
    video_id: videoId,
    title: meta.title || 'Unknown',
    channel: meta.uploader || meta.channel || 'Unknown',
    description: (meta.description || '').slice(0, 2000),
    duration_seconds: meta.duration || 0,
    views: meta.view_count || 0,
    upload_date: meta.upload_date || '',
    thumbnail: meta.thumbnail || '',
  };
}

async function handleFrames({ video_id, timestamps, quality }) {
  const videoId = video_id;
  const state = USE_MOCK ? requireCached(videoId) : await readState(videoId);
  if (!state) throw new Error(`Video not cached: ${videoId}. Run yt_process first.`);

  if (USE_MOCK) {
    return {
      video_id: videoId,
      frames: timestamps.map(ts => ({ timestamp: ts, path: `/mock/frames/${videoId}/frame_${ts}.jpg` })),
    };
  }

  const dir = cacheDir(videoId);
  const framesDir = join(dir, 'frames');
  await mkdir(framesDir, { recursive: true });

  // Download the segment spanning all requested timestamps
  const minTs = Math.max(0, Math.min(...timestamps) - 2);
  const maxTs = Math.max(...timestamps) + 2;
  const segmentPath = await ytdlpDownloadSegment(videoId, dir, minTs, maxTs);

  // Extract frames
  const q = quality || 'medium';
  const frames = await extractFrames(segmentPath, timestamps, framesDir, q);

  return { video_id: videoId, frames };
}

async function handleMoments({ video_id, query, top_k }) {
  const videoId = video_id;
  const state = USE_MOCK ? requireCached(videoId) : await readState(videoId);
  if (!state) throw new Error(`Video not cached: ${videoId}. Run yt_process first.`);

  const segments = state.segments || [];
  const queryLower = query.toLowerCase();
  const limit = top_k || 10;

  // Text search: score by keyword match density
  const scored = segments
    .map(seg => {
      const textLower = seg.text.toLowerCase();
      const words = queryLower.split(/\s+/);
      const hits = words.filter(w => textLower.includes(w)).length;
      return { ...seg, score: hits / words.length };
    })
    .filter(seg => seg.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    video_id: videoId,
    query,
    moments: scored.map(({ score, ...rest }) => rest),
  };
}

async function handleCached() {
  if (USE_MOCK) {
    const videos = [];
    for (const [videoId, state] of sessionCache.entries()) {
      videos.push({
        video_id: videoId,
        title: state.title,
        channel: state.channel,
        duration_seconds: state.duration_seconds,
      });
    }
    return { videos };
  }

  const videos = [];
  try {
    const dirs = await readdir(CACHE_ROOT);
    for (const dir of dirs) {
      try {
        const state = await readState(dir);
        if (state) {
          videos.push({
            video_id: state.video_id || dir,
            title: state.title || 'Unknown',
            channel: state.channel || 'Unknown',
            duration_seconds: state.duration_seconds || 0,
          });
        }
      } catch { /* skip broken entries */ }
    }
  } catch { /* cache dir doesn't exist yet */ }

  return { videos };
}

// -- Tool definitions ---------------------------------------------------------

const TOOLS = [
  {
    name: 'yt_process',
    description: 'Download and cache a YouTube video: fetches metadata and transcript (captions). This is the entry point: run it before using other yt_ tools. Accepts full URLs, youtu.be short URLs, or bare 11-char video IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube video URL or video ID' },
      },
      required: ['url'],
    },
    handler: handleProcess,
  },
  {
    name: 'yt_transcript',
    description: 'Get the transcript of a cached video. Returns plain text by default. Set format="srt" for timestamped segments. Run yt_process first.',
    inputSchema: {
      type: 'object',
      properties: {
        video_id: { type: 'string', description: '11-char YouTube video ID' },
        format: { type: 'string', enum: ['txt', 'srt'], description: 'Output format: txt (default) or srt (timestamped segments)' },
      },
      required: ['video_id'],
    },
    handler: handleTranscript,
  },
  {
    name: 'yt_frames',
    description: 'Extract video frames at specific timestamps. Returns file paths to JPEG images. Run yt_process first. Use these frames to see code on screen, read diagrams, or understand visual context.',
    inputSchema: {
      type: 'object',
      properties: {
        video_id: { type: 'string', description: '11-char YouTube video ID' },
        timestamps: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of timestamps in seconds to extract frames at',
        },
        quality: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Frame quality/resolution (default: medium)' },
      },
      required: ['video_id', 'timestamps'],
    },
    handler: handleFrames,
  },
  {
    name: 'yt_info',
    description: 'Get video metadata only (title, channel, description, duration, views). Fast: no download. Accepts full URLs, youtu.be short URLs, or bare 11-char video IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube video URL or video ID' },
      },
      required: ['url'],
    },
    handler: handleInfo,
  },
  {
    name: 'yt_moments',
    description: 'Search a cached video transcript for moments matching a text query. Returns timestamped segments ranked by relevance. Run yt_process first.',
    inputSchema: {
      type: 'object',
      properties: {
        video_id: { type: 'string', description: '11-char YouTube video ID' },
        query: { type: 'string', description: 'Search query' },
        top_k: { type: 'number', description: 'Max results to return (default: 10)' },
      },
      required: ['video_id', 'query'],
    },
    handler: handleMoments,
  },
  {
    name: 'yt_cached',
    description: 'List all cached videos with their metadata.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleCached,
  },
];

// -- Server wiring ------------------------------------------------------------

const server = new Server(
  { name: 'youtube', version: '1.0.0' },
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
  process.stderr.write('[YOUTUBE MCP] Server started\n');
}).catch(err => {
  process.stderr.write(`[YOUTUBE MCP] Fatal: ${err.message}\n`);
  process.exit(1);
});
