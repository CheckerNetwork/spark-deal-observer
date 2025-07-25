import { createPgPool, migrateWithPgClient } from '@filecoin-station/deal-observer-db'
import { before, beforeEach, it, describe, after } from 'node:test'
import { rawActorEventTestData } from './test_data/rawActorEvent.js'
import { chainHeadTestData } from './test_data/chainHead.js'
import { parse } from '@ipld/dag-json'
import { loadDeals, fetchAndStoreActiveDeals } from '../lib/deal-observer.js'
import assert from 'assert'
import { minerPeerIds } from './test_data/minerInfo.js'
import { payloadCIDs } from './test_data/payloadCIDs.js'
import { Value } from '@sinclair/typebox/value'
import { ActiveDeal, PayloadRetrievabilityState } from '@filecoin-station/deal-observer-db/lib/types.js'
import { countStoredActiveDealsWithPayloadState, countStoredActiveDealsWithUnresolvedPayloadCid, getCachedIndexProviderPeerId, getPeerId, resolvePayloadCids } from '../lib/resolve-payload-cids.js'
import { LRUCache } from 'lru-cache'
/** @import { Static } from '@sinclair/typebox' */

describe('Payload CIDs resolver', () => {
  /**
   * @type {import('../lib/typings.d.ts').MakeRpcRequest}
   * */
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
  const getPeerId = async (/** @type {number} */ minerId) => {
    const peerId = minerPeerIds.get(`f0${minerId}`)?.PeerId
    if (!peerId) {
      throw new Error(`Peer ID not found for miner ID: ${minerId}`)
    }
    return { peerId, source: 'TEST' }
  }
  const loadTestEventData = async () => {
    const startEpoch = 4622129
    for (let blockHeight = startEpoch; blockHeight < startEpoch + 10; blockHeight++) {
      await fetchAndStoreActiveDeals(blockHeight, pgPool, makeRpcRequest)
    }
    assert.strictEqual(
      (await pgPool.query('SELECT * FROM active_deals')).rows.length,
      336
    )
  }

  const payloadCid = 'PAYLOAD_CID'
  const minerPeerId = 'MINER_PEER_ID'
  const now = Date.now()

  /**
  * @param {Static<typeof ActiveDeal >[]} activeDeals
  **/
  const withUniqueActiveDeals = async (activeDeals) => {
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
  }

  const DEFAULT_ACTIVE_DEAL = Value.Parse(ActiveDeal, {
    miner_id: 1,
    piece_cid: 'baga1',
    client_id: 1,
    activated_at_epoch: 1,
    piece_size: 1000,
    term_start_epoch: 1,
    term_min: 1,
    term_max: 1,
    sector_id: 1,
    payload_cid: undefined,
    payload_retrievability_state: PayloadRetrievabilityState.NotQueried,
    last_payload_retrieval_attempt: undefined,
    reverted: false
  })

  const getConstantPeerId = async () => {
    return { peerId: minerPeerId, source: 'TEST' }
  }

  /**
   * @type {import('@filecoin-station/deal-observer-db').PgPool}}
   *  */
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

  it('fetches deals where there exists no payload yet and updates the database entry', async () => {
    const resolvePayloadCidCalls = []
    /**
     * @type {import('../lib/typings.d.ts').MakePayloadCidRequest}
     * */
    const makePayloadCidRequest = async (providerId, pieceCid) => {
      resolvePayloadCidCalls.push({ providerId, pieceCid })
      const payloadCid = payloadCIDs.get(JSON.stringify({ minerId: providerId, pieceCid }))
      return payloadCid ? payloadCid.payloadCid : null
    }
    await loadTestEventData()
    assert.strictEqual(
      (await pgPool.query('SELECT * FROM active_deals WHERE payload_cid IS NULL')).rows.length,
      336
    )
    await resolvePayloadCids(getPeerId, makePayloadCidRequest, pgPool, 10000)
    assert.strictEqual(resolvePayloadCidCalls.length, 336)
    assert.strictEqual(
      (await pgPool.query('SELECT * FROM active_deals WHERE payload_cid IS NULL')).rows.length,
      85 // Not all deals have a payload CID in the test data
    )
  })

  it('counts number of unresolved payload CIDs correctly', async () => {
    await loadTestEventData()
    let unresolvedPayloadCids = await countStoredActiveDealsWithUnresolvedPayloadCid(pgPool)
    assert.strictEqual(unresolvedPayloadCids, 336n)
    const resolvePayloadCidCalls = []
    /**
     * @type {import('../lib/typings.d.ts').MakePayloadCidRequest}
     * */
    const resolvePayloadCid = async (providerId, pieceCid) => {
      resolvePayloadCidCalls.push({ providerId, pieceCid })
      const payloadCid = payloadCIDs.get(JSON.stringify({ minerId: providerId, pieceCid }))
      return payloadCid ? payloadCid.payloadCid : null
    }

    await resolvePayloadCids(getPeerId, resolvePayloadCid, pgPool, 10000)
    unresolvedPayloadCids = await countStoredActiveDealsWithUnresolvedPayloadCid(pgPool)
    assert.strictEqual(unresolvedPayloadCids, 85n)
  })

  it('does not retry to fetch unresolved payloads if the last retrieval was too recent', async () => {
    const returnPayload = false
    let payloadsCalled = 0
    const resolvePayloadCid = async () => {
      payloadsCalled++
      return returnPayload ? payloadCid : null
    }

    await withUniqueActiveDeals([DEFAULT_ACTIVE_DEAL])
    const expectedDealDbEntry = { id: 1, ...DEFAULT_ACTIVE_DEAL }
    assert.deepStrictEqual((await loadDeals(pgPool, 'SELECT * FROM active_deals')), [expectedDealDbEntry])
    // The payload is unretrievable and the last retrieval timestamp should be updated
    await resolvePayloadCids(getConstantPeerId, resolvePayloadCid, pgPool, 10000, now)
    // The timestamp on when the last retrieval of the payload was, was not yet set, so the piece indexer will try to fetch the payload
    assert.strictEqual(payloadsCalled, 1)
    expectedDealDbEntry.last_payload_retrieval_attempt = new Date(now)
    expectedDealDbEntry.payload_retrievability_state = PayloadRetrievabilityState.Unresolved
    assert.deepStrictEqual((await loadDeals(pgPool, 'SELECT * FROM active_deals')), [expectedDealDbEntry])
    // If we retry now without changing the field last_payload_retrieval_attempt the function for calling payload should not be called
    await resolvePayloadCids(getConstantPeerId, resolvePayloadCid, pgPool, 10000, now)
    assert.strictEqual(payloadsCalled, 1)
  })

  it('sets the payload to be unresolvable if the second attempt fails', async () => {
    const returnPayload = false
    let payloadsCalled = 0
    const resolvePayloadCid = async () => {
      payloadsCalled++
      return returnPayload ? payloadCid : null
    }
    // If we set the last_payload_retrieval_attempt to a value more than three days ago the piece indexer should try again to fetch the payload CID
    const deal = Value.Parse(ActiveDeal, {
      ...DEFAULT_ACTIVE_DEAL,
      last_payload_retrieval_attempt: new Date(now - 1000 * 60 * 60 * 24 * 4)
    })

    await withUniqueActiveDeals([deal])
    await resolvePayloadCids(getConstantPeerId, resolvePayloadCid, pgPool, 10000, now)
    assert.strictEqual(payloadsCalled, 1)
    // This is the second attempt that failed to fetch the payload CID so the deal should be marked as unretrievable
    const expectedDealDbEntry = {
      id: 1,
      ...deal,
      payload_retrievability_state: PayloadRetrievabilityState.TerminallyUnretrievable,
      last_payload_retrieval_attempt: new Date(now)
    }
    assert.deepStrictEqual((await loadDeals(pgPool, 'SELECT * FROM active_deals')), [expectedDealDbEntry])
    // Now the piece indexer should no longer call the payload request for this deal
    await resolvePayloadCids(getConstantPeerId, resolvePayloadCid, pgPool, 10000, now)
    assert.strictEqual(payloadsCalled, 1)
  })

  it('correctly updates the payloads if the retry succeeds', async () => {
    const returnPayload = true
    let payloadsCalled = 0
    const resolvePayloadCid = async () => {
      payloadsCalled++
      return returnPayload ? payloadCid : null
    }
    // If we set the last_payload_retrieval_attempt to a value more than three days ago the piece indexer should try again to fetch the payload CID
    const deal = Value.Parse(ActiveDeal, {
      ...DEFAULT_ACTIVE_DEAL,
      last_payload_retrieval_attempt: new Date(now - 1000 * 60 * 60 * 24 * 4)
    })

    await withUniqueActiveDeals([deal])
    await resolvePayloadCids(getConstantPeerId, resolvePayloadCid, pgPool, 10000, now)
    assert.strictEqual(payloadsCalled, 1)
    const expectedDealDbEntry = {
      id: 1,
      ...deal,
      payload_cid: payloadCid,
      payload_retrievability_state: PayloadRetrievabilityState.Resolved,
      last_payload_retrieval_attempt: new Date(now)
    }
    // The second attempt at retrieving the payload cid was successful and this should be reflected in the database entry
    assert.deepStrictEqual((await loadDeals(pgPool, 'SELECT * FROM active_deals')), [expectedDealDbEntry])

    // Now the piece indexer should no longer call the payload request for this deal
    await resolvePayloadCids(getConstantPeerId, resolvePayloadCid, pgPool, 10000, now)
    assert.strictEqual(payloadsCalled, 1)
  })

  it('counts number of resolved payload CIDs', async () => {
    await withUniqueActiveDeals([DEFAULT_ACTIVE_DEAL, { ...DEFAULT_ACTIVE_DEAL, miner_id: 2, payload_cid: 'PAYLOAD_CID', payload_retrievability_state: PayloadRetrievabilityState.Resolved }, { ...DEFAULT_ACTIVE_DEAL, miner_id: 3, payload_cid: 'PAYLOAD_CID', payload_retrievability_state: PayloadRetrievabilityState.Resolved }])
    const missingPayloadCids = await countStoredActiveDealsWithPayloadState(pgPool, PayloadRetrievabilityState.Resolved)
    assert.strictEqual(missingPayloadCids, 2n)
  })

  it('counts number of unresolved payload CIDs', async () => {
    await withUniqueActiveDeals([DEFAULT_ACTIVE_DEAL, { ...DEFAULT_ACTIVE_DEAL, miner_id: 2, payload_retrievability_state: PayloadRetrievabilityState.Unresolved }, { ...DEFAULT_ACTIVE_DEAL, miner_id: 3, payload_retrievability_state: PayloadRetrievabilityState.Unresolved }])
    const missingPayloadCids = await countStoredActiveDealsWithPayloadState(pgPool, PayloadRetrievabilityState.Unresolved)
    assert.strictEqual(missingPayloadCids, 2n)
  })

  it('counts number of terminally unretrievable payload CIDs', async () => {
    await withUniqueActiveDeals([DEFAULT_ACTIVE_DEAL, { ...DEFAULT_ACTIVE_DEAL, miner_id: 2, payload_cid: 'PAYLOAD_CID', payload_retrievability_state: PayloadRetrievabilityState.TerminallyUnretrievable }, { ...DEFAULT_ACTIVE_DEAL, miner_id: 3, payload_cid: 'PAYLOAD_CID', payload_retrievability_state: PayloadRetrievabilityState.TerminallyUnretrievable }])
    const missingPayloadCids = await countStoredActiveDealsWithPayloadState(pgPool, PayloadRetrievabilityState.TerminallyUnretrievable)
    assert.strictEqual(missingPayloadCids, 2n)
  })

  it('counts number of not yet queried payload CIDs', async () => {
    await withUniqueActiveDeals([DEFAULT_ACTIVE_DEAL, { ...DEFAULT_ACTIVE_DEAL, miner_id: 2, payload_retrievability_state: PayloadRetrievabilityState.NotQueried }, { ...DEFAULT_ACTIVE_DEAL, miner_id: 3, payload_retrievability_state: PayloadRetrievabilityState.NotQueried }])
    const missingPayloadCids = await countStoredActiveDealsWithPayloadState(pgPool, PayloadRetrievabilityState.NotQueried)
    assert.strictEqual(missingPayloadCids, 3n)
  })
})

