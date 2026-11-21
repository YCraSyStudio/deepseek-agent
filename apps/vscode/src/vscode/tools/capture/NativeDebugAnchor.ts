import * as vscode from "vscode";
export class NativeDebugAnchor implements vscode.Disposable {
  private readonly pids = new Map<string, number>();
  private readonly subscriptions: vscode.Disposable[];
  constructor() {
    this.subscriptions = [vscode.debug.registerDebugAdapterTrackerFactory("*", {
      createDebugAdapterTracker: (session) => ({ onDidSendMessage: (message) => {
        const pid = message?.event === "process" ? message.body?.systemProcessId : undefined;
        if (Number.isSafeInteger(pid) && pid > 0) {this.pids.set(session.id, pid);}
      } }),
    }), vscode.debug.onDidTerminateDebugSession((session) => this.pids.delete(session.id))];
  }
  pid(): number | undefined {
    const session = vscode.debug.activeDebugSession;
    if (!session) {return undefined;}
    const pid = this.pids.get(session.id) ?? Number(session.configuration.processId);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  }
  dispose(): void {for (const subscription of this.subscriptions) {subscription.dispose();} this.pids.clear();}
}
