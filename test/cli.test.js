import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadQueue } from '../src/queue.js';
import { loadProjectBuilder } from '../src/project.js';

function run(t, scenario = 'completed', args = [], csv) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zvid-quote-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'requests.jsonl');
  const extra = [];
  if (csv) { const data = path.join(dir, 'input.csv'); writeFileSync(data, csv); extra.push('--data', data); }
  const result = spawnSync(process.execPath, ['--import', './test/helpers/mock-api.mjs', 'src/index.js', '--out', dir, '--date', '2026-10-14', ...extra, ...args], {
    encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, ZVID_API_KEY: 'test-only', ZVID_API_URL: 'https://api.example.test', QUOTE_TEST_SCENARIO: scenario, QUOTE_TEST_LOG: log, NO_COLOR: '1' },
  });
  assert.ifError(result.error);
  return { ...result, dir, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [], json: () => JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8')) };
}

test('dry run validates and saves a draft without submitting or completing the queue', t => {
  const r = run(t, 'completed', ['--dry-run']); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json().draftId, 'prj_test'); assert.equal(r.json().sheetUpdated, false);
  assert.equal(loadQueue(path.join(r.dir, 'quotes.csv')).pending.index, 0);
  assert.deepEqual(r.calls.map(c => c.path), ['/api/render/validate/api-key', '/api/projects']);
});
test('a failed draft save remains explicit and does not cause a paid render', t => {
  const r = run(t, 'draft-failed', ['--dry-run']); assert.equal(r.status, 0);
  assert.equal(r.json().draftId, null); assert.equal(r.calls.length, 2);
});
test('completed render advances one output row and leaves the source untouched', t => {
  const before = readFileSync('data/quotes.csv', 'utf8');
  const r = run(t, 'completed', ['--no-download', '--max-credits', '11']); assert.equal(r.status, 0, r.stderr);
  const queue = loadQueue(path.join(r.dir, 'quotes.csv')); assert.equal(queue.pending.index, 1);
  assert.equal(queue.records[0].VideoUrl, 'https://media.example.test/video.mp4');
  assert.equal(r.json().creditsQuoted, 11); assert.equal(readFileSync('data/quotes.csv', 'utf8'), before);
});
test('download failure preserves completed URL and completed queue state', t => {
  const r = run(t, 'download-failed'); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json().rendered, true); assert.match(r.json().downloadWarning, /403/);
  assert.equal(loadQueue(path.join(r.dir, 'quotes.csv')).pending.index, 1);
});
test('successful download records the local output file', t => {
  const r = run(t); assert.equal(r.status, 0, r.stderr); assert.equal(existsSync(r.json().localFile), true);
});
test('validation failure never submits a render', t => {
  const r = run(t, 'invalid'); assert.equal(r.status, 1); assert.equal(r.calls.length, 1);
  assert.equal(existsSync(path.join(r.dir, 'quotes.csv')), false);
});
test('cost limit rejects submission before credits are spent', t => {
  const r = run(t, 'completed', ['--max-credits', '10']); assert.equal(r.status, 1);
  assert.equal(r.calls.length, 1); assert.match(r.stderr, /No render submitted/);
});
test('failed render saves its job ID and does not complete a queue row', t => {
  const r = run(t, 'failed'); assert.equal(r.status, 1); assert.equal(r.json().state, 'failed');
  assert.equal(r.json().jobId, 'job_test'); assert.equal(existsSync(path.join(r.dir, 'quotes.csv')), false);
});
test('timeout preserves the submitted job ID without resubmitting', t => {
  const r = run(t, 'timeout', ['--timeout', '0.0000001']); assert.equal(r.status, 1);
  assert.equal(r.json().jobId, 'job_test'); assert.equal(r.calls.filter(c => c.path === '/api/render/api-key').length, 1);
});
test('completed job without a media URL does not mark the row done', t => {
  const r = run(t, 'missing-url'); assert.equal(r.status, 1); assert.match(r.stderr, /no video URL/);
  assert.equal(existsSync(path.join(r.dir, 'quotes.csv')), false);
});
test('exhausted queue exits successfully without contacting the API', t => {
  const r = run(t, 'completed', [], 'Quote,Author,AuthorNote,Status,VideoUrl\nHello,Example,,done,https://example.test/video\n');
  assert.equal(r.status, 0); assert.equal(r.calls.length, 0);
});
test('missing author is rejected before contacting the API', t => {
  const r = run(t, 'completed', [], 'Quote,Author,AuthorNote,Status,VideoUrl\nHello,,,,\n');
  assert.equal(r.status, 1); assert.equal(r.calls.length, 0); assert.match(r.stderr, /missing Author/);
});
test('invalid dates and nonfinite polling settings fail before API calls', t => {
  for (const args of [['--date', '2026-02-31'], ['--poll-interval', 'NaN'], ['--timeout', 'Infinity'], ['--max-credits', '-1']]) {
    const r = run(t, 'completed', args); assert.equal(r.status, 1); assert.equal(r.calls.length, 0);
  }
});
test('builder preserves deterministic layout, adapts longer text, and escapes markup', () => {
  const build = loadProjectBuilder('n8n/zvid-daily-quote-reels.workflow.json');
  const config = JSON.parse(readFileSync('config.json', 'utf8'));
  const data = { quote: '<script>Example</script> & reflection', author: 'Example author', date: new Date('2026-10-14T12:00:00Z') };
  const short = build(config, data); const long = build(config, { ...data, quote: 'A longer illustrative quote. '.repeat(8) });
  assert.deepEqual(short, build(config, data)); assert.ok(long.meta.quoteSize < short.meta.quoteSize);
  assert.ok(JSON.stringify(short.payload).includes('&lt;script&gt;'));
  assert.equal(short.payload.resolution, 'instagram-reel'); assert.equal(short.payload.scenes.length, 2);
});
