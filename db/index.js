import pg from 'pg'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Postgrator from 'postgrator'

// re-export types
/** @typedef {import('./typings.js').Queryable} Queryable */
/** @typedef {import('./typings.js').PgPool} PgPool */
/** @typedef {import('./typings.js').UnknownRow} UnknownRow */
/** @typedef {import('./typings.js').QueryResultWithUnknownRows} QueryResultWithUnknownRows */

// Configure node-postgres to deserialize BIGINT values as BigInt, not String
pg.types.setTypeParser(20, BigInt) // Type Id 20 = BIGINT | BIGSERIAL

const {
  // DATABASE_URL points to `spark_deal_observer` database managed by this monorepo
  DATABASE_URL = 'postgres://localhost:5432/spark_deal_observer'
} = process.env

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations'
)

const poolConfig = {
  // allow the pool to close all connections and become empty
  min: 0,
  // this values should correlate with service concurrency hard_limit configured in fly.toml
  // and must take into account the connection limit of our PG server, see
  // https://fly.io/docs/postgres/managing/configuration-tuning/
  max: 100,
  // close connections that haven't been used for one second
  idleTimeoutMillis: 1000,
  // automatically close connections older than 60 seconds
  maxLifetimeSeconds: 60
}

/**
  * @param {Error} err
  * @returns {void}
  */
const onError = (err) => {
  // Prevent crashing the process on idle client errors, the pool will recover
  // itself. If all connections are lost, the process will still crash.
  // https://github.com/brianc/node-postgres/issues/1324#issuecomment-308778405
  console.error('An idle client has experienced an error', err.stack)
}

/**
 * @returns {Promise<PgPool>}
 */
export const createPgPool = async () => {
  const pool = new pg.Pool({
    ...poolConfig,
    connectionString: DATABASE_URL
  })
  pool.on('error', onError)
  await pool.query('SELECT 1')
  return pool
}

/**
 * @param {Queryable} client
 */
export const migrateWithPgClient = async (client) => {
  const postgrator = new Postgrator({
    migrationPattern: join(migrationsDirectory, '*'),
    driver: 'pg',
    execQuery: (query) => client.query(query)
  })
  console.log(
    'Migrating `spark_deal_observer` DB schema from version %s to version %s',
    await postgrator.getDatabaseVersion(),
    await postgrator.getMaxVersion()
  )

  await postgrator.migrate()

  console.log('Migrated `spark_deal_observer` DB schema to version', await postgrator.getDatabaseVersion())
}

export {
  DATABASE_URL
}
