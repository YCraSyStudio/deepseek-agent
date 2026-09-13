import { mkdir } from "node:fs/promises";

await mkdir(".tmp/test-results", { recursive: true });
