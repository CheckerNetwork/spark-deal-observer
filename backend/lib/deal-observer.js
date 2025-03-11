import { getActorEvents, getActorEventsFilter, getChainHead } from './rpc-service/service.js'
import { ActiveDealDbEntry } from '@filecoin-station/deal-observer-db/lib/types.js'
import { Value } from '@sinclair/typebox/value'
import { convertBlockEventToActiveDeal } from './utils.js'
/** @import {Queryable, QueryResultWithUnknownRows} from '@filecoin-station/deal-observer-db' */
/** @import { Static } from '@sinclair/typebox' */
/** @import {MakeRpcRequest} from './typings.d.ts' */
/** @import {ActiveDeal} from '@filecoin-station/deal-observer-db/lib/types.js' */

/**
 * @param {Queryable} pgPool
 * @param {MakeRpcRequest} makeRpcRequest
 * @param {number} maxPastEpochs
 * @param {number} finalityEpochs
 * @returns {Promise<void>}
 */
export const observeBuiltinActorEvents = async (pgPool, makeRpcRequest, maxPastEpochs, finalityEpochs) => {
  const currentChainHead = await getChainHead(makeRpcRequest)
  const lastInsertedDeal = await fetchDealWithHighestActivatedEpoch(pgPool)
  const startEpoch = Math.max(
    currentChainHead.Height - maxPastEpochs,
    (lastInsertedDeal?.activated_at_epoch ?? -1) + 1
  )
  const endEpoch = currentChainHead.Height - finalityEpochs
  for (let epoch = startEpoch; epoch <= endEpoch; epoch++) {
    await fetchAndStoreActiveDeals(epoch, pgPool, makeRpcRequest)
  }
}

/**
 * @param {number} blockHeight
 * @param {Queryable} pgPool
 * @param {MakeRpcRequest} makeRpcRequest
 */
export const fetchAndStoreActiveDeals = async (blockHeight, pgPool, makeRpcRequest) => {
  const eventType = 'claim'
  const blockEvents = await getActorEvents(getActorEventsFilter(blockHeight, eventType), makeRpcRequest)
  console.log(`Fetched ${blockEvents.length} ${eventType} events from block ${blockHeight}`)
  await storeActiveDeals(blockEvents.map((event) => convertBlockEventToActiveDeal(event)), pgPool)
}

/**
 * @param {Queryable} pgPool
 * @returns {Promise<Static<typeof ActiveDealDbEntry> | null>}
 */
export async function fetchDealWithHighestActivatedEpoch (pgPool) {
  const query = 'SELECT * FROM active_deals ORDER BY activated_at_epoch DESC LIMIT 1'
  const result = await loadDeals(pgPool, query)
  return result.length > 0 ? result[0] : null
}

/**
 * @param {Queryable} pgPool
 * @returns {Promise<number>}
 * */
export async function countStoredActiveDeals (pgPool) {
  const query = 'SELECT COUNT(*) FROM active_deals'
  const result = await pgPool.query(query)
  return result.rows[0].count
}

/**
 * @param {Static<typeof ActiveDeal >[]} activeDeals
 * @param {Queryable} pgPool
 * @returns {Promise<void>}
 * */
export async function storeActiveDeals (activeDeals, pgPool) {
  if (activeDeals.length === 0) {
    return
  }
  try {
    // Insert deals in a batch
    const insertQuery = `
        INSERT INTO active_deals (
          activated_at_epoch,
          miner_id,
          client_id,
          piece_cid,
          piece_size,
          term_start_epoch,
          term_min,
          term_max,
          sector_id,
          payload_retrievability_state,
          last_payload_retrieval_attempt,
          reverted
        )
        VALUES (
          unnest($1::int[]),
          unnest($2::int[]), 
          unnest($3::int[]), 
          unnest($4::text[]), 
          unnest($5::bigint[]), 
          unnest($6::int[]), 
          unnest($7::int[]), 
          unnest($8::int[]), 
          unnest($9::bigint[]),
          unnest($10::payload_retrievability_state[]),
          unnest($11::timestamp[]),
          unnest($12::boolean[])
        )
        ON CONFLICT ON CONSTRAINT unique_active_deals DO NOTHING
      `
    await pgPool.query(insertQuery, [
      activeDeals.map(deal => deal.activated_at_epoch),
      activeDeals.map(deal => deal.miner_id),
      activeDeals.map(deal => deal.client_id),
      activeDeals.map(deal => deal.piece_cid),
      activeDeals.map(deal => deal.piece_size),
      activeDeals.map(deal => deal.term_start_epoch),
      activeDeals.map(deal => deal.term_min),
      activeDeals.map(deal => deal.term_max),
      activeDeals.map(deal => deal.sector_id),
      activeDeals.map(deal => deal.payload_retrievability_state),
      activeDeals.map(deal => deal.last_payload_retrieval_attempt),
      activeDeals.map(deal => deal.reverted)
    ])
  } catch (error) {
    // If any error occurs, roll back the transaction
    throw Error('Error inserting deals', { cause: error })
  }
}

/**
   * @param {Queryable} pgPool
   * @param {string} query
   * @param {Array<unknown>} args
   * @returns {Promise<Array<Static <typeof ActiveDealDbEntry>>>}
   */
export async function loadDeals (pgPool, query, args = []) {
  /** @type {QueryResultWithUnknownRows} */
  const { rows } = await pgPool.query(query, args)
  const result = rows.map((deal) => {
    // SQL used null, typebox needs undefined for null values
    Object.keys(deal).forEach(key => {
      if (deal[key] === null) {
        deal[key] = undefined
      }
    })
    return Value.Parse(ActiveDealDbEntry, deal)
  }
  )
  return result
}
