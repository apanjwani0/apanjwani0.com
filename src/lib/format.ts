/** Human-readable byte count ("512 B", "1.5 KB", "2.0 MB"); `kbDigits` sets the KB decimals. */
export function formatBytes(n: number, kbDigits = 1): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(kbDigits)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
