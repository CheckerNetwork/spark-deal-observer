import assert from 'node:assert'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import { createPgPool, migrateWithPgClient } from '@filecoin-station/deal-observer-db'
import { calculateActiveDealEpochs, daysAgo, daysFromNow, today } from './test-helpers.js'
import { findAndSubmitUnsubmittedDeals } from '../lib/spark-api-submit-deals.js'

describe('Submit deals to spark-api', () => {
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
    // This deal is eligible for submission
    await givenActiveDeal(pgPool, { minerId: 0, clientId: 1, createdAt: daysAgo(3), startsAt: today(), expiresAt: daysFromNow(10), pieceCid: 'baga1', payloadCid: 'bafy' })
    await givenActiveDeal(pgPool, { minerId: 0, clientId: 2, createdAt: daysAgo(5), startsAt: daysAgo(1), expiresAt: daysFromNow(5), pieceCid: 'baga2', payloadCid: 'bafy' })
    // This deal is not eligible for submission because it has no payload cid
    await givenActiveDeal(pgPool, { minerId: 0, clientId: 2, createdAt: daysAgo(3), startsAt: today(), expiresAt: daysFromNow(10), pieceCid: 'baga1' })
    // This deal is not eligible for submission because it was created less than 2 days ago
    await givenActiveDeal(pgPool, { minerId: 0, clientId: 2, createdAt: today(), startsAt: today(), expiresAt: daysFromNow(10), pieceCid: 'baga1', payloadCid: 'bafy' })
    // This deal is not eligible for submission because it has expired
    await givenActiveDeal(pgPool, { minerId: 0, clientId: 2, createdAt: daysAgo(10), startsAt: daysAgo(10), expiresAt: daysAgo(5), pieceCid: 'baga1', payloadCid: 'bafy' })
  })

  it('finds and submits deals to the spark api', async () => {
    const batchSize = 10
    const mockSubmitEligibleDeals = mock.fn()

    await findAndSubmitUnsubmittedDeals(pgPool, batchSize, mockSubmitEligibleDeals)
    const { rows } = await pgPool.query('SELECT * FROM active_deals WHERE submitted_at IS NOT NULL')
    assert.strictEqual(rows.length, 2)
    assert.strictEqual(mockSubmitEligibleDeals.mock.calls.length, 1)
  })

  it('finds and submits deals in two batches to the spark api', async () => {
    const batchSize = 1
    const mockSubmitEligibleDeals = mock.fn()

    // two deals are eligible for submission, batchSize is 1
    await findAndSubmitUnsubmittedDeals(pgPool, batchSize, mockSubmitEligibleDeals)
    const { rows } = await pgPool.query('SELECT * FROM active_deals WHERE submitted_at IS NOT NULL')
    assert.strictEqual(rows.length, 2)
    assert.strictEqual(mockSubmitEligibleDeals.mock.calls.length, 2)
  })
})

const givenActiveDeal = async (pgPool, { createdAt, startsAt, expiresAt, minerId = 2, clientId = 3, pieceCid = 'cidone', payloadCid = null }) => {
  const { activatedAtEpoch, termStart, termMin, termMax } = calculateActiveDealEpochs(createdAt, startsAt, expiresAt)
  await pgPool.query(
    `INSERT INTO active_deals 
    (activated_at_epoch, miner_id, client_id, piece_cid, piece_size, sector_id, term_start_epoch, term_min, term_max, payload_cid)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [activatedAtEpoch, minerId, clientId, pieceCid, 1024, 6, termStart, termMin, termMax, payloadCid]
  )
}
