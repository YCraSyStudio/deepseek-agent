import type { PageContent } from "../Types";

export const technicalDecisions: PageContent = {
  navTitle: "Decisiones técnicas",
  title: "Decisiones técnicas",
  seoTitle: "Arquitectura y decisiones técnicas",
  description: "Cómo se estructura la extensión por capas, cómo se asignan y recuperan las generaciones y cómo se diseñan el streaming, las herramientas y la persistencia.",
  lead: "La extensión separa el estado de dominio, el transporte de DeepSeek, las capacidades de VS Code y el renderizado React para que las reglas de seguridad sean autoritativas en el host.",
  sections: [
    {
      title: "Límites entre capas",
      items: [
        "contracts contiene modelos serializables de DeepSeek, configuración y protocolo webview v5, sin dependencias de UI, VS Code, filesystem o HTTP.",
        "application contiene las reglas de conversación, contexto, generación y herramientas independientes del proveedor mediante puertos explícitos.",
        "infrastructure contiene chat DeepSeek, SSE, Files API, búsqueda SearXNG y extracción de páginas, revisión de mutaciones y tools concretas.",
        "platform/vscode contiene secretos, workspace, almacenamiento, procesos, confirmaciones, subida/caché de adjuntos, routing y diffs nativos.",
        "ui contiene la webview React y solo cambia el estado autoritativo de una herramienta después de recibir mensajes del host. Chat y Settings se agrupan por feature con imports internos explícitos.",
      ],
    },
    {
      title: "Modelo cronológico de eventos",
      items: [
        "La presentación del asistente se persiste como eventos tipados de razonamiento, contenido y grupos de herramientas, no como marcadores de control dentro de texto.",
        "El mismo contrato de timeline renderiza el stream en vivo y el historial restaurado, conservando el orden think -> tool -> think -> response.",
        "Los deltas de texto se agrupan por frame de animación y se vacían antes de los grupos de herramientas, finalización, cancelación o persistencia.",
        "Los IDs de mensajes, eventos, conversaciones y tool calls de respaldo usan crypto.randomUUID().",
        "Los eventos adyacentes de razonamiento y herramientas se agrupan en bloques Activity contraídos para la presentación sin alterar su orden cronológico persistido.",
      ],
    },
    {
      title: "Propiedad y recuperación de generaciones",
      items: [
        "Un coordinador permite una generación activa por conversación y concurrencia acotada entre conversaciones. El límite configurable es 8 de forma predeterminada y se restringe al intervalo de 1 a 16.",
        "Los IDs de petición cliente, generación y conversación vinculan colas, streams, aprobaciones de herramientas, cancelación y snapshots con la ejecución correcta.",
        "Interrupt and guide encola primero la nueva indicación, aborta de forma segura el transporte actual y registra un vínculo verificado con la generación de origen. La siguiente petición continúa explícitamente la tarea original bajo esa guía; los envíos normales siguen siendo turnos independientes en cola.",
        "Los checkpoints atómicos con revisión conservan timelines parciales, estado de herramientas, configuración sin secretos y prompts encolados. La activación restaura la salida interrumpida y ofrece los prompts encolados como borradores.",
        "Stop conserva el prompt enviado y el timeline parcial como cancelled; steering y la recuperación de ciclo de vida siguen siendo interrupted. Cada ejecución aceptada publica un único resultado terminal tras persistir.",
        "Un revisor acotado y sin herramientas evalúa una sola vez las finalizaciones textuales prematuras sospechosas. Un segundo resultado incompleto permanece failed/incomplete en lugar de convertirse en una respuesta final falsa.",
      ],
    },
    {
      title: "Herramientas y terminal",
      items: [
        "El estado de herramientas tiene un único ciclo nativo que termina en completed, rejected, cancelled o error; un rechazo no se codifica como error de ejecución.",
        "Las llamadas de una ronda se ejecutan secuencialmente y se bloquean duplicados hasta que cambia la época de mutación del workspace. Ningún modo de permisos tiene un límite arbitrario de rondas o llamadas por bloque. Un revisor sin herramientas recibe actividad acumulada compacta tras 20 rondas y cada cinco posteriores; su recomendación guía la siguiente ronda normal sin desactivar herramientas. Las lecturas pueden solaparse y las mutaciones se serializan por workspace.",
        "En VS Code, cada comando se ejecuta visiblemente en un terminal integrado dedicado mediante Shell Integration que se reutiliza para comandos posteriores y solo se cierra por timeout, cancelación, un directorio de trabajo incorrecto o el apagado de la extensión, conservando salida estructurada y acotada, cancelación, timeout y código de salida. Se rechazan launchers desacoplados y se desactiva la reutilización del servidor de compilación de .NET; los hosts que no son VS Code conservan el ejecutor headless como fallback.",
        "Cada conversación guarda un binding versionado del workspace lógico. Cada ejecución captura una sola vez carpetas, aliases, capacidades y raíz del editor activo; ninguna operación usa el editor actual ni la primera carpeta como fallback.",
        "La autorización acepta rutas ./ del workspace, rechaza padres, rutas absolutas y URI, y resuelve rutas reales y ancestros existentes para impedir escapes por symlinks o junctions.",
        "Los adjuntos externos explícitos son snapshots temporales de solo lectura. No se persisten ni amplían la autorización de herramientas fuera del workspace vinculado.",
        "Un único selector clasifica por firma binaria. Las imágenes usan file IDs de DeepSeek Files API y una caché local de preview que DeepSeek V4.1 Flash consume directamente; ninguna tool intermedia la visión.",
        "Las escrituras confirmadas llevan guardas SHA-256 para que una edición falle si el contenido en disco cambia después de la previsualización.",
        "Los modos automáticos usan una instancia DeepSeek separada, sin analizador local de peligro, para clasificar mutaciones como rutinarias, elevadas o críticas. Recibe la petición inicial, hechos mecánicos de alcance y previews acotadas de archivos explícitos y no sensibles; las decisiones automáticas exigen confianza medium-high o superior.",
        "Las vistas nativas de cambios reconstruyen los documentos anterior y posterior a partir del diff acotado registrado por esa creación, edición o patch, no desde el disco o Git actuales.",
      ],
    },
    {
      title: "API, contexto y persistencia",
      items: [
        "SSE admite comentarios, CRLF, campos data con o sin espacios, eventos multilínea, finalización del decoder, diagnósticos de JSON inválido y cancelación del reader.",
        "Las peticiones a DeepSeek normalizan URLs, usan un timeout de 60 segundos por intento y un máximo de tres intentos para fallos transitorios, respetando Retry-After.",
        "La búsqueda web usa SearXNG. El endpoint loopback predeterminado se apoya en un runtime de plataforma cuya versión, tamaño y digest SHA-256 están fijados en el VSIX; los endpoints compatibles personalizados requieren HTTPS fuera de loopback y no pueden contener credenciales.",
        "Los ajustes, el historial con esquema v2 y los checkpoints con esquema 3 viven bajo ~/.deepseek-agent/. Las credenciales viven separadas en Secret Storage de VS Code por origen normalizado; la webview solo recibe estado enmascarado. Los checkpoints nunca contienen una clave y los historiales o checkpoints incompatibles se eliminan sin migración.",
        "Las peticiones a DeepSeek rechazan URLs con credenciales, exigen HTTPS fuera de loopback, conservan el origen elegido durante redirecciones y eliminan valores sensibles de errores visibles.",
        "Las capacidades registradas de DeepSeek V4.1 Flash usan 1M tokens de contexto total y 384K de salida máxima. La reserva configurada es 384.000 por defecto y reduce el presupuesto de entrada junto con el margen de seguridad.",
        "El contexto tiene presupuestos agregados, detección de binarios, datos Git staged y unstaged, fuentes AGENTS.md acotadas y delimitadores explícitos de datos no confiables.",
      ],
    },
  ],
};
