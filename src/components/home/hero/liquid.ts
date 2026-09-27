// PLACEHOLDER: replaced by the liquid-light port (hero-lab r5/liquid.js).
import { createClock } from './clock'
import type { HeroCreate } from './types'

export const create: HeroCreate = (host, env) => {
  const clock = createClock(host, env, () => {})
  return {
    start: () => clock.start(),
    stop: () => clock.stop(),
    resize: () => {},
    destroy: () => { clock.destroy(); host.replaceChildren() },
  }
}
