export type ApplicationSessionRequest =
  | { action: "start"; command: string; cwd?: string; wait_ms?: number }
  | { action: "status" | "stop"; session_id: string; wait_ms?: number };

export interface ApplicationSessionResult {
  kind: "application_session";
  sessionId: string;
  status: "running" | "exited" | "stopped";
  command: string;
  cwd: string;
  pid?: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  terminationConfirmed?: boolean;
  truncated: { stdout: boolean; stderr: boolean };
  note: string;
}
