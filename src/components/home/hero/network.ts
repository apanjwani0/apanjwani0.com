// PLACEHOLDER: replaced by the network port (hero-lab network.js).
import type { HeroCreate } from './types'

export const create: HeroCreate = (host) => ({
  start: () => {},
  stop: () => {},
  resize: () => {},
  destroy: () => host.replaceChildren(),
})
