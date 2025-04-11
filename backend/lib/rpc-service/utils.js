import { base64pad } from 'multiformats/bases/base64'
import { decode as cborDecode } from '@ipld/dag-cbor'
import * as util from 'node:util'

/**
 * @param {string} data
 * @returns {unknown}
 */
const decodeCborInBase64 = (data) => {
  return cborDecode(base64pad.baseDecode(data))
}

/**
 * Converts raw event entries into a typed event
 *
 * @param {Array<{Key: string, Value: string}>} rawEventEntries
 * @return {{event: Object, eventType: string}} event
 */
const rawEventEntriesToEvent = (rawEventEntries) => {
  // Each event is defined by a list of event entries which will parsed into a typed event
  /** @type {Record<string, unknown>} */
  const event = {}
  /** @type {string | undefined} */
  let eventType
  for (const entry of rawEventEntries) {
    // The key returned by the Lotus API is kebab-case, we convert it to camelCase
    const key = entry.Key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    let value = decodeCborInBase64(entry.Value)
    // In each entry exists an event type declaration which we need to extract
    if (key === '$type') {
      eventType = /** @type {string} */(value)
      // The type entry is not part of the event itself
      continue
    }

    // Convert CID instanes to the string representation
    if (typeof value === 'object' && value && (Symbol.toStringTag in value) && value[Symbol.toStringTag] === 'CID') {
      value = value.toString()
    } else if (typeof value !== 'number') {
      throw new Error(util.format(
        'Unsupported type %s found in the raw event entries. Key: %s Value: ',
        typeof value,
        key,
        value)
      )
    }
    if (key === 'id') {
      event.claimId = value
    } else {
      event[key] = value
    }
  }
  if (!eventType) {
    throw new Error(util.format('No event type found in the raw event entries. Event entries: %o', event))
  }
  return { event, eventType }
}

export {
  decodeCborInBase64,
  rawEventEntriesToEvent
}
