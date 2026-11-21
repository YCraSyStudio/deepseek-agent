export interface WorkspaceInstructionsRoot {
  uri: string;
  name: string;
  exists: boolean;
}

export interface ReusableInstruction {
  id: string;
  name: string;
  description: string;
  scope: "global" | "workspace";
  rootUri?: string;
}

export { INSTRUCTION_TEMPLATE_IDS, type InstructionTemplateId } from "@/shared/instructions/InstructionTemplates";
