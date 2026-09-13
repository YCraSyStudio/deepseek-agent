import { defineConfig } from '@vscode/test-cli';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceFolder = dirname(fileURLToPath(import.meta.url));
const vscodeCache = join(workspaceFolder, '.tmp', 'vscode');
const testDataDirectory = join(workspaceFolder, '.tmp', 'integration-user-data');
const historyDirectory = join(testDataDirectory, 'history');
const invalidConversationPath = join(historyDirectory, 'unversioned-integration.json');
const unsupportedConversationPath = join(historyDirectory, 'unsupported-integration.json');
const malformedConversationPath = join(historyDirectory, 'malformed-integration.json');

rmSync(testDataDirectory, { recursive: true, force: true });
mkdirSync(historyDirectory, { recursive: true });
writeFileSync(invalidConversationPath, JSON.stringify({
	id: 'unversioned-integration',
	title: 'Unversioned',
	createdAt: Date.now(),
	updatedAt: Date.now(),
	model: 'deepseek-v4-flash',
	workspaceUri: 'file:///workspace',
	messages: [
		{ id: 'user', role: 'user', content: 'old data' },
	],
}), 'utf8');
writeFileSync(unsupportedConversationPath, JSON.stringify({ schemaVersion: 3 }), 'utf8');
writeFileSync(malformedConversationPath, '{invalid json', 'utf8');

const executable = await downloadAndUnzipVSCode({
	version: resolveCodeVersion(),
	cachePath: vscodeCache,
});

export default defineConfig({
	files: '.tmp/integration-tests/Extension.test.js',
	mocha: {
		timeout: 5_000,
	},
	env: {
		NODE_ENV: 'test',
		DEEPSEEK_AGENT_USER_DATA_DIR: testDataDirectory,
	},
	useInstallation: { fromPath: executable },
	launchArgs: [
		workspaceFolder,
		`--user-data-dir=${join(vscodeCache, 'user-data')}`,
		`--extensions-dir=${join(vscodeCache, 'extensions')}`,
	],
});

// The CLI resolves `--code-version` after loading this file, so the download has to read
// the same flag to stay on the requested build.
function resolveCodeVersion() {
	const inline = process.argv.find((argument) => argument.startsWith('--code-version='));
	if (inline) {
		return inline.slice('--code-version='.length);
	}
	const index = process.argv.indexOf('--code-version');
	return index === -1 || !process.argv[index + 1] ? 'stable' : process.argv[index + 1];
}
