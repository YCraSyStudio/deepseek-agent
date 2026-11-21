export interface MobileWorkspaceListing {
  workspace: string;
  rootUri: string;
  files: string[];
}

export interface MobileWorkspaceFile {
  text: string;
  revision: string;
}

export type MobileWorkspaceErrorCode = "missing" | "notTracked" | "symlink";

export interface MobileWorkspaceFailure {
  error: string;
  code?: MobileWorkspaceErrorCode;
}