describe('getPeerId', () => {
  it('should get peer ID from smart contract when available', async () => {
    const minerId = 123456
    const expectedPeerId = '12D3KooWGQmdpbssrYHWFTwwbKmKL3i54EJC9j7RRNb47U9jUv1U'

    // Mock the smart contract
    const mockSmartContract = {
      getPeerData: async () => ({
        peerID: expectedPeerId,
        signature: '0x1234567890abcdef'
      })
    }

    const mockRpcRequest = async () => {
      return { PeerId: '' }
    }

    const result = await getPeerId(minerId, {
      smartContract: mockSmartContract,
      makeRpcRequest: mockRpcRequest
    })

    assert.strictEqual(result.peerId, expectedPeerId)
    assert.strictEqual(result.source, 'smartContract')
  })

  it('should fall back to RPC when smart contract returns no peer ID', async () => {
    const minerId = 123456
    const expectedPeerId = '12D3KooWJ91c6xQshrNe7QAXPFAaeRrHWq2UrgXGPf8UmMZMwyZ5'

    // Mock the smart contract to return empty peer ID
    const mockSmartContract = {
      getPeerData: async () => ({
        peerID: '',
        signature: '0x'
      })
    }

    // Track RPC calls
    const mockRpcRequest = async () => {
      return { PeerId: expectedPeerId }
    }

    const result = await getPeerId(minerId, {
      smartContract: mockSmartContract,
      makeRpcRequest: mockRpcRequest
    })

    // Assertions
    assert.strictEqual(result.peerId, expectedPeerId)
    assert.strictEqual(result.source, 'minerInfo')
  })

  it('should throw error when both sources fail', async () => {
    const minerId = 999999

    // Mock the smart contract to throw error
    const mockSmartContract = {
      getPeerData: async () => {
        throw new Error('Smart contract error')
      }
    }

    // Mock the RPC request function to throw error
    const mockRpcRequest = async () => {
      throw new Error('RPC error')
    }
    await assert.rejects(
      async () => {
        await getPeerId(minerId, {
          smartContract: mockSmartContract,
          makeRpcRequest: mockRpcRequest
        })
      },
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.toString().includes(`Error fetching index provider PeerID for miner f0${minerId}`), err.toString())
        return true
      }
    )
  })

  // Real integration test (only run in CI or with network access)
  it('should successfully fetch a real peer ID', async function () {
    // Use a known valid miner ID from mainnet
    const minerId = 3303347 // f03303347

    // Get real result without mocks
    const result = await getPeerId(minerId)

    // Verify we got a valid peer ID
    assert.strictEqual(typeof result.peerId, 'string')
    assert.match(result.peerId, /^12D3K/, 'Peer ID should start with 12D3K')
    assert.ok(['smartContract', 'minerInfo'].includes(result.source),
      `Source should be 'smartContract' or 'minerInfo', got '${result.source}'`)
  })
})

