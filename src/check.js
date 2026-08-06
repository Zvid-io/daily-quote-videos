import { existsSync, readFileSync } from 'node:fs';
import { loadProjectBuilder } from './project.js';
import { loadQueue, SHEET_COLUMNS } from './queue.js';

const workflowPath = 'n8n/zvid-daily-quote-reels.workflow.json';
const requiredNodes = [
  'Read quote sheet',
  'Pick next quote',
  'Build project JSON',
  'Validate project (free)',
  'Submit render',
  'Get render status',
  'Mark row done',
  '▶ Watch video',
];

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
for (const [label, url] of [
  ['homepage', packageJson.homepage],
  ['docs', packageJson.docs],
  ['repository', packageJson.repository?.url?.replace(/^git\+/, '')],
  ['bugs', packageJson.bugs?.url],
]) {
  if (!url || !url.startsWith('https://')) {
    throw new Error(`package.json ${label} must be an absolute HTTPS URL`);
  }
}

const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'));
const nodeNames = new Set(workflow.nodes.map((node) => node.name));
const missingNodes = requiredNodes.filter((name) => !nodeNames.has(name));
if (missingNodes.length) {
  throw new Error(`Workflow is missing node(s): ${missingNodes.join(', ')}`);
}

const workflowText = JSON.stringify(workflow);
if (/((?<!@zvid\/)n8n-nodes-zvid)|zvidAgentTools/.test(workflowText)) {
  throw new Error('Workflow contains an unpublished or removed n8n node type');
}

const { records, pending } = loadQueue('data/quotes.csv');
if (records.length > 3) throw new Error('Sample queue must contain at most 3 records');
if (!pending) throw new Error('Sample queue has no pending row');
for (const record of records) {
  if (record.Status || record.VideoUrl) {
    throw new Error('Sample Status and VideoUrl cells must start empty');
  }
}

const builder = loadProjectBuilder(workflowPath);
const config = JSON.parse(readFileSync('config.json', 'utf8'));
const built = builder(config, {
  quote: pending.record.Quote,
  author: pending.record.Author,
  authorNote: pending.record.AuthorNote,
  date: new Date('2026-07-28T12:00:00Z'),
});
if (built.payload.resolution !== 'instagram-reel' || built.payload.scenes.length !== 2) {
  throw new Error('Builder did not produce the expected two-scene vertical project');
}

const readme = readFileSync('README.md', 'utf8');
if (/dashboard\.zvid\.io/.test(readme)) {
  throw new Error('README contains the non-existent dashboard.zvid.io host');
}
if (/pexels|pixabay|unsplash/i.test(readme)) {
  throw new Error('README names a stock provider; say Zvid stock library instead');
}

for (const file of [
  'workflow.png',
  'example.mp4',
  'example-poster.jpg',
  'example-project.json',
]) {
  if (!existsSync(file)) throw new Error(`Missing required example asset: ${file}`);
}

const exampleProject = JSON.parse(readFileSync('example-project.json', 'utf8'));
const exampleText = JSON.stringify(exampleProject);
for (const [label, value] of [
  ['quote', pending.record.Quote],
  ['author', pending.record.Author],
  ['author note', pending.record.AuthorNote],
]) {
  if (value && !exampleText.includes(value)) {
    throw new Error(`example-project.json does not match the first sample ${label}`);
  }
}

console.log(
  `✓ Repository check passed: ${workflow.nodes.length} workflow nodes, ` +
    `${records.length} sample rows, headers ${SHEET_COLUMNS.join(' | ')}`
);
