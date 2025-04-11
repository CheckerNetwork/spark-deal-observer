import { InfluxDB, Point } from '@influxdata/influxdb-client'
import createDebug from 'debug'

const debug = createDebug('spark:deal-observer:telemetry')

/**
 * @param {string | undefined} token
 * @returns {{influx: InfluxDB,recordTelemetry: (name: string, fn: (p: Point) => void) => void}}
  */
export const createInflux = token => {
  const influx = new InfluxDB({
    url: 'https://eu-central-1-1.aws.cloud2.influxdata.com',
    // bucket permissions: deal-observer:write
    token
  })
  const writeClient = influx.getWriteApi(
    'Filecoin Station', // org
    'deal-observer', // bucket
    'ms' // precision
  )
  setInterval(() => {
    writeClient.flush().catch(console.error)
  }, 10_000).unref()

  return {
    influx,

    /**
     * @param {string} name
     * @param {(p: Point) => void} fn
     */
    recordTelemetry: (name, fn) => {
      const point = new Point(name)
      fn(point)
      writeClient.writePoint(point)
      debug('%s %o', name, point)
    }
  }
}

export { Point }
