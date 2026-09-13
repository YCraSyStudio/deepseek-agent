import type { ScriptLanguage } from "./CommandFacts";


export interface ScriptEffectProfile {
  bounded: boolean;
  capabilities: string[];
  blockedBy: string[];
}

export interface ScriptEffectOptions {
  workspaceRoot?: string;
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 64 * 1024;

const DENIED_CAPABILITIES: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  {
    code: "dynamic-evaluation",
    pattern: /\bInvoke-Expression\b|\biex\b|\[scriptblock\]\s*::\s*create|\bAdd-Type\b|\bInvoke-Command\b|\beval\s*\(|\bexec\s*\(|\bnew\s+Function\s*\(|\bchild_process\b/,
  },
  {
    code: "payload-download",
    pattern: /\bDownloadString\b|\bDownloadFile\b|\bWebClient\b|\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/,
  },
  {
    code: "machine-policy-change",
    pattern: /\bSet-ExecutionPolicy\b|\bschtasks\b|\bNew-Service\b|\bsc(?:\.exe)?\s+create\b|\breg(?:\.exe)?\s+add\b|\bnetsh\b|\bnet\s+(?:user|localgroup|share)\b|\bufw\b|\bsystemctl\b|\bcrontab\b|\blaunchctl\b/,
  },
  {
    code: "broad-process-termination",
    pattern: /\bStop-Process\b[^\n]*\s-Name\b|\btaskkill\b[^\n]*\/IM\b|\bkillall\b|\bpkill\b|\bkill\s+-9\s+-1\b|\bGet-Process\b[^\n]*\|\s*Stop-Process\b/,
  },
  {
    code: "privilege-escalation",
    pattern: /\bsudo\b|\bdoas\b|\bpkexec\b|\brunas\b|\bRunAs\b|\bgsudo\b/,
  },
  {
    code: "interactive-input",
    pattern: /\bRead-Host\b|\bGet-Credential\b|\bReadKey\b|\bcmd(?:\.exe)?\s+\/k\b|\bpause\b/,
  },
  {
    code: "credential-access",
    pattern: /\bConvertTo-SecureString\b|\bConvertFrom-SecureString\b|\bGet-Secret\b|\bsecurity\s+find-generic-password\b|\bkeychain\b|\bNet\.NetworkCredential\b/,
  },
  {
    code: "external-path",
    pattern: /\$env:(?:ProgramFiles|ProgramData|SystemRoot|WinDir|USERPROFILE|HOME|APPDATA)\b|\bSystem32\b|\\\\[A-Za-z0-9._-]+\\|(?:^|[\s"'(])(?:~\/|\/etc\/|\/usr\/|\/var\/|\/opt\/|\/root\/|\/bin\/|\/sbin\/|\/dev\/)/,
  },
  {
    code: "workspace-escape",
    pattern: /\.\.[\\/]\.\./,
  },
  {
    code: "unbounded-background",
    pattern: /\bStart-Job\b|\bStart-ThreadJob\b|\bnohup\b|\bdisown\b|\bsetsid\b|\b-AsJob\b/,
  },
];

const CAPABILITY_EVIDENCE: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: "http-localhost", pattern: /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i },
  { code: "child-process", pattern: /\bStart-Process\b|\.Start\s*\(|spawn\s*\(|execFile\s*\(|&\s*\$[A-Za-z]/ },
  { code: "process-cleanup-owned", pattern: /\.Kill\s*\(\)|\bStop-Process\b\s+-Id|\bprocess\.kill\s*\(/ },
  { code: "finite-wait", pattern: /\bStart-Sleep\b[^\n]*\d|\bWait-Process\b[^\n]*-Timeout\b|setTimeout\s*\(|\bsleep\s+\d/ },
  { code: "workspace-relative-path", pattern: /\$PSScriptRoot\b|\$MyInvocation\b|\$PWD\b|__dirname|\.\/[A-Za-z0-9._-]+/ },
];

const URL_PATTERN = /https?:\/\/([A-Za-z0-9._-]+|\[[0-9a-fA-F:]+\])(?::\d+)?/g;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
const WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\)[A-Za-z0-9._$-]+(?:[\\/][A-Za-z0-9._$-]+)*/g;
const POSIX_ABSOLUTE_PATH_PATTERN = /(?<![\w.:/$-])\/(?:[A-Za-z0-9._$-]+\/)+/g;

export function analyzeScriptEffects(
  content: string,
  language: ScriptLanguage,
  options: ScriptEffectOptions = {},
): ScriptEffectProfile {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (content.length === 0) {
    return { bounded: false, capabilities: [], blockedBy: ["empty-script"] };
  }
  if (content.length > maxBytes) {
    return { bounded: false, capabilities: [], blockedBy: ["script-too-large"] };
  }

  const blockedBy: string[] = [];
  for (const { code, pattern } of DENIED_CAPABILITIES) {
    if (pattern.test(content)) {
      blockedBy.push(code);
    }
  }
  if (language !== "powershell" && /Invoke-WebRequest|Invoke-RestMethod/i.test(content)) {
    blockedBy.push("dynamic-evaluation");
  }
  if (hasNonLocalNetworkDestination(content)) {
    blockedBy.push("non-local-network");
  }
  if (hasExternalAbsolutePath(content, options.workspaceRoot)) {
    blockedBy.push("external-absolute-path");
  }

  return {
    bounded: blockedBy.length === 0,
    capabilities: CAPABILITY_EVIDENCE
      .filter(({ pattern }) => pattern.test(content))
      .map(({ code }) => code),
    blockedBy: [...new Set(blockedBy)],
  };
}

function hasNonLocalNetworkDestination(content: string): boolean {
  for (const match of content.matchAll(URL_PATTERN)) {
    const host = (match[1] ?? "").toLowerCase().replace(/^\[|\]$/g, "");
    if (!LOCAL_HOSTS.has(host.toLowerCase()) && !LOCAL_HOSTS.has(`[${host}]`)) {
      return true;
    }
  }
  return false;
}

function hasExternalAbsolutePath(content: string, workspaceRoot: string | undefined): boolean {
  const normalizedRoot = workspaceRoot ? workspaceRoot.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "") : undefined;
  for (const pattern of [WINDOWS_ABSOLUTE_PATH_PATTERN, POSIX_ABSOLUTE_PATH_PATTERN]) {
    for (const match of content.matchAll(pattern)) {
      const candidate = match[0]!.replace(/\\/g, "/").toLowerCase();
      if (normalizedRoot && (candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`))) {
        continue;
      }
      return true;
    }
  }
  return false;
}
