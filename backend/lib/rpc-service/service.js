import { RPC_URL, rpcHeaders } from '../config.js'
import { base64pad } from 'multiformats/bases/base64'
import { encode as cborEncode } from '@ipld/dag-cbor'
import { rawEventEntriesToEvent } from './utils.js'
import { Value } from '@sinclair/typebox/value'
import * as util from 'node:util'
import { ClaimEvent, RawActorEvent, BlockEvent, RpcResponse, ChainHead } from './data-types.js'
import pRetry from 'p-retry'
import assert from 'node:assert'

/** @import { Static } from '@sinclair/typebox' */
/** @import {MakeRpcRequest} from '../typings.d.ts' */

/**
 * @param {string} method
 * @param {unknown[]} params
 * @returns {Promise<unknown>}
 */
export const rpcRequest = async (method, params) => {
  const reqBody = JSON.stringify({ method, params, id: 1, jsonrpc: '2.0' })
  const headers = {
    ...rpcHeaders,
    'content-type': 'application/json'
  }
  try {
    const response = await pRetry(async () => await fetch(RPC_URL, {
      method: 'POST',
      headers,
      body: reqBody
    }), { retries: 5 })
    if (!response.ok) {
      throw new Error(`Fetch failed - HTTP ${response.status}: ${await response.text().catch(() => null)}`)
    }
    const json = await response.json()
    try {
      const parsedRpcResponse = Value.Parse(RpcResponse, json).result
      return parsedRpcResponse
    } catch (error) {
      throw Error(util.format('Failed to parse RPC response: %o', json), { cause: error })
    }
  } catch (error) {
    throw Error(`Failed to make RPC request ${method}\nRequest was: ${JSON.stringify(reqBody)}.`, { cause: error })
  }
}
/**
 * @param {{fromHeight:number,toHeight:number,fields: unknown}} actorEventFilter
 * Returns actor events filtered by the given actorEventFilter
 * @param {MakeRpcRequest} makeRpcRequest
 * @returns {Promise<Array<Static<typeof BlockEvent>>>}
 */
export async function getActorEvents (actorEventFilter, makeRpcRequest) {
  const rawEvents = /** @type {unknown[]} */(await makeRpcRequest('Filecoin.GetActorEventsRaw', [actorEventFilter]))
  if (!rawEvents || rawEvents.length === 0) {
    console.debug(`No actor events found in the height range ${actorEventFilter.fromHeight} - ${actorEventFilter.toHeight}.`)
    return []
  }
  // TODO: handle reverted events
  // https://github.com/filecoin-station/deal-observer/issues/22
  const typedRawEventEntries = rawEvents.map((rawEvent) => Value.Parse(RawActorEvent, rawEvent))
  // An emitted event contains the height at which it was emitted, the emitter and the event itself
  const emittedEvents = []
  for (const typedEventEntries of typedRawEventEntries) {
    const { event, eventType } = rawEventEntriesToEvent(typedEventEntries.entries)
    // Verify the returned event matches the expected event schema
    let typedEvent
    switch (eventType) {
      case 'claim': {
        assert.ok('id' in event, 'Claim event must have an id')
        typedEvent = Value.Parse(ClaimEvent, { claimId: event.id, ...event })
        emittedEvents.push(
          Value.Parse(BlockEvent,
            {
              height: typedEventEntries.height,
              emitter: typedEventEntries.emitter,
              event: typedEvent,
              reverted: typedEventEntries.reverted
            }))
        continue
      }
      default: {
        throw Error(`Unknown event type: ${eventType}`)
      }
    }
  }
  return emittedEvents
}

/**
 * @param {MakeRpcRequest} makeRpcRequest
 * @returns {Promise<Static<typeof ChainHead>>}
 */
export async function getChainHead (makeRpcRequest) {
  const result = await makeRpcRequest('Filecoin.ChainHead', [])
  try {
    return Value.Parse(ChainHead, result)
  } catch (e) {
    throw Error(util.format('Failed to parse chain head: %o', result))
  }
}

/**
   * @param {number} blockHeight
   * @param {string} eventTypeString
   */
export function getActorEventsFilter (blockHeight, eventTypeString) {
  // We only search for events in a single block
  return {
    fromHeight: blockHeight,
    toHeight: blockHeight,
    fields: {
      $type: // string must be encoded as CBOR and then presented as a base64 encoded string
        // Codec 81 is CBOR and will only give us builtin-actor events, FEVM events are all RAW
        [{ Codec: 81, Value: base64pad.baseEncode(cborEncode(eventTypeString)) }]
    }
  }
}
