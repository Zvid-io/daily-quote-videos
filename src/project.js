import { readFileSync } from 'node:fs';

/**
 * Load the exact project builder embedded in the checked-in n8n workflow.
 * Keeping one canonical builder prevents the CLI and no-code workflow from
 * drifting apart as the visual design evolves.
 */
export function loadProjectBuilder(workflowPath) {
  const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'));
  const node = workflow.nodes?.find((candidate) => candidate.name === 'Build project JSON');
  const code = node?.parameters?.jsCode;
  if (!code) throw new Error('The workflow has no Build project JSON code node');

  const marker = '// === n8n glue ===';
  const markerIndex = code.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('Could not isolate the standalone project builder from the workflow');
  }

  const standaloneCode = code.slice(0, markerIndex);
  // The source is trusted, checked-in workflow code—not user input.
  return new Function(`${standaloneCode}\nreturn buildProject;`)();
}
