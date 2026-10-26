[Back](INDEX.md)

# Browser for web reads and screenshots

The extension looks for an installed Chrome, Chromium, Edge, Brave or Vivaldi on the extension host. It launches its own headless process with a temporary profile, without using personal tabs, cookies or sessions. Both webpage reads and web screenshots use this browser; DeepSeek remains the search provider, but webpage reads do not use the DeepSeek Fetch endpoint.

If no supported browser is found, the extension downloads Chrome Headless Shell from Google's Chrome for Testing distribution into VS Code's extension global storage, outside the VSIX. While in use, it checks the stable channel at most once a day and keeps the installed version if an update cannot be downloaded. Initial installation requires network access and several hundred MB of free disk space. User-installed browsers are never updated by the extension.

In remote workspaces, detection and installation happen on the extension host. Linux still requires Chromium's shared libraries and a working sandbox; the extension does not install system packages or disable the sandbox. The managed download supports Windows x86/x64, macOS Intel/Apple Silicon and Linux x64. Linux ARM hosts need a system Chromium browser.
