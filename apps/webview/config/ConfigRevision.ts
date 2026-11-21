export function shouldApplyConfigRevision(currentRevision: number, incomingRevision: number): boolean {
  return Number.isSafeInteger(incomingRevision) && incomingRevision >= currentRevision;
}
