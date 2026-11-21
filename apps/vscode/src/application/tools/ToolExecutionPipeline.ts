const TOOL_EXECUTION_STAGE_ORDER = [
  "argument_validation",
  "workspace_trust",
  "prepare_remote_review",
  "deterministic_safety",
  "remote_review",
  "user_confirmation",
  "execution",
  "record_and_publish",
] as const;

type ToolExecutionStageName = typeof TOOL_EXECUTION_STAGE_ORDER[number];

export type ToolPipelineDecision<TContext, TResult> =
  | { kind: "continue"; context?: TContext }
  | { kind: "resolved"; result: TResult };

export interface ToolExecutionStage<TContext, TResult> {
  readonly name: ToolExecutionStageName;
  handle(context: TContext): Promise<ToolPipelineDecision<TContext, TResult>>;
}

export class ToolExecutionPipeline<TContext, TResult> {
  constructor(private readonly stages: readonly ToolExecutionStage<TContext, TResult>[]) {
    assertValidStageOrder(stages.map((stage) => stage.name));
  }

  async execute(context: TContext): Promise<ToolPipelineDecision<TContext, TResult>> {
    let current = context;
    for (const stage of this.stages) {
      const decision = await stage.handle(current);
      if (decision.kind === "resolved") {
        return decision;
      }
      current = decision.context ?? current;
    }
    return { kind: "continue", context: current };
  }
}

function assertValidStageOrder(names: readonly ToolExecutionStageName[]): void {
  const seen = new Set<ToolExecutionStageName>();
  let previousIndex = -1;
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`Tool execution stage '${name}' is registered more than once`);
    }
    const index = TOOL_EXECUTION_STAGE_ORDER.indexOf(name);
    if (index <= previousIndex) {
      throw new Error(`Tool execution stage '${name}' is out of order`);
    }
    seen.add(name);
    previousIndex = index;
  }
}
