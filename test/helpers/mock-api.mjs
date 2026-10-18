import { appendFileSync } from 'node:fs';

// Run the real CLI/SDK against deterministic responses, without sending requests.
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const scenario = process.env.QUOTE_TEST_SCENARIO;
  appendFileSync(process.env.QUOTE_TEST_LOG, JSON.stringify({ path: url.pathname, method: options.method || 'GET' }) + '\n');
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.pathname.endsWith('/validate/api-key')) {
    if (scenario === 'invalid') return json({ message: 'Invalid fixture', details: [{ field: 'scenes', message: 'Rejected fixture' }] }, 400);
    return json({ creditsRequired: 11, warnings: [] });
  }
  if (url.pathname === '/api/projects') {
    if (scenario === 'draft-failed') return json({ message: 'Draft unavailable' }, 403);
    return json({ project: { id: 'prj_test' } });
  }
  if (url.pathname === '/api/render/api-key') return json({ jobId: 'job_test' });
  if (url.pathname === '/api/jobs/job_test') {
    if (scenario === 'failed') return json({ state: 'failed', failedReason: 'Test failure' });
    if (scenario === 'timeout') return json({ state: 'active' });
    if (scenario === 'missing-url') return json({ state: 'completed' });
    return json({ state: 'completed', result: 'https://media.example.test/video.mp4' });
  }
  if (url.pathname === '/video.mp4') {
    if (scenario === 'download-failed') return new Response('Unavailable', { status: 403 });
    return new Response('mock video bytes', { headers: { 'content-type': 'video/mp4' } });
  }
  throw new Error(`Unexpected mock request: ${url.pathname}`);
};
