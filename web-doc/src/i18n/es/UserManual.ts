import type { PageContent } from "../Types";

export const userManual: PageContent = {
  navTitle: "Manual",
  title: "Manual de usuario",
  seoTitle: "Manual: chat, herramientas, permisos",
  description: "Instala la extensión, añade una clave de API y usa el chat, las imágenes, los permisos, las herramientas del workspace, la terminal, el contexto y el historial global.",
  lead: "Configura la API key, elige un modo de permisos y usa DeepSeek desde la barra lateral con control explícito sobre cada operación del workspace.",
  sections: [
    {
      title: "Primeros pasos",
      items: [
        "Guarda los checkpoints de recuperación en history/<chat-id>/checkpoint.json, junto a la conversación y su borrador. Al iniciar, migra generation-checkpoints solo mientras exista, conserva los destinos en conflicto, reanuda archivos ya copiados y elimina la carpeta antigua solo cuando queda vacía. Al finalizar o eliminar una generación se limpia su checkpoint sin borrar la conversación ni su borrador.",
        "Los borradores se guardan en ~/.ycrasy-agent/history/<chat-id>/draft/, o en history/new-chat-draft/ antes de crear la conversación. Cada carpeta contiene draft.json y los archivos de imagen originales. Enviar elimina el borrador enviado; al asignarse un ID se elimina la carpeta provisional, conservando cualquier borrador nuevo que se haya editado. Los borradores vacíos y las conversaciones eliminadas no conservan su carpeta de borrador. Los borradores anteriores de la webview se migran al abrirlos.",
        "Conserva un borrador sin enviar por conversación y otro para Nuevo chat, recuperando texto, archivos e imágenes al cambiar entre ellos. Las imágenes pegadas y capturas de archivos externos se guardan localmente por chat y sobreviven a recargas de la ventana. Se recuperan los archivos originales sin subirlos a DeepSeek hasta enviar el mensaje. El borrador se limpia cuando se muestra el mensaje guardado y borrar una conversación elimina solo su borrador.",
        "Abre YCraSy DeepSeek Agent desde la Activity Bar e introduce la API key en Settings. Las credenciales se guardan por origen de API normalizado en Secret Storage de VS Code; al reabrir Settings solo se muestra una preview enmascarada como placeholder.",
        "Elige thinking mode, reasoning effort, reserva de salida y límite de generaciones concurrentes. El chat usa DeepSeek V4.1 Flash con 1M tokens de contexto total y 384K de salida máxima; la reserva de salida predeterminada es de 384.000 tokens. La concurrencia predeterminada es 8 y admite valores entre 1 y 16.",
        "Escribe ./ para autocompletar rutas seguras del workspace. El recorrido a padres con ../ nunca se acepta. En multi-root, las rutas comienzan por un alias estable como ./frontend/src/App.tsx.",
        "Usa la única acción + o los comandos del explorador/editor para aportar contexto. Los archivos externos ordinarios se convierten en snapshots acotados y de solo lectura; las imágenes se suben a DeepSeek tras verificar su firma binaria.",
        "Usa Stop generation para cancelar la petición actual y su árbol de procesos. El prompt enviado, el timeline parcial y los resultados de tools completadas permanecen como turno cancelled; los efectos ya realizados no se revierten.",
      ],
    },
    {
      title: "Imágenes y visión",
      items: [
        "analyze_images solo está disponible con DeepSeek V4 Pro, que delega el análisis visual a Flash. Flash no tiene acceso a esa herramienta y lee directamente las imágenes incluidas en su contexto visual. Un identificador de captura local no aporta por sí mismo la imagen; las nuevas capturas locales aún no se insertan automáticamente en el contexto de Flash.",
        "El mismo selector acepta archivos de contexto y hasta ocho imágenes JPEG, PNG, GIF o WebP. También pueden pegarse con Ctrl+V o Cmd+V; el portapapeles admite 16 MiB y el selector respeta el límite de DeepSeek de 64 MiB.",
        "DeepSeek V4.1 Flash recibe directamente los file IDs de DeepSeek, por lo que las imágenes del prompt actual se leen en la misma generación que su texto.",
        "Un fallo del proveedor se muestra tal cual: la extensión nunca reintenta en silencio, elimina referencias de imagen ya enviadas ni reescribe el nombre del modelo para que una petición visual fallida parezca correcta.",
        "Las subidas usan DeepSeek Files API con purpose user_data y expiración de 30 días. Base64 solo existe durante el IPC del portapapeles y nunca se guarda en historial ni se incluye en mensajes al proveedor.",
        "Quitar una imagen del borrador intenta borrarla en local y remoto. El borrado permanente de una conversación limpia imágenes solo al terminar la ventana de Deshacer.",
        "Al hacer clic en una imagen adjunta, tanto una miniatura del compositor como una imagen de un mensaje enviado, se abre un visor a pantalla completa. Ajusta la imagen a la ventana de forma predeterminada, conserva su proporción y permite arrastrar una imagen ampliada para desplazarla en lugar de deformarla. Ofrece zoom out, el porcentaje de ajuste (clic para ajustar), zoom in y cerrar, y también responde a Escape, al fondo y a las teclas +, - y 0.",
      ],
    },
    {
      title: "Generaciones concurrentes y colas",
      items: [
        "En cada conversación solo se ejecuta una generación a la vez. Los prompts adicionales de esa conversación se encolan por orden de envío.",
        "Distintas conversaciones pueden generar de forma concurrente hasta el límite global configurado.",
        "Mientras hay una respuesta activa, un único botón muestra Stop con el borrador vacío y Guide cuando contiene texto. Enter reinicia el transporte y continúa la misma tarea bajo la nueva guía; mantener Ctrl cambia el botón a Queue, y Ctrl+Enter añade un borrador independiente tras la respuesta activa. Shift+Enter inserta una línea nueva.",
        "Cambiar de conversación o recrear la webview no mezcla eventos de streaming o herramientas entre ejecuciones; cada evento está asociado a su generación y conversación.",
        "Si VS Code se cierra, la salida parcial se restaura como interrumpida, las herramientas sin finalizar pasan a cancelled y los prompts encolados se ofrecen como borradores recuperables en la siguiente activación.",
      ],
    },
    {
      title: "Permisos y estados de herramientas",
      items: [
        "default confirma cada herramienta; auto-approve ejecuta automáticamente operaciones rutinarias en cualquier ubicación y confirma las elevadas o críticas; full-access ejecuta operaciones rutinarias y elevadas en cualquier ubicación y solo confirma acciones críticas que podrían inutilizar el equipo o causar una pérdida amplia e irreversible.",
        "No existe una matriz de permisos por herramienta. El interruptor de búsqueda web elimina search_web y read_web de las peticiones al modelo cuando está desactivado. El binding y Workspace Trust de VS Code siguen aplicándose.",
        "Las tool calls pasan por awaiting confirmation, running y un único estado final: completed, rejected, cancelled o error.",
        "El host de la extensión confirma las acciones de ejecutar y rechazar antes de que la webview fije el estado visible.",
        "Las tool calls de una ronda se ejecutan secuencialmente. Las llamadas idénticas se omiten hasta que una mutación del workspace hace útil repetirlas. Los ciclos no tienen límites configurables de rondas ni de llamadas por bloque; un revisor independiente comprueba el progreso tras 20 rondas completadas y cada cinco rondas posteriores sin desactivar herramientas.",
        "Las herramientas de solo lectura pueden ejecutarse entre conversaciones concurrentes, mientras que las mutaciones de archivos y terminal se serializan dentro del mismo workspace.",
      ],
    },
    {
      title: "Actividad y resultados de archivos",
      items: [
        "El razonamiento y las tool calls adyacentes aparecen contraídos en un panel Activity de forma predeterminada. Despliégalo para revisar pasos de razonamiento, estados, argumentos y resultados relevantes.",
        "El uso de la conversación aparece en un popover compacto junto al selector de permisos, incluidos totales por modelo tras cambiar de modelo. Si algunas peticiones de DeepSeek omiten el uso, las peticiones informadas aún producen un coste mínimo marcado explícitamente.",
        "Un read_file correcto no duplica el contenido del archivo en Chat. Usa Open file para inspeccionarlo en el editor; las lecturas fallidas sí muestran su diagnóstico.",
        "Las llamadas completadas de create_file, edit_file y apply_patch ofrecen View change cuando existe un diff completo. Abre el contenido anterior y posterior registrado para esa ejecución concreta, independientemente de cambios posteriores en el working tree.",
        "Un turno terminado cierra con el resumen de archivos editados: una fila por archivo escrito con sus adiciones y eliminaciones, Show N more files a partir del cuarto, y Review para abrir todos los cambios del turno. El host registra el contenido anterior y posterior exactos durante la sesión, así que un cambio grande sigue abriéndose completo aunque el diff guardado en el resultado de la tool esté acotado para el contexto del modelo. Revertir un cambio aplicado aún no está implementado.",
        "El coste de uso puede mostrarse en dólares estadounidenses o en yuanes chinos desde Settings → Usage & cost. Cada moneda usa la propia tabla de precios publicada por DeepSeek, así que no se inventa ningún tipo de cambio; los totales persistidos siguen siendo canónicos en USD y se reconvierten para mostrarlos.",
      ],
    },
    {
      title: "Conversaciones largas",
      items: [
        "Un transcript largo no se monta entero. Al abrir solo se renderizan los 40 mensajes más recientes, más cada página de historial que el usuario haya cargado desde disco; Show N earlier messages revela otros 40 de lo que ya está en memoria y mantiene en su sitio el mensaje que estás leyendo en lugar de saltar.",
        "La reconciliación de tool calls, los totales de uso, la persistencia del borrador y la paginación del historial siguen operando sobre la conversación completa cargada; solo se acota la lista renderizada, y las filas memorizadas mantienen fluida la escritura de un borrador.",
      ],
    },
    {
      title: "Vista general del workspace",
      items: [
        "list_workspace dibuja todo el proyecto como un árbol indentado en una sola llamada, así que un chat nuevo no tiene que encadenar llamadas a list_directory. Se incluyen las entradas ocultas, y una carpeta con demasiado contenido se resume como ... en lugar de volcarse o excluirse en silencio.",
        "Su argumento path opcional acota el árbol a una carpeta del workspace. Lee como máximo 300 carpetas y se detiene tras 400 entradas o 48 KiB, resumiendo una carpeta en lugar de listarla cuando contiene más de 25 entradas, o 60 en la raíz del workspace, o cuando su subárbol no cabe en el presupuesto de líneas restante.",
      ],
    },
    {
      title: "Búsqueda de contenido del workspace",
      items: [
        "search_content busca texto literal sin distinguir mayúsculas y minúsculas mediante el sistema de archivos del workspace de VS Code; no ejecuta una shell ni interpreta la consulta como una expresión regular. La consulta debe contener texto y está limitada a 4.096 caracteres.",
        "Su filePattern opcional es un glob relativo al workspace, como *.ts o src/**/*.md. Su valor predeterminado es **/*, admite hasta 1.024 caracteres y rechaza las rutas absolutas y el recorrido a directorios padre.",
        "Se omiten las rutas sensibles, los archivos binarios y los archivos mayores de 2 MiB. Los archivos sensibles se filtran antes de leer su contenido.",
        "Cada búsqueda considera como máximo 10.000 archivos y devuelve hasta 50 coincidencias. Las líneas y la salida total están limitadas, y la respuesta indica archivos analizados, archivos omitidos y si se truncó.",
        "La búsqueda se detiene al cancelar la petición y expira después de 15 segundos.",
      ],
    },
    {
      title: "Funciones beta opcionales",
      items: [
        "En Ajustes → API, Habilitar funciones beta de DeepSeek está desactivado por defecto. Al activarlo se ofrece al agente complete_code para completar un prefijo de respuesta o rellenar un hueco (FIM), y se habilitan los esquemas estrictos de herramientas. Chat Prefix Completion también admite un prefijo de razonamiento proporcionado por quien llama, con el modo de razonamiento activado.",
        "Puedes pedir al agente que rellene el cuerpo de una función mediante FIM o continúe un prefijo concreto. La herramienta devuelve texto y no modifica archivos; las herramientas de edición mantienen sus permisos. La herramienta del agente sigue bajo demanda. Las sugerencias se muestran en gris: Tab acepta y Escape descarta. El editor usa FIM tras una pausa. Las del chat se solicitan solo con Sugerir mensaje, junto al indicador de contexto: genera un mensaje con el borrador vacío o continúa el texto escrito. Otro clic cancela; escribir no solicita sugerencias.",
        "Las peticiones conservan el origen y la credencial configurados y usan la ruta beta. El límite predeterminado es de 1.024 tokens de salida, con un máximo de 4.096 o el límite configurado si es menor. El consumo aparece en Completación beta de código. Desactivar bloquea nuevas llamadas beta y devuelve las siguientes rondas de herramientas al chat estable; las peticiones en curso pueden terminar. Al activar, la herramienta está disponible para las nuevas generaciones.",
        "Clic derecho en un editor → YCraSy DeepSeek Agent → Completar o Refactorizar. La selección tiene prioridad; una línea vacía toma el archivo completo; en otro caso se usa el símbolo más pequeño que contiene el cursor, con una sentencia o línea como alternativa. Revisa el diff y elige Aplicar o Descartar. Los cambios admiten deshacer y no sobrescriben un documento que haya cambiado. Completar requiere beta; Refactorizar usa la API estable.",
        "Las sugerencias del editor envían código cercano acotado. Las del chat envían el borrador con metadatos breves del proyecto (carpetas, nombres de primer nivel y nombre/descripción de package.json), sin código fuente ni historial, y se ejecutan solo al pulsar el botón del chat. Se ejecutan sin razonamiento, con 256/96 tokens de salida y cancelación/caché. Consumen API; el tooltip de DeepSeek en la barra de estado muestra este uso separado del chat. Requieren confianza en el workspace y excluyen nombres de archivos sensibles. Desactivar beta detiene estas peticiones.",
      ],
    },
    {
      title: "Privacidad",
      items: [
        "Ajustes → General → Privacidad activa por defecto la minimización de metadatos como mejor esfuerzo: los avisos automáticos omiten las rutas absolutas del workspace, no se envían identificadores opcionales de usuario ni nombres de imágenes, y las fechas usan UTC sin el nombre de la zona horaria local. Se conservan las rutas relativas y las referencias necesarias para las herramientas. No anonimiza mensajes, código, salidas de herramientas, contenido o metadatos incrustados en imágenes ni el historial existente. No garantiza anonimato ni cumplimiento del RGPD. No se recopila telemetría de uso; el proveedor API sigue recibiendo los datos necesarios para responder y la IP de conexión.",
      ],
    },
    {
      title: "Capturas de interfaces web",
      items: [
        "La lectura y las capturas web usan Chrome, Chromium, Edge, Brave o Vivaldi instalado en el host de la extensión. Se inicia un proceso headless con perfil temporal, sin abrir tu sesión personal. Los permisos de captura se controlan en Ajustes → Herramientas.",
        "Si no encuentra un navegador compatible, descarga Chrome Headless Shell desde la distribución Chrome for Testing de Google al almacenamiento global de la extensión, fuera del VSIX. La primera instalación requiere red y varios cientos de MB libres. Durante el uso comprueba actualizaciones estables como máximo una vez al día; si fallan, conserva la versión instalada. Mantiene la versión actual y la anterior. No actualiza los navegadores del usuario.",
        "En workspaces remotos, el navegador se ejecuta en el host de la extensión. Linux necesita las bibliotecas de Chromium y un sandbox funcional; la extensión no instala paquetes del sistema ni desactiva el sandbox. La descarga gestionada admite Windows x86/x64, macOS Intel/Apple Silicon y Linux x64. Linux ARM necesita un Chromium del sistema.",
      ],
    },
    {
      title: "Capturas de ventanas nativas",
      items: [
        "Las capturas de ventanas Wayland aplican el rectángulo de píxeles válido que entrega PipeWire antes de guardar el PNG. Así se elimina el relleno del compositor alrededor de una ventana pequeña sin escalarla ni recortar zonas negras de la aplicación. Se rechazan los rectángulos inválidos. Se necesita el plugin videocrop de GStreamer junto a pipewiresrc, videoconvert y pngenc; en Ubuntu viene en gstreamer1.0-plugins-good.",
        "En Wayland, cada captura de ventana o depuración abre el selector del sistema. Elige la ventana de la aplicación que quieres probar. La extensión obtiene una sola imagen PNG mediante XDG ScreenCast/PipeWire y cierra la sesión de compartir al terminar. El portal no permite seleccionar ni verificar por título o PID; el resultado indica que la ventana la ha elegido el usuario, sin atribuirle una identidad no comprobada. Cancelar o fallar una selección nunca recurre a un monitor completo; las solicitudes de pantalla completa siguen necesitando confirmación explícita.",
        "El equipo donde se ejecuta la extensión necesita un portal ScreenCast v3+ compatible con ventanas, /usr/bin/python3 con PyGObject/Gio/GStreamer y los plugins pipewiresrc, videoconvert y pngenc. En Ubuntu los proporcionan python3-gi, gir1.2-gstreamer-1.0, gstreamer1.0-pipewire, gstreamer1.0-plugins-base y gstreamer1.0-plugins-good. No se descargan ni instalan dependencias automáticamente. X11, Windows y macOS conservan sus sistemas de captura propios. La selección del portal no se reutiliza para capturas automáticas.",
      ],
    },
    {
      title: "Búsqueda web",
      items: [
        "La búsqueda usa DeepSeek Search con la credencial del origen configurado. La lectura de páginas y las capturas web usan un Chromium instalado o Chrome Headless Shell, que se descarga y actualiza automáticamente si falta. No se abre el perfil personal del navegador.",
        "La búsqueda está orientada al desarrollo: prioriza documentación de las versiones del proyecto, repositorios originales y discusiones pertinentes. Solicita ocho resultados por defecto, admite hasta 50 y conserva los datos disponibles de relevancia, autoridad y fecha en una salida acotada. Consulta y operadores deben caber en 128 caracteres Unicode. Las fuentes técnicas en inglés siguen disponibles salvo que restrinjas el idioma explícitamente.",
        "read_web reutiliza contenido de Search o lecturas anteriores de la generación; si falta, renderiza localmente la página HTTPS pública autorizada. Solo acepta URLs de búsquedas de la generación actual o proporcionadas explícitamente por ti. Devuelve secciones acotadas y tratadas como datos no fiables.",
        "En Ajustes → Herramientas, la búsqueda es Global por defecto. Elige Automático para usar el país configurado en el sistema local, o un código como ES. Puedes pedir otro país o una búsqueda mundial en el chat. Es una preferencia de relevancia y no garantiza el orden geográfico de los resultados. La región del sistema no equivale a ubicación física. No se consulta ni se añade la IP a los parámetros de búsqueda; el proveedor API sigue viendo la dirección de conexión habitual.",
        "Las peticiones de Search se facturan aparte de los tokens; la lectura local no llama al endpoint Fetch de pago. El panel de uso de tokens no incluye los cargos de búsqueda. Consulta las tarifas oficiales vigentes.",
      ],
    },
    {
      title: "Ejecución de terminal",
      items: [
        "Para una interfaz nativa o un servidor local que deba seguir abierto durante la captura, DeepSeek usa application_session: start lanza el comando en primer plano y devuelve un sessionId mientras continúa; status consulta la salida de arranque acotada; stop cierra esa sesión. Las herramientas se ejecutan en secuencia, por lo que un preview con timeout en run_terminal_command bloquearía la captura hasta que la aplicación se cierre. El flujo es compilar, iniciar, capturar y detener. Que el proceso esté en marcha no demuestra que la interfaz esté lista o sea correcta. Estas sesiones usan el shell del sistema y aparecen en las actividades sin abrir otra pestaña de terminal. Los hosts de preview que vigilan stdin siguen conectados hasta el cierre. Se aíslan por turno y chat, admiten tres aplicaciones simultáneas y ocho arranques por turno, y se cierran tras diez minutos o al terminar el turno, cancelar, borrar el chat o cerrar la extensión. Los arranques conservan la revisión del comando y los permisos del workspace.",
        "Cada comando del agente se ejecuta de forma no interactiva y visible en un terminal integrado de VS Code mediante Shell Integration. Cada chat reutiliza un único terminal al cambiar de directorio y conserva su scrollback. Los paginadores de Git y por defecto se desactivan para que los comandos no queden esperando pulsaciones. Borrar un chat cierra su terminal aunque el chat no esté seleccionado, sin afectar a otros chats ni a terminales manuales. Los terminales del agente también se cierran por timeout, cancelación o al apagar la extensión, y no se restauran al recargar o reiniciar el editor. Los resultados capturados se conservan mientras exista la conversación.",
        "El resultado registra stdout/stderr acotados, código de salida, señal, timeout, cancelación, directorio efectivo y shell.",
        "La salida está limitada; si se trunca, se conservan el principio y el final y se marca la parte central omitida.",
        "Se rechazan los launchers de procesos desacoplados o en segundo plano. Los terminales del agente desactivan la reutilización de servidores de compilación y nodos de .NET para no dejar workers huérfanos ni archivos del proyecto bloqueados.",
        "En los modos automáticos, una instancia DeepSeek separada clasifica los comandos de terminal y las mutaciones de archivos como rutinarios, elevados o críticos; no existe un analizador local de peligro.",
        "El revisor recibe la petición inicial, una descripción de la acción sin contenido, hechos mecánicos de alcance y contexto acotado y no sensible de archivos del workspace nombrados explícitamente.",
        "El revisor puede aprobar, devolver restricciones para replanificar o pedir confirmación manual. Auto-approve confirma acciones elevadas y críticas; full-access confirma las críticas. Las decisiones automáticas exigen confianza medium-high o superior.",
      ],
    },
    {
      title: "Historial y privacidad",
      items: [
        "Los ajustes generales se guardan en ~/.ycrasy-agent/settings.json y los de DeepSeek en ~/.ycrasy-agent/deepseek/settings.json. Ajustes → General → Persistencia permite escribir o seleccionar la carpeta de datos y aplicarla al recargar VS Code. Predeterminada restaura .ycrasy-agent dentro de la carpeta personal en Linux/macOS o %USERPROFILE% en Windows. Los datos existentes permanecen en su carpeta anterior. Las credenciales permanecen en Secret Storage de VS Code, aisladas por origen normalizado, y nunca forman parte de WebviewConfig, historial o checkpoints.",
        "Elimina automáticamente las carpetas obsoletas runtimes/ y runtime-state/ completas al iniciar, antes de migrar la carpeta de datos antigua. Conserva ajustes, historial, snapshots e instrucciones. No deja un script independiente; omite carpetas ausentes y reintenta la limpieza fallida en otro arranque.",
        "El historial se guarda globalmente bajo ~/.ycrasy-agent/history/ y cada entrada muestra su workspace de origen. La primera activación tras actualizar mueve automáticamente el contenido de ~/.deepseek-agent/ a la nueva raíz y elimina la carpeta antigua vacía; los conflictos con datos de destino se conservan y se notifican.",
        "Puede deshabilitarse y su retención puede configurarse entre 0 días (solo borrado manual) y 3650 días. El valor predeterminado es 30 días.",
        "Desactivar el historial activa el modo incógnito. Si hay generaciones activas o mensajes en cola, se pide confirmación antes de detenerlos y vaciarlos. Los chats incógnitos solo viven en memoria, sobreviven al cambio entre Chat, Historial y Ajustes, y se descartan al recargar la extensión o VS Code. Al salir, el chat puede guardarse explícitamente como una conversación nueva o descartarse.",
        "La lista se reconstruye directamente desde archivos de conversación validados. El almacenamiento está limitado a 100 conversaciones y 24 MiB.",
        "Borrar una conversación o todas las visibles usa confirmación nativa y ofrece Deshacer. Primero cancela el trabajo activo y limpia cola/checkpoint; las imágenes no se eliminan hasta que vence Deshacer para que la restauración sea completa.",
        "Los archivos de conversación deben usar el esquema versión 2 con un binding de workspace completo y resúmenes de contexto actuales; cada conversación vive en history/<id>/ como un manifest más fragmentos de mensajes con numeración autoincremental. Al activar, cada conversación incompatible, mal formada, demasiado grande o con numeración discordante se elimina permanentemente, incluidos los archivos planos heredados y el directorio obsoleto .segments; no se migran formatos de conversación incompatibles.",
        "El trabajo activo se guarda sin la API key en checkpoints bajo ~/.ycrasy-agent/history/<chat-id>/checkpoint.json. Las herramientas pending o running interrumpidas se restauran como cancelled; solo se recuperan checkpoints de esquema 3 con un binding de workspace completo y los registros incompatibles se eliminan.",
      ],
    },
    {
      title: "Contexto del workspace",
      items: [
        "Cada chat guarda copias reales recuperables directamente en ~/.ycrasy-agent/snapshoots/<id-del-chat>/, sin una carpeta workspace adicional. Los datos auxiliares y las versiones anterior y posterior de los turnos con cambios quedan en la carpeta oculta .snapshot/. Antes de cada mensaje se avisa de los cambios externos; tras el turno se actualiza la copia, sin reenviar el editor activo ni los diffs de Git.",
        "Usa Revisar cambios y Revertir turno bajo una respuesta, o Revert Turn en el editor de diferencias guardadas. También puedes pedir a DeepSeek que deshaga su último turno con revert_workspace. Se conservan los cambios previos al turno y se rechaza sobrescribir ediciones posteriores o editores sin guardar; no se reinician los commits ni el índice de Git. En incógnito solo se detectan cambios en memoria, sin copias recuperables en disco.",
        "La cuota total de capturas es de 1024 MiB por defecto y se puede cambiar en Ajustes generales. Se reservan al menos 100 MiB libres en disco. Si falta espacio, el mensaje continúa con un aviso visible de que ese turno no podrá revertirse y se conservan las copias anteriores. Se respetan los archivos ignorados de cada repositorio aunque el workspace sea una carpeta que agrupa varios proyectos, incluidos worktrees y submódulos. El límite de 50.000 archivos cuenta solo rutas elegibles para la copia. Se excluyen node_modules y artefactos generados según el proyecto: bin/obj de .NET, dist/build/out web y target de Rust/Java. Las carpetas bin con código propio se conservan. Borrar un chat elimina sus capturas.",
        "Los archivos referenciados y las instrucciones AGENTS.md tienen límites de tamaño, usan etiquetas relativas al workspace y se delimitan como datos no confiables.",
        "Ajustes → Personalización contiene Usar las instrucciones globales de AGENTS.md. Al habilitarlo aparece Editar AGENTS.md global, que crea el archivo si falta y lo abre en el editor de texto de VS Code. Usa AGENTS.md en la carpeta de datos activa (por defecto ~/.ycrasy-agent/), conserva el contenido existente y aplica las ediciones guardadas a los mensajes siguientes en todos los workspaces.",
        "Instrucciones del workspace muestra Generar AGENTS.md si falta el archivo en la raíz, o Editar AGENTS.md si ya existe. Generar crea una plantilla editable sin contactar con DeepSeek y la abre en VS Code; el contenido existente se conserva. Si hay varias carpetas locales, selecciona el workspace. El botón se actualiza al crear o eliminar el archivo y funciona independientemente de las instrucciones globales.",
        "Personalización → Instrucciones → Crear instrucción crea y abre una plantilla Markdown editable, por ejemplo commit.md. Elige Global (instructions/ en la carpeta de datos activa) o un workspace (instructions/ en su raíz), indica el nombre y describe cuándo debe usarse. La descripción se guarda en el frontmatter; el cuerpo contiene las reglas, como idioma del commit, prefijos fix:/feature:, formato del ticket y comprobaciones. Los archivos existentes se abren sin sobrescribirlos y pueden editarse desde la lista. DeepSeek recibe un catálogo acotado con nombres, ámbitos y descripciones, y lee las instrucciones completas pertinentes mediante read_instruction antes de la tarea. Las globales funcionan independientemente del toggle del AGENTS.md global; una instrucción del workspace con el mismo nombre prevalece en ese proyecto. Los límites son 128 entradas de catálogo y 64 KiB por archivo; no se siguen enlaces simbólicos.",
        "La sección Instrucciones ofrece tres plantillas: Blank.md (sección de reglas vacía), git.md (estado del repositorio, flujo de ramas e integración y comprobaciones) y commit.md (idioma del mensaje, formato fix:/feature: o [ticket], cambios en staging y comprobaciones). Elige la plantilla antes de crear; Git y commit rellenan el nombre y cuándo utilizarla, ambos editables. Puedes renombrar el archivo sin cambiar la plantilla seleccionada. Se crea localmente y se abre en VS Code sin llamadas al modelo; los archivos existentes nunca se sustituyen.",
        "El campo de nombre contiene solo el nombre base y muestra el sufijo fijo .md fuera del texto editable. Otras extensiones forman parte del nombre: commit.txt crea commit.txt.md. Las instrucciones existentes se agrupan en plegables independientes Global y Workspace, cada uno con su contador; las del workspace muestran el nombre del proyecto.",
        "Escribe ./com en el chat para buscar archivos del workspace e instrucciones coincidentes. Las sugerencias se separan en Archivos e Instrucciones; Instrucciones contiene Workspace y Global. Selecciona con las flechas y Enter/Tab o con un clic. Los archivos y carpetas mantienen su comportamiento. Elegir una instrucción inserta una referencia inequívoca, como ./@instructions/global/commit.md o ./@instructions/workspace/project/commit.md. Son referencias del chat, no rutas en disco. Al enviar, la extensión valida la referencia contra el workspace del chat, lee el archivo guardado actual y adjunta sus reglas al turno; una referencia normal a un archivo no selecciona instrucciones. Las reglas seleccionadas se conservan en el contexto para las continuaciones. Puedes seleccionar hasta ocho instrucciones y un total de 128 KiB. Si una instrucción se elimina, queda obsoleta o no está disponible, debe seleccionarse de nuevo.",
        "Los ajustes de la extensión y el AGENTS.md global permanecen en la carpeta de datos local seleccionada. No se sincronizan mediante la cuenta de VS Code. Los archivos de instrucciones globales y del workspace siguen siendo editables desde Personalización.",
        "El presupuesto total incluye system prompts, esquemas de herramientas, historial, referencias, salida reservada y margen de seguridad. Las generaciones antiguas completas se resumen de forma atómica y los archivos grandes se reducen a rangos de líneas literales relevantes. Nunca se truncan argumentos, razonamiento obligatorio ni ciclos de herramientas activos.",
        "Selecciona el modelo y el modo de permisos desde los controles del chat. Usa Review Changes en el menú contextual del editor o en Control de código fuente para adjuntar el diff de Git y solicitar una revisión, y empieza una conversación nueva con el botón +.",
      ],
    },
  ],
};
