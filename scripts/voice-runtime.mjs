#!/usr/bin/env node
// scripts/voice-runtime.mjs — Voice-to-Claude-Code runtime
// WHY: Talk to Birbal via mic. Audio -> Whisper -> text -> claude CLI.
//
// Usage:
//   node scripts/voice-runtime.mjs                              # push-to-talk, clipboard output
//   node scripts/voice-runtime.mjs --continuous                 # silence-detection mode
//   node scripts/voice-runtime.mjs --once                       # single recording, then exit
//   node scripts/voice-runtime.mjs --output clipboard           # copy transcription to clipboard (default)
//   node scripts/voice-runtime.mjs --output claude              # pipe to a new claude -p session
//   node scripts/voice-runtime.mjs --output stdout              # print transcription to terminal
//
// Prerequisites:
//   - ffmpeg installed (Windows: winget install ffmpeg; Mac: brew install ffmpeg)
//   - OPENAI_API_KEY in .env
//   - claude CLI on PATH

import { spawn, execSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Load .env
const envPath = join(REPO_ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const { values } = parseArgs({
  options: {
    continuous: { type: 'boolean', default: false },
    once:       { type: 'boolean', default: false },
    language:   { type: 'string', default: '' },
    output:     { type: 'string', default: 'clipboard' }, // clipboard | claude | stdout
  },
  strict: false,
});

// ------------------------------------------------------------------
// Preflight checks
// ------------------------------------------------------------------

function preflight() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[VOICE] OPENAI_API_KEY not set. Add it to .env');
    process.exit(1);
  }

  // Check ffmpeg
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    console.error('[VOICE] ffmpeg not found. Install it:');
    console.error('  Windows: winget install ffmpeg');
    console.error('  Mac:     brew install ffmpeg');
    console.error('  Linux:   apt install ffmpeg');
    process.exit(1);
  }

  // Check claude CLI
  try {
    execSync('claude --version', { stdio: 'pipe' });
  } catch {
    console.error('[VOICE] claude CLI not found on PATH.');
    process.exit(1);
  }
}

// ------------------------------------------------------------------
// Recording
// ------------------------------------------------------------------

const TMP_DIR = mkdtempSync(join(tmpdir(), 'birbal-voice-'));

/**
 * Detect the default audio input device on Windows via ffmpeg/dshow.
 * @returns {string} The device name for -i flag
 */
function detectMicDevice() {
  try {
    // ffmpeg -list_devices lists available dshow devices on stderr
    const result = execSync('ffmpeg -list_devices true -f dshow -i dummy 2>&1', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });
    // Look for audio device lines: [dshow] "Microphone (Some Device)" (audio)
    const lines = result.split('\n');
    for (const line of lines) {
      const match = line.match(/"([^"]+)"\s*\(audio\)/i);
      if (match) return `audio=${match[1]}`;
    }
    // Also try: [dshow]  "DeviceName"  followed by a line with (audio)
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i + 1] && lines[i + 1].includes('(audio)')) {
        const nameMatch = lines[i].match(/"([^"]+)"/);
        if (nameMatch) return `audio=${nameMatch[1]}`;
      }
    }
  } catch (err) {
    // ffmpeg -list_devices exits non-zero, output is in the error
    const output = err.stdout || err.stderr || err.message || '';
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/"([^"]+)"\s*\(audio\)/i);
      if (match) return `audio=${match[1]}`;
    }
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i + 1] && lines[i + 1].includes('(audio)')) {
        const nameMatch = lines[i].match(/"([^"]+)"/);
        if (nameMatch) return `audio=${nameMatch[1]}`;
      }
    }
  }
  // Fallback: generic name
  return 'audio=Microphone';
}

/**
 * Record audio from mic using ffmpeg.
 * Push-to-talk: starts recording, resolves when the process is killed.
 * Continuous: uses silencedetect filter to auto-stop after pause.
 *
 * @param {string} outPath - Path to write the .wav file
 * @param {object} opts
 * @param {boolean} opts.continuous - Use silence detection
 * @returns {{ proc: ChildProcess, done: Promise<void> }}
 */
