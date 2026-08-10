// Runnable smoke test for Wallpaper Forge's only external encoder.
import gifenc from 'gifenc'

const { GIFEncoder, quantize, applyPalette } = gifenc
const width = 2
const height = 2
const frames = [
  new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255]),
  new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255]),
]
const gif = GIFEncoder()

for (const rgba of frames) {
  const palette = quantize(rgba, 256)
  gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: 83, repeat: 0 })
}
gif.finish()

const bytes = gif.bytes()
const header = new TextDecoder().decode(bytes.slice(0, 6))
if (header !== 'GIF89a' || bytes.at(-1) !== 0x3b) {
  throw new Error('GIF encoder self-check failed')
}

console.log(`✓ encoded a valid ${frames.length}-frame GIF (${bytes.length} bytes)`)
