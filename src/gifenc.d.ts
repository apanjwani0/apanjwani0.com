// gifenc ships no types, so this is hand-written against node_modules/gifenc/src.
// Keep it matching that source: it was written with two-argument `quantize` and
// `applyPalette`, which type-checked fine right up until the pixel format was
// needed — the third argument each really takes was simply absent from the
// declaration, so passing it was a compile error against a call the library
// supports. A hand-written declaration that is narrower than the library is a
// silent liability; widen it here rather than casting at the call site.
declare module 'gifenc' {
  type Palette = number[][]

  /** Bits per channel used to bucket colour before clustering. */
  type PixelFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  interface QuantizeOptions {
    format?: PixelFormat
    clearAlpha?: boolean
    clearAlphaColor?: number
    clearAlphaThreshold?: number
    oneBitAlpha?: boolean
  }

  interface FrameOptions {
    palette?: Palette
    delay?: number
    repeat?: number
  }

  interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void
    finish(): void
    bytes(): Uint8Array
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): Encoder
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): Palette
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: PixelFormat,
  ): Uint8Array
}
