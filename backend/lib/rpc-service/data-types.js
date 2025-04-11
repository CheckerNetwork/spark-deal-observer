import { Type } from '@sinclair/typebox'

const ClaimEvent = Type.Object({
  id: Type.Number(),
  client: Type.Number(),
  provider: Type.Number(),
  pieceCid: Type.String(),
  pieceSize: Type.BigInt(),
  termMin: Type.Number(),
  termMax: Type.Number(),
  termStart: Type.Number(),
  sector: Type.BigInt()
})

const Entry = Type.Object({
  Codec: Type.Number(),
  Flags: Type.Number(),
  Key: Type.String(),
  Value: Type.String()
})

const RawActorEvent = Type.Object({
  emitter: Type.String(),
  entries: Type.Array(Entry),
  height: Type.Number(),
  reverted: Type.Boolean(),
  msgCid: Type.Unknown(),
  tipsetKey: Type.Array(Type.Unknown())
})

const BlockEvent = Type.Object({
  height: Type.Number(),
  emitter: Type.String(),
  event: ClaimEvent,
  reverted: Type.Boolean()
})

const RpcResponse = Type.Object({
  result: Type.Unknown()
})

const ChainHead = Type.Object({
  Height: Type.Number(),
  Blocks: Type.Unknown(),
  Cids: Type.Unknown()
})

export {
  ClaimEvent,
  Entry,
  RawActorEvent,
  BlockEvent,
  RpcResponse,
  ChainHead
}
