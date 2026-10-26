import type { TranslationCatalog } from "../Types";
export const settings = {
  settings: {
    number: { increase: "Aumentar valor", decrease: "Disminuir valor" },
    help: "Ayuda: {setting}",
    snapshots: { storageLimit: "Límite de capturas (MiB)", storageHint: "Límite total para las copias de todos los chats. Si falta espacio, el mensaje continúa con un aviso y no se podrá revertir." },
    tab: {
      customization: "Personalización",
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
    storage: {
      title: "Almacenamiento",
      directory: "Carpeta de datos",
      browse: "Seleccionar carpeta",
      default: "Predeterminada",
      reload: "Recargar VS Code",
      reloadHint: "Se aplicará al recargar. Los datos anteriores permanecen en su carpeta.",
      error: "No se pudo guardar la ruta.",
    },
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
      description: "Activa funciones beta de la API de DeepSeek: Chat Prefix, FIM y herramientas estrictas. Desactivado por defecto. Al apagarlo se bloquean nuevas peticiones beta y se detienen las sugerencias automáticas.",
      editorSuggestions: "Sugerencias en el editor",
      chatSuggestions: "Sugerencias en el chat",
      editorSuggestionsHelp: "Tras una pausa de 800 ms al escribir, envía el código cercano a DeepSeek para completarlo. Consume API. Tab acepta; Escape descarta. Requiere funciones beta y un workspace de confianza.",
      chatSuggestionsHelp: "Pulsa Sugerir mensaje junto al indicador de contexto para generar un mensaje o continuar el borrador con un resumen breve del proyecto. Escribir no solicita sugerencias. No envía código fuente ni historial. Consume API. Tab acepta; Escape descarta. Requiere funciones beta, una API key configurada y un workspace de confianza.",
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
      description: "Busca con tu API key de DeepSeek y lee páginas localmente con Chromium. Search tiene un coste adicional al de los tokens; la lectura local no usa DeepSeek Fetch.",
      enabled: "Habilitar búsqueda web",
      region: "Región de búsqueda",
      global: "Global (por defecto)",
      auto: "Automática (sistema)",
      custom: "Elegir un país",
      countryCode: "Código de país de dos letras, como ES o US",
      regionHint: "Global no prioriza ningún país. Automática usa el país del sistema local, sin consultar ni añadir tu IP como parámetro. Lo que pidas en el chat tiene prioridad y se mantienen las fuentes técnicas de otros idiomas.",
    },
    toolCatalog: {
      label: "Lista de herramientas",
      loading: "Cargando herramientas…",
      empty: "No hay herramientas registradas",
      noDescription: "No hay descripción disponible.",
      searchDisabled: "No disponible mientras la búsqueda web esté desactivada.",
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
    reusable: {
      title: "Instrucciones",
      template: "Plantilla",
      templateHelp: "Blank.md inicia una instrucción vacía; git.md propone un flujo de Git; commit.md incluye convenciones del mensaje y comprobaciones. Elige una, ajusta el nombre y cuándo usarla, y edita su contenido en VS Code.",
      create: "Crear instrucción",
      help: "DeepSeek recibe el nombre y la descripción. Lee el archivo completo solo cuando corresponde a la tarea, por ejemplo al preparar un commit. Las instrucciones globales se aplican a todos los proyectos; las del workspace solo a ese proyecto.",
      scope: "Guardar en",
      global: "Global",
      workspace: "Workspace",
      name: "Nombre del archivo",
      nameHelp: "Escribe el nombre sin la extensión final, por ejemplo commit. La extensión .md es fija y se añade automáticamente. Otras extensiones forman parte del nombre: commit.txt se guarda como commit.txt.md. Puedes usar letras, números, puntos, guiones y guiones bajos. Los archivos existentes se abren sin sobrescribirlos.",
      description: "Cuándo utilizarla",
      descriptionPlaceholder: "Al crear o revisar un commit de Git",
      createAndEdit: "Crear y editar",
      cancel: "Cancelar",
      loading: "Cargando instrucciones…",
      empty: "Todavía no hay instrucciones.",
      edit: "Editar",
    },
    customization: {
      workspaceTitle: "Instrucciones del workspace",
      generateWorkspaceAgents: "Generar AGENTS.md",
      editWorkspaceAgents: "Editar AGENTS.md",
      workspaceFolder: "Carpeta del workspace",
      workspaceLoading: "Cargando instrucciones del workspace…",
      workspaceUnavailable: "Abre una carpeta local para crear sus instrucciones.",
      workspaceOpenError: "No se pudo abrir el AGENTS.md del workspace.",

      openGlobalAgents: "Editar AGENTS.md global",
      globalAgentsHelp: "Aplica tus instrucciones personales a todos los workspaces. Guarda el archivo en VS Code; los cambios guardados se cargan antes de cada mensaje.",
      openError: "No se pudo abrir el AGENTS.md global.",
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
