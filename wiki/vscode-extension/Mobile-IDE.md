[Back](INDEX.md)

# IDE móvil (MVP)

DeepSeek Agent Mobile es una app de Tauri que se conecta al IDE del PC por SSH. El chat y la revisión de cambios se abren dentro de la app. El servicio de la extensión escucha solo en `127.0.0.1:43189` y necesita que VS Code siga abierto. La app abre un canal `direct-tcpip` por SSH hasta ese puerto, así que el servicio no se expone a la red y el tráfico viaja cifrado por SSH. La clave de DeepSeek se usa en el PC. El código de conexión se guarda en memoria y cambia al reiniciar el servicio.

## Conectar el móvil

1. Instala el VSIX de esta rama en VS Code de escritorio, o ejecuta la extensión desde el clon con `npm ci` y **F5**.
2. Abre una carpeta local de confianza con Git. Configura DeepSeek en la extensión para usar el chat.
3. Comprueba que el PC acepta SSH (`sudo systemctl enable --now ssh` y `ssh localhost`).
4. Ejecuta **YCraSy DeepSeek Agent: Iniciar IDE móvil (MVP)** y pulsa **Copiar código**.
5. En la app introduce el host o la IP del PC, el puerto SSH (22 por omisión), tu usuario del PC y el método de autenticación: contraseña o una clave privada OpenSSH sin passphrase. Pega también el código de VS Code.
6. La app fija la clave del servidor SSH por su huella SHA-256 en la primera conexión. Si el PC cambia de clave, la conexión se rechaza y muestra qué fichero borrar del directorio de configuración de la app.
7. Al terminar, pulsa **Desconectar** en la app y ejecuta **Detener IDE móvil** en VS Code.

La contraseña y la clave privada solo se usan en memoria durante la conexión; no se guardan en disco.

Sin la app también puedes abrir `http://127.0.0.1:43189/` en un navegador del propio PC; el comando de VS Code ofrece **Abrir en este PC**.

## Probar el flujo

- **Chat**. Envía una consulta y una pregunta de seguimiento. La conversación es temporal, separada del chat de escritorio y compartida por los clientes conectados con el mismo código.
- **Cambios**. Modifica un archivo del proyecto desde el PC y guarda. Abre **Cambios** en la app, selecciona el archivo y compara lo preparado en el índice con las ediciones sin preparar. Los archivos nuevos sin seguimiento aparecen en la lista y los cambios sin guardar en el editor de VS Code aparecen después de guardarlos en disco.
- **Archivos**. Busca y edita archivos de texto UTF-8 existentes y versionados de hasta 128 KiB. Si cambian en el PC durante la edición móvil, el guardado se rechaza y el borrador permanece abierto. La lista se actualiza sola al abrir la pestaña, al volver a la app y cada pocos segundos mientras está visible; los archivos nuevos aparecen en cuanto el PC los versiona y los borrados desaparecen de la lista. Al abrir, el PC comprueba ese archivo concreto contra Git y el disco: si ya no existe, si no está versionado o si es un enlace, el móvil explica el motivo y actualiza la lista en lugar de mostrar un 404 genérico.

## Compilar la app

Usa Node.js 24 y los [prerrequisitos móviles de Tauri](https://v2.tauri.app/start/prerequisites/). Para Android, configura Java, Android SDK, NDK y el target de Rust `aarch64-linux-android`. Desde el clon:

```bash
cd legacy/tauri
npm ci
npm run tauri -- android init --ci --skip-targets-install
npm run tauri -- android build --debug --apk --target aarch64
```

El APK de depuración para dispositivos ARM64 se genera bajo `legacy/tauri/src-tauri/gen/android/app/build/outputs/apk`. Para iOS, Tauri requiere macOS y Xcode.

[Back](INDEX.md)
