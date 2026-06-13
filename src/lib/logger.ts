const logger = {
  log:   (...args: unknown[]) => console.log(...args),
  info:  (...args: unknown[]) => console.info(...args),
  warn:  (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
}

export default logger
