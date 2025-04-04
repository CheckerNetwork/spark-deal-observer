import { loadDeals } from './deal-observer.js'
import * as util from 'node:util'
import { PayloadRetrievabilityState } from '@filecoin-station/deal-observer-db/lib/types.js'
import debug from 'debug'
import { GLIF_TOKEN, RPC_URL } from './config.js'
import { ethers } from 'ethers'
import {
  getIndexProviderPeerId,
  MINER_TO_PEERID_CONTRACT_ADDRESS, MINER_TO_PEERID_CONTRACT_ABI
// @ts-ignore
} from 'index-provider-peer-id'
import { rpcRequest } from './rpc-service/service.js'
import assert from 'node:assert'

/** @import {Queryable} from '@filecoin-station/deal-observer-db' */
/** @import { Static } from '@sinclair/typebox' */
/** @import { ActiveDealDbEntry, PayloadRetrievabilityStateType } from '@filecoin-station/deal-observer-db/lib/types.js' */

const THREE_DAYS_IN_MILLISECONDS = 1000 * 60 * 60 * 24 * 3

/**
 *
 * @param {import('./typings.js').GetIndexProviderPeerId} getIndexProviderPeerId
 * @param {import('./typings.js').MakePayloadCidRequest} makePayloadCidRequest
 * @param {Queryable} pgPool
 * @param {number} maxDeals
 * @param {number} now - The current timestamp in milliseconds
 * @returns {Promise<number>}
 */
export const resolvePayloadCids = async (getIndexProviderPeerId, makePayloadCidRequest, pgPool, maxDeals, now = Date.now()) => {
  let payloadCidsResolved = 0
  for (const deal of await fetchDealsWithUnresolvedPayloadCid(pgPool, maxDeals, new Date(now - THREE_DAYS_IN_MILLISECONDS))) {
    const { peerId: minerPeerId, source } = await getIndexProviderPeerId(deal.miner_id)
    debug(`Using PeerID from ${source}.`)
    const payloadCid = await makePayloadCidRequest(minerPeerId, deal.piece_cid)
    if (payloadCid) deal.payload_cid = payloadCid
    if (!deal.payload_cid) {
      if (deal.last_payload_retrieval_attempt) {
        deal.payload_retrievability_state = PayloadRetrievabilityState.TerminallyUnretrievable
      } else {
        deal.payload_retrievability_state = PayloadRetrievabilityState.Unresolved
      }
    } else {
      payloadCidsResolved++
      deal.payload_retrievability_state = PayloadRetrievabilityState.Resolved
    }
    deal.last_payload_retrieval_attempt = new Date(now)
    await updatePayloadCidInActiveDeal(pgPool, deal, deal.payload_retrievability_state, deal.last_payload_retrieval_attempt, deal.payload_cid)
  }
  return payloadCidsResolved
}

/**
   * @param {Queryable} pgPool
   * @param {number} maxDeals
   * @param {Date} now
   * @returns {Promise<Array<Static< typeof ActiveDealDbEntry>>>}
   */
export async function fetchDealsWithUnresolvedPayloadCid (pgPool, maxDeals, now) {
  const query = "SELECT * FROM active_deals WHERE payload_cid IS NULL AND (payload_retrievability_state = 'PAYLOAD_CID_NOT_QUERIED_YET' OR payload_retrievability_state = 'PAYLOAD_CID_UNRESOLVED') AND (last_payload_retrieval_attempt IS NULL OR last_payload_retrieval_attempt < $1) ORDER BY activated_at_epoch ASC LIMIT $2"
  return await loadDeals(pgPool, query, [now, maxDeals])
}

/**
 * @param {Queryable} pgPool
 * @returns {Promise<number>}
 */
export async function countStoredActiveDealsWithUnresolvedPayloadCid (pgPool) {
  const query = 'SELECT COUNT(*) FROM active_deals WHERE payload_cid IS NULL'
  const result = await pgPool.query(query)
  return result.rows[0].count
}

/**
  * @param {Queryable} pgPool
  * @returns {Promise<Array<Static<typeof ActiveDealDbEntry>>>}
  */
export async function countRevertedActiveDeals (pgPool) {
  const query = 'SELECT COUNT(*) FROM active_deals WHERE reverted = TRUE'
  const result = await pgPool.query(query)
  return result.rows[0].count
}

/**
 * @param {Queryable} pgPool
 * @param {Static< typeof PayloadRetrievabilityStateType>} state
 * @returns {Promise<number>}
 */
export async function countStoredActiveDealsWithPayloadState (pgPool, state) {
  const query = 'SELECT COUNT(*) FROM active_deals WHERE payload_retrievability_state = $1'
  const result = await pgPool.query(query, [state])
  return result.rows[0].count
}

/**
 * @param {Queryable} pgPool
 * @param {Static<typeof ActiveDealDbEntry>} deal
 * @param {Static< typeof PayloadRetrievabilityStateType>} newPayloadRetrievalState
 * @param {Date} lastRetrievalAttemptTimestamp
 * @param {string | undefined} newPayloadCid
 * @returns { Promise<void>}
 */
async function updatePayloadCidInActiveDeal (pgPool, deal, newPayloadRetrievalState, lastRetrievalAttemptTimestamp, newPayloadCid) {
  const updateQuery = `
    UPDATE active_deals
    SET payload_cid = $1, payload_retrievability_state = $2, last_payload_retrieval_attempt = $3
    WHERE id = $4
  `
  try {
    await pgPool.query(updateQuery, [
      newPayloadCid,
      newPayloadRetrievalState,
      lastRetrievalAttemptTimestamp,
      deal.id
    ])
  } catch (error) {
    throw Error(util.format('Error updating payload of deal: ', deal), { cause: error })
  }
}

function getSmartContractClient () {
  const fetchRequest = new ethers.FetchRequest(RPC_URL)
  assert(GLIF_TOKEN, 'GLIF_TOKEN is required')
  fetchRequest.setHeader('Authorization', `Bearer ${GLIF_TOKEN}`)
  const provider = new ethers.JsonRpcProvider(fetchRequest)
  return new ethers.Contract(
    MINER_TO_PEERID_CONTRACT_ADDRESS,
    MINER_TO_PEERID_CONTRACT_ABI,
    provider
  )
}
const defaultSmartContractClient = getSmartContractClient()

/**
 * @param {number} minerId
 * @param {object} options
 * @param {unknown} options.smartContract
 * @param {import('./typings.js').MakeRpcRequest} options.makeRpcRequest
 * @returns {Promise<{ peerId: string, source: string }>}
 */
export const getPeerId = async (minerId, { smartContract, makeRpcRequest } = { smartContract: defaultSmartContractClient, makeRpcRequest: rpcRequest }) => {
  return await getIndexProviderPeerId(
  `f0${minerId}`,
  smartContract,
  { rpcFn: makeRpcRequest }
  )
}
