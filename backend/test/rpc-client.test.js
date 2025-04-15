import assert from 'node:assert'
import { describe, it } from 'node:test'
import { chainHeadTestData } from './test_data/chainHead.js'
import { rawActorEventTestData } from './test_data/rawActorEvent.js'
import { parse } from '@ipld/dag-json'
import { getActorEvents, getActorEventsFilter, getChainHead, rpcRequest } from '../lib/rpc-service/service.js'
import { ClaimEvent } from '../lib/rpc-service/data-types.js'
import { Value } from '@sinclair/typebox/value'

/** @import {MakeRpcRequest} from '../lib/typings.d.ts' */

describe('RpcApiClient', () => {
  /** @type {MakeRpcRequest} */
  const makeRpcRequest = async (method, params) => {
    switch (method) {
      case 'Filecoin.ChainHead':
        return parse(JSON.stringify(chainHeadTestData))
      case 'Filecoin.GetActorEventsRaw': {
        assert(typeof params[0] === 'object' && params[0], 'params[0] must be an object')
        const filter = /** @type {{fromHeight: number; toHeight: number}} */(params[0])
        assert(typeof filter.fromHeight === 'number', 'filter.fromHeight must be a number')
        assert(typeof filter.toHeight === 'number', 'filter.toHeight must be a number')
        return parse(JSON.stringify(rawActorEventTestData)).filter((/** @type {{ height: number; }} */ e) => e.height >= filter.fromHeight && e.height <= filter.toHeight)
      }
      default:
        console.error('Unknown method')
    }
  }

  it('retrieves the chainHead', async () => {
    const chainHead = await getChainHead(makeRpcRequest)
    assert(chainHead)
    const expected = parse(JSON.stringify(chainHeadTestData))
    assert(chainHead.Height)
    assert.deepStrictEqual(expected.Height, chainHead.Height)
  })

  for (let blockHeight = 4622129; blockHeight < 4622129 + 11; blockHeight++) {
    it(`retrieves rawActorEvents in block ${blockHeight}`, async () => {
      const actorEvents = await getActorEvents(getActorEventsFilter(blockHeight, 'claim'), makeRpcRequest)
      assert(actorEvents)
      assert(actorEvents.length > 0)
      actorEvents.forEach(e => {
        // Validate type
        const parsedEvent = Value.Parse(ClaimEvent, e.event)
        assert(parsedEvent)
        assert.strictEqual(e.height, blockHeight)
      })
    })
  }
  it('can successfully fetch actor events and the chain head from the real rpc api endpoint', async () => {
    const chainHead = await getChainHead(rpcRequest)
    assert(chainHead)
    const actorEvents = await getActorEvents(getActorEventsFilter(chainHead.Height - 1000, 'claim'), rpcRequest)
    assert(actorEvents)
  })
})