function startRecording(outPath, opts = {}) {
  // ffmpeg on Windows uses DirectShow for mic input
  const args = [
    '-f', 'dshow',
    '-i', detectMicDevice(),
    '-ar', '16000',      // 16kHz sample rate (Whisper sweet spot)
    '-ac', '1',          // mono
    '-sample_fmt', 's16', // 16-bit
    '-y',                // overwrite output
  ];

  if (opts.continuous) {
    // Silence detection: stop recording after 1.5s of silence
    args.push('-af', 'silencedetect=noise=-30dB:d=1.5');
  }

  args.push(outPath);

  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const done = new Promise((resolve, reject) => {
    if (opts.continuous) {
      // Watch stderr for silence_end events, then stop
      let silenceTimer;
      proc.stderr.on('data', (data) => {
        const str = data.toString();
        if (str.includes('silence_end')) {
          // Give a moment for trailing audio, then stop
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => proc.kill('SIGTERM'), 500);
        }
      });
    }

    proc.on('close', (code) => {
      if (code === 0 || code === null || code === 255) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.on('error', reject);
  });

  return { proc, done };
}

// ------------------------------------------------------------------
// Transcription (uses lib/transcribe.js)
// ------------------------------------------------------------------

async function transcribeFile(filePath, language) {
  const { transcribe } = await import('../lib/transcribe.js');
  const audio = readFileSync(filePath);
  const opts = { format: 'wav' };
  if (language) opts.language = language;
  return transcribe(audio, opts);
}

// ------------------------------------------------------------------
// Output dispatch
// ------------------------------------------------------------------

const VALID_OUTPUTS = ['clipboard', 'claude', 'stdout'];

function validateOutput(output) {
  if (!VALID_OUTPUTS.includes(output)) {
    console.error(`[VOICE] Unknown --output "${output}". Pick one: ${VALID_OUTPUTS.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Copy text to system clipboard.
 * Windows: clip. Mac: pbcopy. Linux: xclip.
 */
function copyToClipboard(text) {
  const platform = process.platform;
  const cmd = platform === 'win32' ? 'clip'
    : platform === 'darwin' ? 'pbcopy'
    : 'xclip -selection clipboard';

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, { stdio: ['pipe', 'ignore', 'ignore'], shell: true });
    proc.on('close', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`clipboard command exited with code ${code}`));
    });
    proc.on('error', reject);
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

function sendToClaude(text) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', text], {
      stdio: ['pipe', 'inherit', 'inherit'],
      cwd: REPO_ROOT,
      shell: true,
    });

    proc.on('close', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`claude exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function deliverText(text, output) {
  switch (output) {
    case 'clipboard':
      await copyToClipboard(text);
      console.log('[VOICE] Copied to clipboard. Paste into your Claude session with Ctrl+V.');
      break;
    case 'claude':
      console.log('[VOICE] Sending to Claude Code...');
      await sendToClaude(text);
      break;
    case 'stdout':
      process.stdout.write(text + '\n');
      break;
  }
}

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------

async function runOnce(language) {
  const wavPath = join(TMP_DIR, `rec_${Date.now()}.wav`);

  if (values.continuous) {
    console.log('[VOICE] Listening... (speak, then pause to send)');
    const { done } = startRecording(wavPath, { continuous: true });
    await done;
  } else {
    console.log('[VOICE] Press ENTER to start recording...');
    await waitForEnter();
    const { proc, done } = startRecording(wavPath);
    const stopTimer = startTimer();
    await waitForEnter();
    stopTimer();
    proc.kill('SIGTERM');
    await done;
  }

  // Check file was created and has content
  if (!existsSync(wavPath)) {
    console.error('[VOICE] No audio recorded.');
    return null;
  }

  const stat = readFileSync(wavPath);
  if (stat.length < 1000) {
    console.log('[VOICE] Recording too short, skipping.');
    cleanup(wavPath);
    return null;
  }

  console.log('[VOICE] Transcribing...');
  try {
    const text = await transcribeFile(wavPath, language);
    console.log(`[VOICE] You said: "${text}"`);
    cleanup(wavPath);
    return text;
  } catch (err) {
    console.error(`[VOICE] Transcription failed: ${err.message}`);
    cleanup(wavPath);
    return null;
  }
}

function cleanup(filePath) {
  try { unlinkSync(filePath); } catch { /* already gone */ }
}

// Single readline for the whole session: avoids buffered newlines leaking
// between separate readline instances on Windows.
const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on('close', () => process.exit(0));

function waitForEnter() {
  // Drain any buffered lines before waiting for a fresh press
  return new Promise((resolve) => {
    const flush = () => {
      // Small delay lets any buffered \r\n from the previous press drain
      setTimeout(() => {
        rl.once('line', () => resolve());
      }, 100);
    };
    flush();
  });
}

/**
 * Show a live elapsed timer on the same line while recording.
 * Returns a stop function.
 */
function startTimer() {
  const start = Date.now();
  const interval = setInterval(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    process.stdout.write(`\r[VOICE] Recording... ${elapsed}s (press ENTER to stop)`);
  }, 200);
  return () => {
    clearInterval(interval);
    process.stdout.write('\n');
  };
}

// ------------------------------------------------------------------
// Entry
// ------------------------------------------------------------------

async function main() {
  preflight();
  validateOutput(values.output);

  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   Birbal Voice Runtime               ║');
  console.log('  ║   speak -> transcribe -> claude code  ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`[VOICE] Output: ${values.output}`);

  if (values.once) {
    const text = await runOnce(values.language);
    if (text) await deliverText(text, values.output);
    return;
  }

  // Loop mode
  console.log('[VOICE] Mode:', values.continuous ? 'continuous (silence detection)' : 'push-to-talk');
  console.log('[VOICE] Ctrl+C to quit');
  console.log('');

  while (true) {
    const text = await runOnce(values.language);
    if (text) {
      await deliverText(text, values.output);
      console.log('');
    }
  }
}

main().catch((err) => {
  console.error(`[VOICE] Fatal: ${err.message}`);
  process.exit(1);
});