describe('getCachedIndexProviderPeerId', () => {
  it('getCachedIndexProviderPeerId should cache the result', async () => {
    const testMinerId = 123
    const expectedResult = { peerId: 'peer-abc', source: 'mock' }

    let callCount = 0

    /**
     * @param {number} minerId
     * @returns {Promise<{ peerId: string, source: string }>}
     * */
    const mockGetIndexProviderPeerId = async (minerId) => {
      callCount++
      assert.strictEqual(minerId, testMinerId)
      return expectedResult
    }

    // Inject test LRU cache
    /** @type {LRUCache<number, {peerId:string,source:string}>} */
    const testCache = new LRUCache({
      max: 100,
      ttl: 1000 * 60 * 60 // 1 hour
    })

    // First call: should invoke the mock function
    const result1 = await getCachedIndexProviderPeerId(
      testMinerId,
      testCache,
      mockGetIndexProviderPeerId
    )
    assert.deepStrictEqual(result1, expectedResult)
    assert.strictEqual(callCount, 1)

    // Second call: should return from cache
    const result2 = await getCachedIndexProviderPeerId(
      testMinerId,
      testCache,
      mockGetIndexProviderPeerId
    )
    assert.deepStrictEqual(result2, expectedResult)
    assert.strictEqual(callCount, 1) // Should not have incremented
  })
})
