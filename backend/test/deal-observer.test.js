import assert from 'node:assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { createPgPool, migrateWithPgClient } from '@filecoin-station/deal-observer-db'
import { fetchDealWithHighestActivatedEpoch, countStoredActiveDeals, loadDeals, storeActiveDeals, observeBuiltinActorEvents } from '../lib/deal-observer.js'
import { Value } from '@sinclair/typebox/value'
import { BlockEvent, ClaimEvent } from '../lib/rpc-service/data-types.js'
import { convertBlockEventToActiveDeal } from '../lib/utils.js'
import { PayloadRetrievabilityState } from '@filecoin-station/deal-observer-db/lib/types.js'
import { chainHeadTestData } from './test_data/chainHead.js'
import { rawActorEventTestData } from './test_data/rawActorEvent.js'
import { parse } from '@ipld/dag-json'
import { countRevertedActiveDeals } from '../lib/resolve-payload-cids.js'
/** @import { Static } from '@sinclair/typebox' */

describe('deal-observer-backend', () => {
  /**
   * @type {import('@filecoin-station/deal-observer-db').PgPool}
   */
  let pgPool
  before(async () => {
    pgPool = await createPgPool()
    await migrateWithPgClient(pgPool)
  })

  after(async () => {
    await pgPool.end()
  })

  beforeEach(async () => {
    await pgPool.query('DELETE FROM active_deals')
    await pgPool.query('ALTER SEQUENCE active_deals_id_seq RESTART WITH 1')
  })

  it('adds new FIL+ deals from built-in actor events to storage', async () => {
    const event = Value.Parse(BlockEvent, {
      height: 1,
      event: {
        claimId: 1,
        provider: 2,
        client: 3,
        pieceCid: 'baga6ea4seaqc4z4432snwkztsadyx2rhoa6rx3wpfzu26365wvcwlb2wyhb5yfi',
        pieceSize: 4n,
        termStart: 5,
        termMin: 12340,
        termMax: 12340,
        sector: 6n,
        payload_cid: undefined
      },
      emitter: 'f06',
      reverted: false
    })
    const activeDeal = convertBlockEventToActiveDeal(event)
    await storeActiveDeals([activeDeal], pgPool)
    const actualData = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    const expectedData = {
      ...activeDeal,
      payload_retrievability_state: PayloadRetrievabilityState.NotQueried,
      last_payload_retrieval_attempt: undefined,
      reverted: false,
      id: 1
    }
    assert.deepStrictEqual(actualData, [expectedData])
  })
  it('checks retrieval of last stored deal', async () => {
    const eventData = {
      claimId: 1,
      provider: 2,
      client: 3,
      pieceCid: 'baga6ea4seaqc4z4432snwkztsadyx2rhoa6rx3wpfzu26365wvcwlb2wyhb5yfi',
      pieceSize: 4n,
      termStart: 5,
      termMin: 12340,
      termMax: 12340,
      sector: 6n,
      payload_cid: undefined,
      payload_retrievability_state: PayloadRetrievabilityState.NotQueried,
      last_payload_retrieval_attempt: undefined
    }
    const event = Value.Parse(BlockEvent, { height: 1, event: eventData, emitter: 'f06', reverted: false })
    const activeDeal = convertBlockEventToActiveDeal(event)
    await storeActiveDeals([activeDeal], pgPool)
    const expected = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    const actual = await fetchDealWithHighestActivatedEpoch(pgPool)
    assert.deepStrictEqual(expected, [actual])
  })

  it('checks number of stored deals', async () => {
    /**
     * @param {Static<typeof ClaimEvent>} eventData
     */
    const storeBlockEvent = async (eventData) => {
      const event = Value.Parse(BlockEvent, { height: 1, event: eventData, emitter: 'f06', reverted: false })
      const activeDeal = convertBlockEventToActiveDeal(event)
      await storeActiveDeals([activeDeal], pgPool)
    }
    const data = Value.Parse(ClaimEvent, {
      claimId: 1,
      provider: 2,
      client: 3,
      pieceCid: 'baga6ea4seaqc4z4432snwkztsadyx2rhoa6rx3wpfzu26365wvcwlb2wyhb5yfi',
      pieceSize: 4n,
      termStart: 5,
      termMin: 12340,
      termMax: 12340,
      sector: 6n
    })
    assert.strictEqual(await countStoredActiveDeals(pgPool), 0n)
    await storeBlockEvent(data)
    assert.strictEqual(await countStoredActiveDeals(pgPool), 1n)
    // Entries must be unique
    data.claimId = 2
    data.provider = 3
    await storeBlockEvent(data)
    assert.strictEqual(await countStoredActiveDeals(pgPool), 2n)
  })

  it('serially processes claims for a piece stored twice in the same sector', async () => {
    /**
     * @param {Static<typeof ClaimEvent>} eventData
     */
    const storeDeal = async (eventData) => {
      const event = Value.Parse(BlockEvent, { height: 1, event: eventData, emitter: 'f06', reverted: false })
      const dbEntry = convertBlockEventToActiveDeal(event)
      await storeActiveDeals([dbEntry], pgPool)
    }
    const eventData = {
      claimId: 1,
      provider: 2,
      client: 3,
      pieceCid: 'baga6ea4seaqc4z4432snwkztsadyx2rhoa6rx3wpfzu26365wvcwlb2wyhb5yfi',
      pieceSize: 4n,
      termStart: 5,
      termMin: 12340,
      termMax: 12340,
      sector: 6n,
      payload_cid: undefined,
      payload_retrievability_state: PayloadRetrievabilityState.NotQueried,
      last_payload_retrieval_attempt: undefined
    }
    await storeDeal(eventData)
    let actual = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    assert.strictEqual(actual.length, 1)
    // If we only change the id, the unique constraint which does not include the id will prevent the insertion
    // This test verifies that `storeDeal` handles such situation by ignoring the duplicate deal record
    eventData.claimId = 2
    await storeDeal(eventData)
    actual = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    assert.strictEqual(actual.length, 1)
  })
  it('simultaneously processes claims for a piece stored twice in the same sector', async () => {
    /**
     * @param {Array<Static<typeof ClaimEvent>>} events
     */
    const storeDeal = async (events) => {
      const dbEntries = events.map(eventData => {
        const event = Value.Parse(BlockEvent, { height: 1, event: eventData, emitter: 'f06', reverted: false })
        return convertBlockEventToActiveDeal(event)
      })
      await storeActiveDeals(dbEntries, pgPool)
    }
    const eventData = Value.Parse(ClaimEvent, {
      claimId: 1,
      provider: 2,
      client: 3,
      pieceCid: 'baga6ea4seaqc4z4432snwkztsadyx2rhoa6rx3wpfzu26365wvcwlb2wyhb5yfi',
      pieceSize: 4n,
      termStart: 5,
      termMin: 12340,
      termMax: 12340,
      sector: 6n,
      payload_cid: undefined,
      payload_retrievability_state: PayloadRetrievabilityState.NotQueried,
      last_payload_retrieval_attempt: undefined
    })
    await storeDeal([eventData, { ...eventData, claimId: 2 }])
    const actual = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    // Only one of the events will be stored in the database
    assert.strictEqual(actual.length, 1)
  })
  it('checks number of reverted stored deals', async () => {
    /**
     * @param {Static<typeof ClaimEvent>} eventData
     * @param {boolean} reverted
     */
    const storeBlockEvent = async (eventData, reverted) => {
      const event = Value.Parse(BlockEvent, { height: 1, event: eventData, emitter: 'f06', reverted })
      const activeDeal = convertBlockEventToActiveDeal(event)
      await storeActiveDeals([activeDeal], pgPool)
    }
    const data = Value.Parse(ClaimEvent, {
      claimId: 1,
      provider: 2,
      client: 3,
      pieceCid: 'baga6ea4seaqc4z4432snwkztsadyx2rhoa6rx3wpfzu26365wvcwlb2wyhb5yfi',
      pieceSize: 4n,
      termStart: 5,
      termMin: 12340,
      termMax: 12340,
      sector: 6n
    })
    assert.strictEqual(await countRevertedActiveDeals(pgPool), 0n)
    await storeBlockEvent(data, false)
    assert.strictEqual(await countRevertedActiveDeals(pgPool), 0n)
    data.claimId = 2
    data.provider = 3
    await storeBlockEvent(data, true)
    assert.strictEqual(await countRevertedActiveDeals(pgPool), 1n)
    data.claimId = 3
    data.provider = 4
    await storeBlockEvent(data, false)
    assert.strictEqual(await countRevertedActiveDeals(pgPool), 1n)
    data.claimId = 4
    data.provider = 5
    await storeBlockEvent(data, true)
    assert.strictEqual(await countRevertedActiveDeals(pgPool), 2n)
  })
})

