[Back](INDEX.md)

# IDE móvil (MVP)

DeepSeek Agent Mobile es una app de Tauri. El chat y la revisión de cambios se abren dentro de la app. El servicio de la extensión escucha en `127.0.0.1:43189` y necesita que VS Code siga abierto. La clave de DeepSeek se usa en el PC. El código de conexión se guarda en memoria y cambia al reiniciar el servicio.

## Conectar el móvil

1. Instala el VSIX de esta rama en VS Code de escritorio, o ejecuta la extensión desde el clon con `npm ci` y **F5**.
2. Abre una carpeta local de confianza con Git. Configura DeepSeek en la extensión para usar el chat.
3. Ejecuta **YCraSy DeepSeek Agent: Iniciar IDE móvil (MVP)** y pulsa **Copiar código**.
4. Con ambos dispositivos en la misma red privada de Tailscale, ejecuta `tailscale serve --https=43189 http://127.0.0.1:43189` en el PC. Introduce en la app la URL HTTPS que imprime Serve y el código de VS Code. [Documentación de Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
5. Al terminar, ejecuta **Detener IDE móvil** y cierra Serve con **Ctrl+C**.

También puedes abrir esa URL en un navegador. Para probar en el propio PC, el comando de VS Code ofrece **Abrir en este PC**.

## Probar el flujo

- **Chat**. Envía una consulta y una pregunta de seguimiento. La conversación es temporal, separada del chat de escritorio y compartida por los clientes conectados con el mismo código.
- **Cambios**. Modifica un archivo del proyecto desde el PC y guarda. Abre **Cambios** en la app, selecciona el archivo y compara lo preparado en el índice con las ediciones sin preparar. Los archivos nuevos sin seguimiento aparecen en la lista y los cambios sin guardar en el editor de VS Code aparecen después de guardarlos en disco.
- **Archivos**. Busca y edita archivos de texto UTF-8 existentes y versionados de hasta 128 KiB. Si cambian en el PC durante la edición móvil, el guardado se rechaza y el borrador permanece abierto.

## Compilar la app

Usa Node.js 24 y los [prerrequisitos móviles de Tauri](https://v2.tauri.app/start/prerequisites/). Para Android, configura Java, Android SDK, NDK y el target de Rust `aarch64-linux-android`. Desde el clon:

```bash
cd mobile
npm ci
npm run tauri -- android init --ci --skip-targets-install
npm run tauri -- android build --debug --apk --target aarch64
```

El APK de depuración para dispositivos ARM64 se genera bajo `mobile/src-tauri/gen/android/app/build/outputs/apk`. Para iOS, Tauri requiere macOS y Xcode.

[Back](INDEX.md)
