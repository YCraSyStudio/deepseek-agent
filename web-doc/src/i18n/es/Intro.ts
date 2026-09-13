import type { PageContent } from "../Types";

export const intro: PageContent = {
  navTitle: "Introducción",
  title: "Introducción",
  seoTitle: "Extensión DeepSeek: introducción",
  description: "Qué es YCraSy DeepSeek Agent, en qué canal de versiones se publica y qué incluye la pre-versión actual.",
  lead: "YCraSy DeepSeek Agent solo usa DeepSeek por diseño. Ofrece un asistente enfocado dentro de VS Code sin selector de proveedores.",
  sections: [
    {
      title: "Canales de publicación",
      items: [
        "Las líneas de versión alternan por número minor: las líneas minor impares (0.1.x, 0.3.x, ...) son builds pre-release que mantienen el flag preview: true de la galería, y las líneas minor pares (0.2.x, 0.4.x, ...) son versiones estables con preview: false. Esta documentación describe la línea pre-release 0.1.x actual.",
        "La línea 0.1.x no es estable. Los errores que aparecen en el uso diario se corrigen y se publican como parches incrementales (0.1.14, 0.1.15, ...), y la línea pasa a 0.2.x solo cuando el uso diario deja de reportar errores.",
        "Las actualizaciones pre-release pueden cambiar el formato de almacenamiento de las conversaciones y dejar inaccesibles los chats creados por versiones 0.x anteriores. Copia o exporta cualquier conversación que quieras conservar antes de actualizar.",
      ],
    },
    {
      title: "Alcance actual de la pre-release",
      items: [
        "Chat lateral con respuestas, razonamiento y tool calls transmitidos y renderizados en orden cronológico.",
        "El razonamiento y las tools permanecen compactos en grupos Activity desplegables; las tools de archivo abren el archivo afectado o el cambio exacto registrado en el editor nativo.",
        "Un turno terminado cierra con el resumen de archivos editados, cuyas filas abren el cambio registrado de cada archivo escrito, y el coste de uso puede mostrarse en dólares estadounidenses o en yuanes chinos desde Settings.",
        "list_workspace dibuja todo el proyecto como un árbol indentado en una sola llamada, incluidas las entradas ocultas, para que un chat nuevo no tenga que encadenar listados de directorios.",
        "Las conversaciones largas solo renderizan sus mensajes más recientes y revelan los anteriores bajo demanda, manteniendo ágiles el scroll y la escritura.",
        "Las imágenes adjuntas abren un visor ampliado que ajusta, hace zoom y puede arrastrarse para desplazarse conservando la proporción de la imagen.",
        "Thinking mode puede activarse o desactivarse sin desactivar las herramientas.",
        "DeepSeek V4.1 Flash lee directamente las imágenes subidas, tanto en el chat como en las rondas de herramientas.",
        "Una única acción permite adjuntar archivos de contexto e imágenes JPEG, PNG, GIF o WebP; también se pueden pegar con Ctrl+V o Cmd+V.",
        "Default confirma cada herramienta, auto-approve ejecuta automáticamente las operaciones rutinarias y confirma las elevadas, y full-access solo confirma acciones críticas que podrían dañar ampliamente el equipo.",
        "El autocompletado seguro aparece solo al escribir ./; contexto automático, Git, instrucciones, terminal y herramientas usan el mismo snapshot inmutable del workspace lógico.",
        "Los ajustes y el historial global se guardan bajo ~/.deepseek-agent/ con retención configurable, confirmación nativa de borrado y Deshacer.",
        "Stop conserva el prompt enviado, el timeline parcial y los resultados de herramientas completadas como turno cancelled. Steering reinicia el transporte de forma segura, pero continúa explícitamente la tarea original bajo la última guía sin mostrar un aviso de interrupción engañoso.",
        "Las credenciales se aíslan por origen en Secret Storage de VS Code y nunca vuelven a la webview; Settings solo muestra una preview enmascarada como placeholder.",
      ],
    },
    {
      title: "No afiliación",
      items: [
        "Esta es una extensión independiente de terceros. No está afiliada, avalada, patrocinada ni mantenida oficialmente por DeepSeek.",
      ],
    },
  ],
};
