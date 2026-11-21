export interface TerminalCommandResult {
  kind: "command_result";
  command: string;
  cwd: string;
  shell: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  truncated: { stdout: boolean; stderr: boolean };
}

export type StructuredToolResult =
  | {
      toolResultVersion: number;
      type: "file";
      path: string;
      content: string;
      size: number;
      binary?: boolean;
      truncated?: boolean;
      previewSize?: number;
    }
  | {
      toolResultVersion: number;
      type: "fileWrite";
      path: string;
      summary: string;
      overwritten: boolean;
      diff?: string;
      diffTruncated?: boolean;
      diffStats?: {
        additions: number;
        deletions: number;
      };
      binary?: boolean;
      beforeSize?: number;
      afterSize?: number;
      beforeHash?: string;
      afterHash?: string;
    }
  | {
      toolResultVersion: number;
      type: "fileEdit" | "filePatch";
      path: string;
      summary: string;
      diff: string;
      diffTruncated?: boolean;
      diffStats?: {
        additions: number;
        deletions: number;
      };
      beforeSize?: number;
      afterSize?: number;
      beforeHash?: string;
      afterHash?: string;
    }
  | {
      toolResultVersion: number;
      type: "fileMove";
      path: string;
      destination: string;
      sourceKind: string;
      summary: string;
      beforeHash?: string;
    }
  | {
      toolResultVersion: number;
      type: "fileDelete";
      path: string;
      entryType: string;
      entryCount?: number;
      permanent: boolean;
      summary: string;
    }
  | {
      toolResultVersion: number;
      type: "SearchResults";
      query: string;
      results: Array<{ file: string; line: number; text: string }>;
      truncated?: boolean;
    };
