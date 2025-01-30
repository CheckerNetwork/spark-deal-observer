import { Value } from '@sinclair/typebox/value'
import { PIECE_INDEXER_URL } from '../config.js'
import { getMinerPeerId } from '../rpc-service/service.js'
import { PixResponse } from './data-types.js'
import pRetry from 'p-retry'

/**
 * @param {string} providerId
 * @param {string} pieceCid
 * @returns {Promise<string>}
 */
export const pixRequest = async (providerId, pieceCid) => {
  const url = PIECE_INDEXER_URL + '/sample/' + providerId + '/' + pieceCid
  try {
    const response = await pRetry(async () => await fetch(url, {
      method: 'GET',
      headers: { 'content-type': 'application/json' }
    }), { retries: 5 })
    const json = await response.json()
    try {
      const parsedPixResponse = Value.Parse(PixResponse, json)
      return parsedPixResponse.samples[0]
    } catch (e) {
      throw new Error(`Failed to parse response from piece indexer. The response was : ${JSON.stringify(json)}`, { cause: e })
    }
  } catch (e) {
    throw new Error('Failed to make RPC request.', { cause: e })
  }
}

/**
* @param {number} providerId
* @param {string} pieceCid
* @returns {Promise<string>}
*/
export async function fetchPayloadCid (providerId, pieceCid, rpcRequest, pixRequest) {
  const minerPeerId = await getMinerPeerId(providerId, rpcRequest)
  const payloadCid = await pixRequest(minerPeerId, pieceCid)
  return payloadCid
}
