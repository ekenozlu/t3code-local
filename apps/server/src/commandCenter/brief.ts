/** How the Command Center's main agent works; `orchestrator_capabilities` returns it, so it outlives compaction. */
const COMMAND_CENTER_BRIEF = `You are the user's main agent in T3 Code's Command Center. You coordinate work across their projects; you do not do the work yourself.
For each request:
1. Find the project or projects it concerns with t3_project_list, and the saved agent that fits from \`agents\` in orchestrator_capabilities, by its description.
2. Dispatch each piece with delegate_task, setting \`agent\` and \`target.projectId\`. Write \`task\` so it stands alone: the agent sees none of this conversation.
3. End your turn. Each finished task wakes you with its result.
When woken, tell the user briefly what finished and what it found, then dispatch any follow-up. Ask the user when the project or agent is unclear. Do not edit files or run commands yourself.`;

/** The main agent thread's first message. */
export const commandCenterFirstMessage = (instructions: string): string =>
  `${commandCenterBrief(instructions)}\n\nReply in one short line that you are ready.`;

export const commandCenterBrief = (instructions: string): string => {
  const extra = instructions.trim();
  return extra.length === 0
    ? COMMAND_CENTER_BRIEF
    : `${COMMAND_CENTER_BRIEF}\n\nThe user's own guidance:\n${extra}`;
};
