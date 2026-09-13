import type { RegisteredTool, ToolEffect } from "@/application/tools/Types";
import { readFileDefinition, readFileHandler, readFileMetadata } from "./fileSystem/ReadFile";
import { readFunctionDefinition, readFunctionHandler, readFunctionMetadata } from "./fileSystem/ReadFunction";
import { searchContentDefinition, searchContentHandler, searchContentMetadata } from "./fileSystem/SearchContent";
import { listDirDefinition, listDirHandler, listDirMetadata } from "./fileSystem/ListDir";
import { listWorkspaceDefinition, listWorkspaceHandler, listWorkspaceMetadata } from "./fileSystem/ListWorkspace";
import { createFileDefinition, createFileHandler, createFileMetadata, createFileHandlerForced } from "./fileSystem/CreateFile";
import { editFileDefinition, editFileHandler, editFileMetadata, editFileHandlerForced } from "./fileSystem/EditFile";
import { applyPatchDefinition, applyPatchHandler, applyPatchMetadata, applyPatchHandlerForced } from "./fileSystem/ApplyPatch";
import { movePathDefinition, movePathHandler, movePathMetadata, movePathHandlerForced } from "./fileSystem/MovePath";
import { deletePathDefinition, deletePathHandler, deletePathMetadata, deletePathHandlerForced } from "./fileSystem/DeletePath";
import { terminalCommandDefinition, terminalCommandHandler, terminalCommandMetadata, terminalCommandHandlerForced } from "./terminal/TerminalCommand";
import { compactContextDefinition, compactContextHandler, compactContextMetadata } from "./context/CompactContext";
import { analyzeImagesTool } from "./vision/AnalyzeImages";

export const BUILT_IN_TOOLS: RegisteredTool[] = [
  withEffect({ definition: compactContextDefinition, handler: compactContextHandler, metadata: compactContextMetadata }, "read-only"),
  withEffect({ definition: readFileDefinition, handler: readFileHandler, metadata: readFileMetadata }, "read-only"),
  withEffect({ definition: readFunctionDefinition, handler: readFunctionHandler, metadata: readFunctionMetadata }, "read-only"),
  withEffect({ definition: searchContentDefinition, handler: searchContentHandler, metadata: searchContentMetadata }, "read-only"),
  withEffect({ definition: listDirDefinition, handler: listDirHandler, metadata: listDirMetadata }, "read-only"),
  withEffect({ definition: listWorkspaceDefinition, handler: listWorkspaceHandler, metadata: listWorkspaceMetadata }, "read-only"),
  withEffect({ definition: createFileDefinition, handler: createFileHandler, forcedHandler: createFileHandlerForced, metadata: createFileMetadata }, "workspace-mutation"),
  withEffect({ definition: editFileDefinition, handler: editFileHandler, forcedHandler: editFileHandlerForced, metadata: editFileMetadata }, "workspace-mutation"),
  withEffect({ definition: applyPatchDefinition, handler: applyPatchHandler, forcedHandler: applyPatchHandlerForced, metadata: applyPatchMetadata }, "workspace-mutation"),
  withEffect({ definition: movePathDefinition, handler: movePathHandler, forcedHandler: movePathHandlerForced, metadata: movePathMetadata }, "workspace-mutation"),
  withEffect({ definition: deletePathDefinition, handler: deletePathHandler, forcedHandler: deletePathHandlerForced, metadata: deletePathMetadata }, "workspace-mutation"),
  withEffect(analyzeImagesTool, "external-effect"),
  withEffect({ definition: terminalCommandDefinition, handler: terminalCommandHandler, forcedHandler: terminalCommandHandlerForced, metadata: terminalCommandMetadata }, "workspace-mutation"),
];

function withEffect(tool: RegisteredTool, effect: ToolEffect): RegisteredTool {
  return {
    ...tool,
    metadata: {
      ...tool.metadata,
      effect,
    },
  };
}
