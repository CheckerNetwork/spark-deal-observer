import { createApp } from '../lib/app.js'
import { DATABASE_URL } from '@filecoin-station/deal-observer-db'

const {
  PORT = '8080',
  HOST = '127.0.0.1',
  REQUEST_LOGGING = 'true'
} = process.env

const app = createApp({
  databaseUrl: DATABASE_URL,
  logger: {
    level: ['1', 'true'].includes(REQUEST_LOGGING) ? 'info' : 'error'
  }
})
console.log('Starting the http server on host %j port %s', HOST, PORT)
const serverUrl = await app.listen({ host: HOST, port: Number(PORT) })
console.log(serverUrl)
