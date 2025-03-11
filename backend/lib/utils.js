/** @import { BlockEvent } from './rpc-service/data-types.js' */
import { ActiveDeal, PayloadRetrievabilityState } from '@filecoin-station/deal-observer-db/lib/types.js'
import { Value } from '@sinclair/typebox/value'
/** @import { Static } from '@sinclair/typebox' */

/**
 *
 * @param {Static <typeof BlockEvent>} blockEvent
 * @returns { Static < typeof ActiveDeal> }
 */
export function convertBlockEventToActiveDeal (blockEvent) {
  return Value.Parse(ActiveDeal, {
    activated_at_epoch: blockEvent.height,
    miner_id: blockEvent.event.provider,
    client_id: blockEvent.event.client,
    piece_cid: blockEvent.event.pieceCid,
    piece_size: blockEvent.event.pieceSize,
    term_start_epoch: blockEvent.event.termStart,
    term_min: blockEvent.event.termMin,
    term_max: blockEvent.event.termMax,
    sector_id: blockEvent.event.sector,
    payload_cid: undefined,
    payload_retrievability_state: PayloadRetrievabilityState.NotQueried,
    last_payload_retrieval_attempt: undefined,
    reverted: blockEvent.reverted
  })
}
