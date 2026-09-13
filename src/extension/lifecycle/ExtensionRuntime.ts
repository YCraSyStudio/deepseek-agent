import type { WebviewProvider } from "@/vscode/webviews/WebviewProvider";

let activeProvider: WebviewProvider | undefined;

export function setActiveProvider(provider: WebviewProvider | undefined): void {
  activeProvider = provider;
}

export async function shutdownActiveProvider(): Promise<void> {
  const provider = activeProvider;
  activeProvider = undefined;
  await provider?.shutdown();
}
