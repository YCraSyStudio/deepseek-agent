import type { TranslationCatalog } from "../Types";
export const settings = {
  settings: {
    number: { increase: "增加数值", decrease: "减少数值" },
    help: "帮助：{setting}",
    snapshots: { storageLimit: "快照存储上限 (MiB)", storageHint: "所有聊天恢复副本的总上限。空间不足时会发出警告并继续发送消息，但该轮无法撤销。" },
    tab: {
      customization: "个性化",
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
    storage: {
      title: "存储",
      directory: "数据文件夹",
      browse: "选择文件夹",
      default: "默认",
      reload: "重新加载 VS Code",
      reloadHint: "重新加载后生效。现有数据保留在原文件夹中。",
      error: "无法保存路径。",
    },
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
    beta: {
      title: "Beta 功能",
      enabled: "启用 Beta 功能",
      description: "启用 DeepSeek API 的 Beta 功能：Chat Prefix、FIM 和严格工具调用。默认关闭。关闭后阻止新的 Beta 请求并停止自动建议。",
      editorSuggestions: "编辑器建议",
      chatSuggestions: "聊天建议",
      editorSuggestionsHelp: "输入停顿 800 毫秒后，将附近代码发送至 DeepSeek 进行补全，产生 API 费用。Tab 接受，Escape 关闭。需要启用 Beta 功能并信任工作区。",
      chatSuggestionsHelp: "点击上下文指示器旁的建议消息按钮，使用简短项目摘要生成消息或续写草稿。输入时不会自动请求建议。不发送源代码或聊天历史。产生 API 费用。Tab 接受，Escape 关闭。需要启用 Beta 功能、配置 API 密钥并信任工作区。",
    },
    privacy: {
      title: "隐私",
      minimize: "减少元数据",
      description: "从自动上下文中省略绝对路径、图像文件名和可选标识。使用 UTC 时间，不附加时区名称。",
      limits: "尽力而为：不修改消息、代码、工具输出、图像或历史。不保证匿名性；提供商仍能看到连接 IP。",
    },
    browser: {
      access: "截图权限",
      ask: "按网站询问",
      always: "始终允许",
      never: "从不允许",
      automatic: "自动截图",
      automaticHelp: "界面变化后对上次明确截图的目标进行截图。截图在分析之前仅保存在本地。",
      limit: "每个对话的截图上限",
    },
    webSearch: {
      title: "Web 搜索",
      description: "使用 DeepSeek API key 搜索，并通过本地 Chromium 读取网页。搜索在模型 Token 费用之外单独计费；本地读取不使用 DeepSeek Fetch。",
      enabled: "启用 Web 搜索",
      region: "搜索地区",
      global: "全球（默认）",
      auto: "自动（系统）",
      custom: "选择国家",
      countryCode: "两位国家代码，例如 ES 或 US",
      regionHint: "全球不设置国家偏好。自动使用本地系统的国家，不查询 IP，也不将 IP 添加为参数。聊天中的明确要求优先，其他语言的技术资料仍然可用。",
    },
    toolCatalog: {
      label: "工具列表",
      loading: "正在加载工具…",
      empty: "未注册任何工具",
      noDescription: "暂无说明。",
      searchDisabled: "禁用网页搜索时，此工具不可用。",
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
      retention: "历史保留天数",
      retentionHelp: "设为 0 可无限期保留。",
    },
    reusable: {
      title: "指令",
      template: "模板",
      templateHelp: "Blank.md 创建空白指令；git.md 提供 Git 工作流；commit.md 包含提交消息约定和检查。选择模板，调整名称及使用时机，然后在 VS Code 中编辑内容。",
      create: "创建指令",
      help: "向 DeepSeek 提供名称和描述，仅在当前任务相关时读取完整文件，例如准备提交时。全局指令适用于所有项目；工作区指令仅适用于对应项目。",
      scope: "保存位置",
      global: "全局",
      workspace: "工作区",
      name: "文件名",
      nameHelp: "输入不含最终扩展名的名称，例如 commit。.md 扩展名固定并自动追加。其他扩展名视为名称的一部分：commit.txt 会保存为 commit.txt.md。支持字母、数字、点、连字符和下划线。已有文件直接打开，不会覆盖。",
      description: "使用时机",
      descriptionPlaceholder: "创建或检查 Git 提交时",
      createAndEdit: "创建并编辑",
      cancel: "取消",
      loading: "正在加载指令…",
      empty: "尚无指令。",
      edit: "编辑",
    },
    customization: {
      workspaceTitle: "工作区指令",
      generateWorkspaceAgents: "生成 AGENTS.md",
      editWorkspaceAgents: "编辑 AGENTS.md",
      workspaceFolder: "工作区文件夹",
      workspaceLoading: "正在加载工作区指令…",
      workspaceUnavailable: "请打开本地工作区文件夹以创建指令。",
      workspaceOpenError: "无法打开工作区 AGENTS.md。",

      openGlobalAgents: "编辑全局 AGENTS.md",
      globalAgentsHelp: "将个人指令应用到所有工作区。在 VS Code 中保存文件后，每条消息发送前会重新读取。",
      openError: "无法打开全局 AGENTS.md。",
    },
    instructions: {
      globalAgents: "使用全局 AGENTS.md 指令"
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
      maxTokensDescription: "每次请求的输出上限。默认值（8,192 Token）有助于控制 API 用量和成本。",
      maxConcurrentGenerations: "并发生成数"
    }
  }
} satisfies TranslationCatalog;
