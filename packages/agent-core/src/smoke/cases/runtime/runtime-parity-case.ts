import { printSmokeSection } from '../../shared/print.js';

import { runApprovalCase } from './parity/approval.case.js';
import { runBackgroundCase } from './parity/background.case.js';
import { runCompactionCase } from './parity/compaction.case.js';
import { runContextProjectionCase } from './parity/context-projection.case.js';
import { runGenerateImageCase } from './parity/generate-image.case.js';
import { runManualToolsCase } from './parity/manual-tools.case.js';
import { runMcpCase } from './parity/mcp.case.js';
import { runStreamingCase } from './parity/streaming.case.js';
import { runSubagentCase } from './parity/subagent.case.js';
import { runVisionCase } from './parity/vision.case.js';

export async function runRuntimeParitySmoke(): Promise<void> {
  const approval = await runApprovalCase();
  const compaction = await runCompactionCase();
  const background = await runBackgroundCase();
  const vision = await runVisionCase();
  const subagent = await runSubagentCase();
  const generateImage = await runGenerateImageCase();
  const manualTools = await runManualToolsCase();
  const mcp = await runMcpCase();
  const contextProjection = await runContextProjectionCase();
  const streaming = await runStreamingCase();

  printSmokeSection('approval guidance smoke', approval.approvalCompleted);
  printSmokeSection('compact retry smoke', compaction.compactResult);
  printSmokeSection('background execution smoke', background.backgroundResult);
  printSmokeSection('polling background smoke', background.pollingBackgroundResult);
  printSmokeSection('polling compact smoke', compaction.pollingCompactResult);
  printSmokeSection('vision fallback smoke', vision.visionResult);
  printSmokeSection('manual command smoke', manualTools.manualGuidance);
  printSmokeSection('generate image terminal smoke', generateImage.generateImageNonStreamingResult);
  printSmokeSection('generate image streaming terminal smoke events', generateImage.generateImageStreamingEvents);
  printSmokeSection('manual background smoke', manualTools.manualBackgroundCompleted);
  printSmokeSection('manual compaction smoke', manualTools.manualCompactionCompleted);
  printSmokeSection('mcp prompt smoke', mcp.promptApplied);
  printSmokeSection('mcp prompt streaming smoke events', mcp.drainedStreamingPromptEvents);
  printSmokeSection('mcp resource smoke', mcp.resourceResult);
  printSmokeSection('archive restore smoke', mcp.archive);
  printSmokeSection('workspace file context smoke', contextProjection.workspaceFileSmoke);
  printSmokeSection('tool image projection smoke', contextProjection.toolImageProjectionResult);
  printSmokeSection('streaming final smoke events', streaming.drainedStreamingEvents);
  printSmokeSection('stream timeout smoke events', streaming.drainedTimeoutEvents);
  printSmokeSection('streaming failure smoke events', streaming.drainedStreamingFailureEvents);
  printSmokeSection('streaming approval smoke events', streaming.drainedStreamingApprovalEvents);
  printSmokeSection('streaming approval image smoke events', streaming.drainedStreamingApprovalImageEvents);
  printSmokeSection('streaming guidance smoke events', streaming.drainedStreamingGuidanceEvents);
  printSmokeSection('manual compaction smoke events', manualTools.drainedManualCompactionEvents);
  printSmokeSection('streaming background smoke events', streaming.drainedStreamingBackgroundEvents);
  printSmokeSection('streaming compaction smoke events', streaming.drainedStreamingCompactionEvents);
}
