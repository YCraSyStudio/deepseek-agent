import type { TranslationCatalog } from "../Types";

export const results = {
  results: {
    retainedOutput: "查看保留的输出",
    searchResults: "搜索结果",
    binaryContentCannotBePreviewedAsText: "二进制内容无法作为文本预览。",
    binaryPreviewUnavailable: "检测到二进制文件，无法进行文本预览。",
    clickToOpenPathLine: "打开 {path}:{line}",
    beforeSize: "之前 {size}",
    afterSize: "之后 {size}",
    binarySource: "二进制来源",
    binaryDiffUnavailable: "之前的文件是二进制文件，因此没有可用的文本 diff。",
    binary: "二进制",
    truncated: "已截断",
    countResults: "{count} 个结果",
    andCountMoreResults: "... 以及另外 {count} 个结果",
    result: "结果",
    terminalCommandMetadata: "终端命令元数据",
    cancelled: "已取消",
    timedOut: "已超时",
    exitCode: "退出码 {code}",
    unknown: "未知",
    cwdCwd: "目录：{cwd}",
    shellShell: "shell：{shell}",
    signalSignal: "信号：{signal}",
    truncatedPreview: "（预览已截断）",
    outputTruncated: "输出已截断",
    commandCompletedWithoutOutput: "命令完成但没有输出。",
    truncatedDiffNotice: "Diff 预览已截断，但文件操作已完成。",
    onlyTheFirstSizeIsShown: "仅显示前 {size}。"
  }
} satisfies TranslationCatalog;
