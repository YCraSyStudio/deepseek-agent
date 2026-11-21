import type { ExtensionMode, ExtensionContext } from "vscode";
import { request } from "node:http";
import { getuid } from "node:process";

const testMode: ExtensionMode.Test = 3;

type Operation = "import" | "get" | "put" | "delete";

export async function backendCredential(context: ExtensionContext, operation: Operation, origin: string, key?: string): Promise<{
  available: boolean; key?: string;
}> {
  if (!context.extensionMode || context.extensionMode === testMode || process.platform !== "linux" || !getuid) {return { available: false };}
  const socketPath = `/run/user/${getuid()}/ycrasy-agent.sock`;
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath, path: "/api/credentials/" + operation, method: "POST",
      headers: { "Content-Type": "application/json", "X-YcraSy-Client": "extension" },
      signal: AbortSignal.timeout(20000),
    }, (response) => {
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("error", reject);
      response.on("end", () => {
        if (response.statusCode === 204) {resolve({ available: true });}
        else if (operation === "get" && response.statusCode === 200) {resolve({ available: true, key: body });}
        else {reject(new Error("The backend could not complete the credential operation."));}
      });
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {resolve({ available: false });}
      else {reject(error);}
    });
    req.end(JSON.stringify({ origin, key }));
  });
}
