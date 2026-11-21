export const workspace = {
  "workspace": {
    "navigation": "Workspace views",
    "files": "Files",
    "editor": "Editor",
    "chat": "Chat",
    "refresh": "Refresh",
    "filter": "Filter files",
    "save": "Save",
    "attach": "Add to chat",
    "discard": "Discard",
    "openFile": "Open a file to edit it.",
    "discardConfirm": "Discard unsaved changes?",
    "saved": "File saved.",
    "conflict": "The file changed on the PC. Your draft is still here.",
    "unsaved": "Save or discard your changes before opening another file.",
    "requestFailed": "The workspace request failed (HTTP {status}).",
    "fileMissing": "The file no longer exists on the PC. The file list has been refreshed.",
    "fileNotTracked": "Only files tracked by Git in this folder can be opened. Add it to the repository on the PC.",
    "fileSymlink": "The file is a link or lives outside the folder, so it cannot be opened.",
    "connectionFailed": "The workspace connection was interrupted. Try again.",
    "referenceUnavailable": "The file belongs to a different workspace. Open a chat for this workspace."
  }
} as const;
