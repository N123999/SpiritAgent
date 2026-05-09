import { readFile } from 'node:fs/promises';

import { createExampleEvalScenario } from './examples.js';
import { assertEvalScenario, validateEvalScenario } from './validation.js';

async function main(): Promise<void> {
  const scenarioPath = process.argv[2];
  const scenario = scenarioPath
    ? JSON.parse(await readFile(scenarioPath, 'utf8')) as unknown
    : createExampleEvalScenario();

  assertEvalScenario(scenario);
  const result = validateEvalScenario(scenario);
  console.log(JSON.stringify({
    valid: result.valid,
    source: scenarioPath ?? 'built-in example',
  }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`eval scenario validation failed: ${message}`);
  process.exitCode = 1;
});
