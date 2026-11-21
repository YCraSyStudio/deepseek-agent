import type { TranslationCatalog } from "../Types";

export const history = {
  history: {
    incognitoActive: "El historial no está disponible mientras el modo incógnito está activo. Las conversaciones existentes siguen guardadas y reaparecerán al salir.",
    historyControls: "Controles del historial",
    searchLabel: "Buscar en el historial",
    searchPlaceholder: "Buscar en el historial…",
    sortHistory: "Ordenar historial",
    filterByWorkspace: "Filtrar por workspace",
    allWorkspaces: "Todos los workspaces",
    groupByWorkspace: "Agrupar por workspace",
    groupSummary: "{count} conversaciones",
    dateNewest: "Fecha (más reciente)",
    dateOldest: "Fecha (más antigua)",
    titleAZ: "Título (A-Z)",
    titleZA: "Título (Z-A)",
    deleteFilteredHistory: "Eliminar el historial filtrado",
    loadingHistory: "Cargando historial…",
    historyCouldNotBeLoaded: "No se pudo cargar el historial.",
    historyIsUnavailableOutsideVSCode: "El historial no está disponible fuera de VS Code.",
    noConversationsMatchYourSearch: "Ninguna conversación coincide con la búsqueda.",
    noHistoryYet: "Todavía no hay historial.",
    unknownWorkspace: "Workspace desconocido",
    historyPages: "Páginas del historial",
    previous: "Anterior",
    next: "Siguiente",
    pageSummary: "Página {page} de {pages} · {count} conversaciones",
    openTitle: "Abrir {title}",
    deleteTitle: "Eliminar {title}",
    countMessages: "{count} mensajes",
    workspaceMismatch: {
      title: "¿Abrir en este workspace?",
      description: "Esta conversación pertenece a \"{workspace}\", que no es el workspace abierto actualmente. ¿Quieres abrirla aquí en su lugar? Las generaciones pendientes, los mensajes en cola y las referencias a archivos se eliminarán.",
      confirm: "Abrir aquí",
      cancel: "Cancelar",
    }
  }
} satisfies TranslationCatalog;
