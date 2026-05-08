import { createDryRunEvalComparison, createExampleEvalRunSpec } from './examples.js';
import { assertEvalScenario } from './validation.js';

function main(): void {
  const runSpec = createExampleEvalRunSpec();
  assertEvalScenario(runSpec.scenario);

  const comparison = createDryRunEvalComparison();
  console.log(JSON.stringify({
    runSpec,
    comparison,
  }, null, 2));
}

main();
