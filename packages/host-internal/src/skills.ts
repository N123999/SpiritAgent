import type { InstructionPaths } from './storage.js';

export interface BuildCreateSkillUserTurnOptions {
  includeManagedUserRootNote?: boolean;
  deliveryWriteInstruction?: string;
}

export function buildCreateSkillUserTurn(
  workspaceRoot: string,
  instructionPaths: Pick<InstructionPaths, 'workspaceSpiritSkillsDir' | 'userSkillsDir'>,
  prompt: string,
  options: BuildCreateSkillUserTurnOptions = {},
): string {
  const workspaceTargetRoot = instructionPaths.workspaceSpiritSkillsDir;
  const userTargetRoot = instructionPaths.userSkillsDir;
  const managedUserRootNote = options.includeManagedUserRootNote
    ? `\n- 用户级目标目录位于 Spirit 托管的用户目录；该路径虽在工作区外，但属于允许写入的托管范围。`
    : '';
  const deliveryWriteInstruction =
    options.deliveryWriteInstruction ?? '如果你能直接在目标路径落盘，就在确认内容后使用文件工具写入。';

  return `你现在在处理一个 /create-skill 请求。

目标:
- default_scope: 工作区
- workspace_skill_root: ${workspaceTargetRoot}
- user_skill_root: ${userTargetRoot}
- workspace_root: ${workspaceRoot}

用户需求:
${prompt}

要求:
- 先把它当成一次正常的 assistant 对话来处理，正常流式输出，不要伪装成后台静默生成器。
- 默认创建到工作区 skill 根目录 ${workspaceTargetRoot}；只有在用户明确要求“用户级 / 全局 / 跨仓库复用 / 写到用户目录”这类语义时，才改为用户目录 ${userTargetRoot}。${managedUserRootNote}
- 你需要先根据用户需求自行决定一个合适的 skill_name；名称必须是 1-64 个字符，只能使用小写字母、数字和连字符，不能以连字符开头或结尾，也不能包含连续连字符。
- 最终目标目录名与 frontmatter \`name\` 必须完全等于你决定的 skill_name。
- 最终文件路径必须是 \`<选定根目录>/<skill_name>/SKILL.md\`；不要写到其他位置。
- 如果目标 Skill 已存在，先读取原有 \`SKILL.md\`，再基于现有内容压缩重写或收紧，不要在旧内容后面继续堆砌模板化废话。
- \`SKILL.md\` 必须以 YAML frontmatter 开头，至少包含 \`name\` 和 \`description\`；正文使用 Markdown，重点写清“做什么、何时用、怎么做”。
- \`description\` 要具体说明适用场景，便于 agent 在 catalog 中识别。
- Skill 是给后续 agent/LLM 直接消费的能力说明，不是给人类流程管理看的。
- 正文优先写步骤、输入输出示例、边界条件；避免空话、组织治理废话和泛泛 checklist。
- 需要事实时先读取仓库内相关文件，不要臆造项目结构、技术栈、目录或既有工作流。
- 如果技能需要引用其他文件，正文里使用相对路径表达，不要假设这些文件已经存在。
- 如果你选择工作区 scope，优先提炼当前仓库内可复用的流程知识、约束和操作步骤，避免写成泛化的团队治理文档。
- 如果你选择用户 scope，优先提炼跨仓库稳定复用的个人工作流、判断标准与执行步骤。
- 写入仍会经过正常审批；不要假设自己已经拿到权限，也不要在工具成功前声称“已创建”或“已更新”。

交付方式:
- ${deliveryWriteInstruction}
- 如果不能直接落盘，就把最终 \`SKILL.md\` 完整贴在回复里，并明确说明未写入。`;
}
