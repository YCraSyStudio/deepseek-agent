import type { TranslationCatalog } from "../Types";

export const settings = {
  settings: {
    tab: {
      api: "API",
      tools: "工具",
      general: "常规"
    },
    section: {
      extension: "扩展"
    },
    tabs: {
      label: "设置部分"
    },
    loading: "正在加载设置…",
    retry: "重试",
    reset: {
      label: "恢复默认设置",
      success: "设置已恢复默认值，API key 已保留。"
    },
    notification: {
      dismiss: "关闭通知"
    },
    unavailable: "设置在 VS Code 外不可用。",
    save: {
      error: "无法保存设置，请重试。"
    },
    load: {
      error: "无法加载设置。"
    },
    api: {
      title: "API 配置",
      key: "API key",
      keyVisibility: {
        label: "显示或隐藏 API key",
        tooltip: "显示/隐藏 API key"
      },
      testConnection: "测试连接",
      removeCredential: "删除 API key",
      removingCredential: "正在删除 API key...",
      removeCredentialFailed: "无法删除 API key。",
      testing: "正在测试...",
      notConfigured: "未配置",
      connection: {
        ok: "连接正常",
        failed: "连接失败"
      },
      configured: "已配置",
      httpWarning: "警告：HTTP 会在没有传输加密的情况下发送 API 凭据。",
      customHostWarning: "自定义 API 主机：请确认你信任其运营方。",
      baseUrl: "基础 URL"
    },
    reasoning: {
      mode: "思考模式",
      effort: "推理强度"
    },
    advanced: {
      title: "高级"
    },
    webSearch: {
      title: "Web 搜索",
      description: "使用已配置的 API 凭据通过 DeepSeek 搜索和读取网页。Search 和 Fetch 请求独立于模型 token 计费。",
      enabled: "启用 Web 搜索",
    },
    sampling: {
      temperature: "温度",
      topP: "Top P"
    },
    history: {
      incognito: "无痕模式",
      incognitoDescription: "聊天只保留在内存中，重新加载扩展或 VS Code 后将丢失。",
      transition: {
        workTitle: "进入无痕模式？",
        workDescription: "当前有 {generations} 个活动生成和 {queued} 条排队消息。",
        workFinished: "待处理工作已完成，现在可以进入无痕模式。",
        exitWorkTitle: "退出前停止无痕工作？",
        exitWorkFinished: "待处理的无痕工作已完成，现在可以继续退出无痕模式。",
        stopAndEnter: "停止生成并进入无痕模式",
        stopAndContinue: "停止生成并继续",
        enter: "进入无痕模式",
        continueExit: "继续",
        cancelAndWait: "取消并等待",
        exitTitle: "退出无痕模式？",
        exitDescription: "选择将本次无痕聊天保存为新会话，或将其丢弃。",
        saveAndExit: "保存并退出",
        discardAndExit: "丢弃并退出",
        cancel: "取消"
      },
      store: "保存聊天历史",
      retention: "历史保留天数（0 = 不限）"
    },
    instructions: {
      globalAgents: "使用全局 AGENTS.md 指令"
    },
    beta: {
      enable: "启用 Beta 功能"
    },
    language: {
      label: "界面语言",
      auto: "Auto"
    },
    model: {
      label: "模型"
    },
    usage: {
      title: "用量与成本",
      breakdown: "在回复下方显示 Token 用量",
      currency: "费用货币",
      currencyUsd: "美元（USD）",
      currencyCny: "人民币（CNY）"
    },
    limits: {
      maxTokens: "最大输出 Token 数",
      maxTokensDescription: "每次请求的输出预留。DeepSeek V4 的总上下文为 1M Token，最大输出为 384K；保守的默认值 8,192 有助于限制 API 用量和成本。",
      maxConcurrentGenerations: "并发生成数"
    }
  }
} satisfies TranslationCatalog;
