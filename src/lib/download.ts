/**
 * Save-to-disk helpers shared by every tool and game that exports a file.
 * Client-only: both touch `document` when called, never at module scope.
 */

/** Click a temporary link at `url`, saving it as `filename`. */
export function downloadDataUrl(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Save a Blob. The object URL is revoked a second later: revoking sooner races
 * the click's navigation in some engines and saves an empty file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  downloadDataUrl(url, filename)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
