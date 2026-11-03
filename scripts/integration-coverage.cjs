const { Session } = require("node:inspector/promises");
const { writeFile } = require("node:fs/promises");
const { join } = require("node:path");

let session;
let completed = false;
exports.mochaGlobalSetup = async function () {
  session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
};

exports.mochaGlobalTeardown = async function () {
  if (!session || completed) { return; }
  completed = true;
  try {
    const { result } = await session.post("Profiler.takePreciseCoverage");
    await writeFile(join(process.env.DEEPSEEK_AGENT_COVERAGE_DIRECTORY, `integration-${process.pid}.json`), JSON.stringify({ result }));
    await session.post("Profiler.stopPreciseCoverage");
  } finally {
    session.disconnect();
  }
};
