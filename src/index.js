#!/usr/bin/env node

import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadProjectBuilder } from './project.js';
import { loadQueue, writeQueue } from './queue.js';
import { color, downloadFile, loadEnv, sleep, writeJson } from './util.js';
import { outputUrl, ZvidAPIError, ZvidClient } from '@zvid/sdk';

const EXIT_OK = 0;
const EXIT_FATAL = 1;

async function main() {
  loadEnv();

  const { values: options } = parseArgs({
    options: {
      data: { type: 'string', default: 'data/quotes.csv' },
      config: { type: 'string', default: 'config.json' },
      workflow: {
        type: 'string',
        default: 'n8n/zvid-daily-quote-reels.workflow.json',
      },
      out: { type: 'string', default: 'out' },
      date: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'no-download': { type: 'boolean', default: false },
      'poll-interval': { type: 'string' },
      timeout: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (options.help) {
    printHelp();
    return EXIT_OK;
  }

  const config = readJson(options.config);
  const { records, pending } = loadQueue(options.data);
  if (!pending) {
    console.log('Nothing to render: every quote row already has a Status value.');
    return EXIT_OK;
  }

  const date = options.date ? new Date(`${options.date}T12:00:00Z`) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --date value: ${options.date}. Use YYYY-MM-DD.`);
  }

  const buildProject = loadProjectBuilder(options.workflow);
  const built = buildProject(config, {
    quote: pending.record.Quote,
    author: pending.record.Author,
    authorNote: pending.record.AuthorNote,
    date,
  });
  built.meta.rowNumber = pending.sheetRow;

  mkdirSync(options.out, { recursive: true });
  writeJson(path.join(options.out, 'project.json'), built.payload);

  console.log(
    `${color.bold('Daily quote video')} — Sheet row ${pending.sheetRow}: ` +
      `“${built.meta.quote}” — ${built.meta.author}`
  );
  console.log(
    `  ${built.meta.totalSeconds}s · ${built.meta.poolLabel} · ` +
      `${built.meta.quoteSize}px quote type`
  );

  const client = new ZvidClient({
    apiKey: process.env.ZVID_API_KEY,
    baseUrl: process.env.ZVID_API_URL || undefined,
  });

  const validation = await client.authoring.validate({ payload: built.payload });
  if (!validation.valid) {
    const details = validation.errors
      ?.map((detail) => `${detail.field}: ${detail.message}`)
      .join('; ');
    throw new Error(`Project validation failed: ${details || validation.message || 'invalid project'}`);
  }
  console.log(
    color.green(
      `✓ Valid project — ${validation.creditsRequired} credits required` +
        (validation.warnings?.length ? `, ${validation.warnings.length} warning(s)` : '')
    )
  );

  if (options['dry-run']) {
    let draftId = null;
    let editorLink = null;
    try {
      const saved = await client.projects.create(
        built.payload.name || 'daily-quote-video',
        built.payload
      );
      draftId = saved?.id || null;
      if (draftId) editorLink = `https://editor.zvid.io?project=${draftId}`;
    } catch (error) {
      console.warn(color.yellow(`⚠ Draft save skipped: ${error.message}`));
    }

    const result = {
      dryRun: true,
      sheetRow: pending.sheetRow,
      quote: built.meta.quote,
      author: built.meta.author,
      background: built.meta.poolLabel,
      videoSeconds: built.meta.totalSeconds,
      creditsRequired: validation.creditsRequired,
      warnings: validation.warnings || [],
      draftId,
      editorLink,
      sheetUpdated: false,
    };
    writeJson(path.join(options.out, 'result.json'), result);
    writeQueue(path.join(options.out, 'quotes.csv'), records);
    console.log(
      editorLink
        ? `Dry run complete. Preview: ${color.cyan(editorLink)}`
        : 'Dry run complete. The Sheet row remains pending.'
    );
    return EXIT_OK;
  }

  const submitted = await client.renders.create({ payload: built.payload });
  const jobId = submitted.jobId;
  if (!jobId) throw new Error('The render API did not return a jobId');
  console.log(`  Render queued: ${color.cyan(jobId)}`);

  const pollSeconds = Math.max(
    2,
    Number(options['poll-interval'] || config.pollSeconds || 10)
  );
  const timeoutMinutes = Math.max(
    1,
    Number(options.timeout || config.timeoutMinutes || 20)
  );
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let job;

  for (;;) {
    job = await client.jobs.get(jobId);
    if (job.state === 'completed') break;
    if (job.state === 'failed') {
      throw new Error(`Render failed: ${job.failedReason || 'no reason given'}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Render ${jobId} did not finish within ${timeoutMinutes} minutes`);
    }
    console.log(color.dim(`  ${job.state || 'rendering'}…`));
    await sleep(pollSeconds * 1000);
  }

  const videoUrl = outputUrl(job) || null;
  if (!videoUrl) throw new Error(`Completed render ${jobId} has no video URL`);

  const videoFile = path.join(options.out, `${built.payload.name}.mp4`);
  if (!options['no-download']) {
    await downloadFile(videoUrl, videoFile);
    console.log(`  Downloaded ${videoFile}`);
  }

  pending.record.Status = config.statusDoneValue || 'done';
  pending.record.VideoUrl = videoUrl;
  writeQueue(path.join(options.out, 'quotes.csv'), records);

  const result = {
    rendered: true,
    jobId,
    videoUrl,
    localFile: options['no-download'] ? null : videoFile,
    sheetRow: pending.sheetRow,
    sheetStatus: pending.record.Status,
    author: built.meta.author,
    background: built.meta.poolLabel,
    videoSeconds: built.meta.totalSeconds,
    creditsCharged: validation.creditsRequired,
  };
  writeJson(path.join(options.out, 'result.json'), result);

  console.log(
    color.green(
      `Done. Row ${pending.sheetRow} marked ${pending.record.Status}; ` +
        `video URL written to ${path.join(options.out, 'quotes.csv')}.`
    )
  );
  return EXIT_OK;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

function printHelp() {
  console.log(`Daily motivational quote video automation

Usage:
  npm run dry-run                 free validation + editor draft
  npm start                       render the first pending quote
  npm run sample                  deterministic 2026-07-28 sample render
  node src/index.js [options]

Options:
  --data <file>                   queue CSV (default data/quotes.csv)
  --config <file>                 visual configuration (default config.json)
  --workflow <file>               canonical n8n workflow JSON
  --out <dir>                     output directory (default out)
  --date <YYYY-MM-DD>             deterministic rotation date
  --dry-run                       validate + save a draft; spend no credits
  --no-download                   keep only the CDN URL and result files
  --poll-interval <seconds>       job polling interval
  --timeout <minutes>             render timeout

Environment:
  ZVID_API_KEY                    required; create at https://app.zvid.io/api-keys
  ZVID_API_URL                    optional; defaults to https://api.zvid.io`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(color.red(`✖ ${error.message}`));
    if (error instanceof ZvidAPIError && Array.isArray(error.body?.details)) {
      for (const detail of error.body.details) {
        console.error(color.red(`    ${detail.field}: ${detail.message}`));
      }
    }
    process.exitCode = EXIT_FATAL;
  });
