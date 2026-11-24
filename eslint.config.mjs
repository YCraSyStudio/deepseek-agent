import typescriptEslint from "typescript-eslint";

const base = {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
};

const reactImports = ["react", "react/**"];
const hostImports = ["@/extension/**", "@/vscode/**", "@webview/**", ...reactImports, "vscode"];

function restrictImports(layer, group, message) {
    return {
        files: [`src/${layer}/**/*.{ts,tsx}`],
        rules: {
            "no-restricted-imports": ["error", { patterns: [{ group, message }] }],
        },
    };
}

export default [
    base,
    restrictImports(
        "contracts",
        ["@/application/**", "@/domain/**", "@/extension/**", "@/infrastructure/**", "@/vscode/**", "@webview/**", ...reactImports, "vscode", "node:*"],
        "Contracts may depend only on other contracts and shared framework-free utilities.",
    ),
    restrictImports(
        "domain",
        ["@/application/**", "@/contracts/**", "@/extension/**", "@/infrastructure/**", "@/vscode/**", "@webview/**", ...reactImports, "vscode", "node:*"],
        "Domain must remain independent from application, transports, providers, VS Code, Node, and React.",
    ),
    restrictImports(
        "application",
        ["@/extension/**", "@/infrastructure/**", "@/vscode/**", "@webview/**", ...reactImports, "vscode"],
        "Application may depend only on domain, contracts, application modules, and shared utilities.",
    ),
    restrictImports(
        "infrastructure",
        hostImports,
        "Infrastructure implements application ports and must not depend on VS Code, the extension shell, or React.",
    ),
    restrictImports(
        "vscode",
        ["@/extension/**", "@webview/**", ...reactImports],
        "VS Code adapters must not depend on the composition root or the React webview.",
    ),
    restrictImports(
        "ui",
        ["@/application/**", "@/domain/**", "@/extension/**", "@/infrastructure/**", "@/vscode/**", "vscode", "node:*"],
        "The webview may depend only on contracts, shared browser-safe utilities, and UI modules.",
    ),
];
