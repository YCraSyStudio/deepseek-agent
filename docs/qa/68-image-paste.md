# Clipboard image preview (#68)

Paste shows an object-URL preview before file reading starts. Upload completions are matched by request ID, and pending images prevent sending or steering. Removing a pending preview immediately releases its URL and discards/deletes any later remote upload, including after navigation. Read/upload failure removes the pending preview and surfaces the existing error. Pending previews are not persisted or sent to the model.

Manual QA: slow network, failed upload, unreadable clipboard file, several images finishing out of order, remove while uploading, navigate during upload, 8-image and 16-MiB clipboard limits. Check send/steer remain disabled until all visible uploads finish.
