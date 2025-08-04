/** @import {PgPool, Queryable} from '@filecoin-station/deal-observer-db' */
/** @import { Static } from '@sinclair/typebox' */
import Cursor from 'pg-cursor'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

/**
 * Finds deals that haven't been submitted to the Spark API yet and submits them.
 *
 * @param {PgPool} pgPool
 * @param {number} batchSize
 * @param {(eligibleDeals: Array<Static<typeof SubmittableDeal>>) => Promise<{ingested: number; skipped: number}>} submitDeals
 * @returns {Promise<{submitted: number; ingested: number; skipped: number;}>} Number of deals submitted, ingested and skipped
 */
export const findAndSubmitUnsubmittedDeals = async (pgPool, batchSize, submitDeals) => {
  const result = { submitted: 0, ingested: 0, skipped: 0 }
  for await (const deals of findUnsubmittedDeals(pgPool, batchSize)) {
    console.debug(`Found ${deals.length} unsubmitted deals`)
    try {
      const { ingested, skipped } = await submitDeals(deals)
      console.log(`Successfully submitted ${deals.length} deals. ${ingested} deals were added, ${skipped} were skipped.`)
      await markDealsAsSubmitted(pgPool, deals.map(deal => deal.id))
      result.submitted += deals.length
      result.ingested += ingested
      result.skipped += skipped
    } catch (e) {
      console.error('Failed to submit deals:', e)
    }
  }

  return result
}

/**
 * Finds deals that haven't been submitted to spark api.
 * For deals to be submitted they must
 * - have not been submitted yet
 * - were created more than 2 days ago
 *     Explanation by @pyropy:
 *     > This due that whole implication of overriding deals ingested by
 *     > fil-deal-ingester. Observed deals might lack Payload CID (it's set to
 *     > null) and that might override Payload CID that's already in the
 *     > database)
 * - have payload cid
 * - have not yet expired
 *
 * @param {PgPool} pgPool
 * @param {number} batchSize
 * @returns {AsyncGenerator<Array<Static<typeof SubmittableDeal>>>}
 */
const findUnsubmittedDeals = async function * (pgPool, batchSize) {
  const client = await pgPool.connect()
  const cursor = client.query(new Cursor(`
    WITH two_days_ago AS (
        SELECT (NOW() - INTERVAL '2 days')::TIMESTAMP AS ts
    )
    SELECT
        id,
        miner_id,
        client_id,
        piece_cid,
        piece_size,
        payload_cid,
        epoch_to_timestamp(term_start_epoch + term_min) AS expires_at
    FROM
        active_deals
    WHERE
        submitted_at IS NULL
        AND payload_cid IS NOT NULL
        AND activated_at_epoch < timestamp_to_epoch((SELECT ts FROM two_days_ago))
        AND epoch_to_timestamp(term_start_epoch + term_min) > NOW()`
  ))

  while (true) {
    const rows = await cursor.read(batchSize)
    if (rows.length === 0) break
    yield rows.map(row => Value.Parse(SubmittableDeal, row))
  }

  client.release()
}

/**
 * Mark deals as submitted.
 *
 * @param {Queryable} pgPool
 * @param {Array<number>} dealIds
 */
const markDealsAsSubmitted = async (pgPool, dealIds) => {
  await pgPool.query(`
    UPDATE active_deals ad
    SET submitted_at = NOW()
    FROM (
      SELECT
        unnest($1::INT[]) AS id
    ) AS t
    WHERE ad.id = t.id
  `, [
    dealIds
  ])
}

/**
 * Submits deals to a spark api.
 *
 * @param {string} sparkApiBaseURL
 * @param {string} sparkApiToken
 * @param {Array<Static<typeof SubmittableDeal>>} deals
 * @returns {Promise<{ingested: number; skipped: number}>}
 */
export const submitDealsToSparkApi = async (sparkApiBaseURL, sparkApiToken, deals) => {
  console.debug(`Submitting ${deals.length} deals to Spark API`)
  const response = await fetch(`${sparkApiBaseURL}/eligible-deals-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sparkApiToken}`
    },
    body: JSON.stringify(deals.map(deal => ({
      minerId: `f0${deal.miner_id}`,
      clientId: `f0${deal.client_id}`,
      pieceCid: deal.piece_cid,
      pieceSize: deal.piece_size.toString(),
      payloadCid: deal.payload_cid,
      expiresAt: deal.expires_at
    })))
  })

  if (!response.ok) {
    let msg = `Failed to submit deals (status ${response.status}): ${await response.text().catch(() => null)}`
    if (response.status === 400) {
      const stringified = JSON.stringify(
        deals[0],
        (_, v) => typeof v === 'bigint' ? `<bigint> ${v.toString()}` : v
      )
      msg += `\ndeals[0]: ${stringified}}`
    }
    throw new Error(msg)
  }

  return /** @type {{ingested: number; skipped: number}} */ (await response.json())
}

const SubmittableDeal = Type.Object({
  id: Type.Number(),
  miner_id: Type.Number(),
  client_id: Type.Number(),
  piece_cid: Type.String(),
  piece_size: Type.BigInt(),
  payload_cid: Type.String(),
  expires_at: Type.Date()
})
