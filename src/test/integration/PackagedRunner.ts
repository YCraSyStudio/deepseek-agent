import * as path from "node:path";
import Mocha from "mocha";

export async function run(): Promise<void> {
  const mocha = new Mocha({ color: true, ui: "tdd", timeout: 20_000 });
  mocha.addFile(path.resolve(__dirname, "PackagedSmoke.test.js"));
  await mocha.loadFilesAsync();
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => failures > 0 ? reject(new Error(`${failures} packaged smoke test(s) failed.`)) : resolve());
  });
}
