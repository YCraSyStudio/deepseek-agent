import type { TranslationCatalog } from "../Types";

export const settings = {
  settings: {
    help: "Ayuda: {setting}",
    tab: {
      api: "API",
      tools: "Herramientas",
      general: "General"
    },
    section: {
      extension: "Extensión"
    },
    tabs: {
      label: "Secciones de ajustes"
    },
    loading: "Cargando ajustes…",
    retry: "Reintentar",
    reset: {
      label: "Restablecer valores predeterminados",
      success: "Ajustes restablecidos. La API key se ha conservado."
    },
    notification: {
      dismiss: "Cerrar notificación"
    },
    unavailable: "Los ajustes no están disponibles fuera de VS Code.",
    save: {
      error: "No se pudieron guardar los ajustes. Inténtalo de nuevo."
    },
    load: {
      error: "No se pudieron cargar los ajustes."
    },
    api: {
      title: "Configuración de la API",
      key: "API key",
      keyVisibility: {
        label: "Mostrar u ocultar la API key",
        tooltip: "Mostrar/ocultar API key"
      },
      testConnection: "Probar conexión",
      removeCredential: "Eliminar API key",
      removingCredential: "Eliminando API key...",
      removeCredentialFailed: "No se pudo eliminar la API key.",
      testing: "Probando...",
      notConfigured: "Sin configurar",
      connection: {
        ok: "Conexión correcta",
        failed: "Conexión fallida"
      },
      configured: "Configurada",
      httpWarning: "Advertencia: HTTP envía las credenciales de la API sin cifrado de transporte.",
      customHostWarning: "Host de API personalizado: verifica que confías en su operador.",
      baseUrl: "URL base"
    },
    reasoning: {
      mode: "Modo de razonamiento",
      effort: "Nivel de razonamiento"
    },
    advanced: {
      title: "Avanzado"
    },
    beta: {
      title: "Funciones beta",
      enabled: "Activar funciones beta",
      description: "Activa Chat Prefix, FIM y herramientas estrictas. Desactivado por defecto. Al apagarlo se bloquean nuevas peticiones beta y se detienen las sugerencias automáticas.",
      editorSuggestions: "Sugerencias en el editor",
      chatSuggestions: "Sugerencias en el chat",
      suggestionsHelp: "Tras una breve pausa al escribir, envía el código cercano o el borrador del chat a DeepSeek. Consume API. Tab acepta; Escape descarta. Requiere funciones beta.",
    },
    privacy: {
      title: "Privacidad",
      minimize: "Minimizar metadatos",
      description: "Omite rutas absolutas del contexto automático, nombres de imágenes e identificadores opcionales. Usa fechas UTC sin el nombre de tu zona horaria.",
      limits: "Mejor esfuerzo: no modifica mensajes, código, salidas de herramientas, imágenes ni historial. No garantiza anonimato; el proveedor sigue viendo la IP de conexión.",
    },
    browser: {
      access: "Permiso de capturas",
      ask: "Preguntar por sitio",
      always: "Siempre",
      never: "Nunca",
      automatic: "Capturas automáticas",
      automaticHelp: "Captura tras cambios en la interfaz usando el último destino capturado explícitamente. Las capturas permanecen locales hasta analizarlas.",
      limit: "Máximo de capturas por conversación",
    },
    webSearch: {
      title: "Búsqueda web",
      description: "Busca y lee páginas con tu API key de DeepSeek. Search y Fetch tienen un coste adicional al de los tokens.",
      enabled: "Habilitar búsqueda web",
      region: "Región de búsqueda",
      global: "Global (por defecto)",
      auto: "Automática (sistema)",
      custom: "Elegir un país",
      countryCode: "Código de país de dos letras, como ES o US",
      regionHint: "Global no prioriza ningún país. Automática usa el país del sistema local, sin consultar ni añadir tu IP como parámetro. Lo que pidas en el chat tiene prioridad y se mantienen las fuentes técnicas de otros idiomas.",
    },
    sampling: {
      temperature: "Temperatura",
      topP: "Top P"
    },
    history: {
      incognito: "Modo incógnito",
      incognitoDescription: "Los chats solo se conservan en memoria y se pierden al recargar la extensión o VS Code.",
      transition: {
        workTitle: "¿Entrar en modo incógnito?",
        workDescription: "Hay {generations} generaciones activas y {queued} mensajes en cola.",
        workFinished: "El trabajo pendiente ha terminado. Ya puedes entrar en modo incógnito.",
        exitWorkTitle: "¿Parar el trabajo incógnito antes de salir?",
        exitWorkFinished: "El trabajo incógnito pendiente ha terminado. Ya puedes continuar saliendo del modo incógnito.",
        stopAndEnter: "Parar generaciones y entrar en incógnito",
        stopAndContinue: "Parar generaciones y continuar",
        enter: "Entrar en incógnito",
        continueExit: "Continuar",
        cancelAndWait: "Cancelar y esperar",
        exitTitle: "¿Salir del modo incógnito?",
        exitDescription: "Elige si quieres guardar este chat incógnito como una conversación nueva o descartarlo.",
        saveAndExit: "Guardar y salir",
        discardAndExit: "Descartar y salir",
        cancel: "Cancelar"
      },
      store: "Guardar historial del chat",
      retention: "Conservar historial (días)",
      retentionHelp: "Usa 0 para conservarlo sin límite de tiempo.",
    },
    instructions: {
      globalAgents: "Usar las instrucciones globales de AGENTS.md"
    },
    language: {
      label: "Idioma de la interfaz",
      auto: "Auto"
    },
    model: {
      label: "Modelo"
    },
    usage: {
      title: "Uso y coste",
      breakdown: "Mostrar el consumo de tokens bajo las respuestas",
      currency: "Moneda del coste",
      currencyUsd: "Dólar estadounidense (USD)",
      currencyCny: "Yuan chino (CNY)"
    },
    limits: {
      maxTokens: "Tokens máximos de salida",
      maxTokensDescription: "Límite de salida por petición. El valor predeterminado (8.192 tokens) ayuda a controlar el consumo y el coste de la API.",
      maxConcurrentGenerations: "Generaciones simultáneas"
    }
  }
} satisfies TranslationCatalog;