describe('deal-observer-backend built in actor event observer', () => {
  /**
   * @type {import('@filecoin-station/deal-observer-db').PgPool}
   */
  let pgPool
  /**
   * @type {import('../lib/typings.js').MakeRpcRequest}
   */
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
  before(async () => {
    pgPool = await createPgPool()
    await migrateWithPgClient(pgPool)
  })

  after(async () => {
    await pgPool.end()
  })

  beforeEach(async () => {
    await pgPool.query('DELETE FROM active_deals')
    await pgPool.query('ALTER SEQUENCE active_deals_id_seq RESTART WITH 1')
  })
  it('stores all retrievable active deals if database is empty', async () => {
    await observeBuiltinActorEvents(pgPool, makeRpcRequest, 10, 0)
    const deals = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    assert.strictEqual(deals.length, 360)
  })

  it('correctly picks up from where the current storage is at', async () => {
    await observeBuiltinActorEvents(pgPool, makeRpcRequest, 11, 10)
    let deals = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    assert.strictEqual(deals.length, 25)
    const lastInsertedDeal = await fetchDealWithHighestActivatedEpoch(pgPool)
    assert.strictEqual(lastInsertedDeal?.activated_at_epoch, 4622129)
    // The deal observer function should pick up from the current storage
    await observeBuiltinActorEvents(pgPool, makeRpcRequest, 100, 0)
    deals = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    assert.strictEqual(deals.length, 360)
  })

  it('correctly applies the max past epoch and finality epoch parameters', async () => {
    await observeBuiltinActorEvents(pgPool, makeRpcRequest, 11, 12)
    let deals = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    // No deals should be stored because the finality epoch is larger than the maximum past epoch parameter
    assert.strictEqual(deals.length, 0)

    await observeBuiltinActorEvents(pgPool, makeRpcRequest, 11, 10)
    deals = await loadDeals(pgPool, 'SELECT * FROM active_deals')
    // There should be only one distinct block height in the database
    assert.strictEqual((new Set(deals.map(deal => deal.activated_at_epoch))).size, 1)
  })
})
