import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

// App logger: pretty in dev. Swap the transport for plain JSON in production.
export const logger = pino(
  isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } },
)

// Baileys is extremely chatty at info/debug. Keep it quiet unless debugging.
export const baileysLogger = pino({ level: 'warn' })
