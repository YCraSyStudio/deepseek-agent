export interface RunningTaskInfo {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  pid?: number;
  startedAt?: string;
}
