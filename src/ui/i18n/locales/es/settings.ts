import type { TranslationCatalog } from "../Types";

export const settings = {
  settings: {
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
    webSearch: {
      title: "Búsqueda web",
      description: "Busca y lee páginas con DeepSeek usando tu credencial API configurada. Las peticiones Search y Fetch se facturan por separado de los tokens del modelo.",
      enabled: "Habilitar búsqueda web",
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
      retention: "Días de retención del historial (0 = ilimitado)"
    },
    instructions: {
      globalAgents: "Usar las instrucciones globales de AGENTS.md"
    },
    beta: {
      enable: "Activar funciones beta"
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
      maxTokensDescription: "Reserva de salida por petición. DeepSeek V4 tiene 1M tokens de contexto total y admite hasta 384K de salida; el valor conservador predeterminado de 8.192 ayuda a limitar consumo y coste de la API.",
      maxConcurrentGenerations: "Generaciones simultáneas"
    }
  }
} satisfies TranslationCatalog;
