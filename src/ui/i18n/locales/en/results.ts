import type { TranslationCatalog } from "../Types";

export const results = {
  results: {
    searchResults: "Search results",
    binaryContentCannotBePreviewedAsText: "Binary content cannot be previewed as text.",
    binaryPreviewUnavailable: "Binary file detected. Text preview is unavailable.",
    clickToOpenPathLine: "Click to open {path}:{line}",
    beforeSize: "before {size}",
    afterSize: "after {size}",
    binarySource: "binary source",
    binaryDiffUnavailable: "Previous file was binary, so no text diff is available.",
    binary: "binary",
    truncated: "truncated",
    countResults: "{count} results",
    andCountMoreResults: "... and {count} more results",
    result: "Result",
    terminalCommandMetadata: "Terminal command metadata",
    cancelled: "cancelled",
    timedOut: "timed out",
    exitCode: "exit {code}",
    unknown: "unknown",
    cwdCwd: "cwd: {cwd}",
    shellShell: "shell: {shell}",
    signalSignal: "signal: {signal}",
    truncatedPreview: " (truncated preview)",
    outputTruncated: "output truncated",
    retainedOutput: "View retained output",
    commandCompletedWithoutOutput: "Command completed without output.",
    truncatedDiffNotice: "Diff preview is truncated. The file operation still completed.",
    onlyTheFirstSizeIsShown: "Only the first {size} is shown."
  }
} satisfies TranslationCatalog;
