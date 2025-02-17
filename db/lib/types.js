import { Type } from '@sinclair/typebox'

const PayloadRetrievabilityState = {
  NotQueried: 'PAYLOAD_CID_NOT_QUERIED_YET',
  Unresolved: 'PAYLOAD_CID_UNRESOLVED',
  Resolved: 'PAYLOAD_CID_RESOLVED',
  TerminallyUnretrievable: 'PAYLOAD_CID_TERMINALLY_UNRETRIEVABLE'
}

const PayloadRetrievabilityStateType = Type.Enum(PayloadRetrievabilityState)

const ActiveDealDbEntry = Type.Object({
  activated_at_epoch: Type.Number(),
  miner_id: Type.Number(),
  client_id: Type.Number(),
  piece_cid: Type.String(),
  piece_size: Type.BigInt(),
  term_start_epoch: Type.Number(),
  term_min: Type.Number(),
  term_max: Type.Number(),
  sector_id: Type.BigInt(),
  payload_cid: Type.Optional(Type.String()),
  payload_retrievability_state: PayloadRetrievabilityStateType,
  last_payload_retrieval_attempt: Type.Optional(Type.Date())
})

export { ActiveDealDbEntry, PayloadRetrievabilityState, PayloadRetrievabilityStateType }
