import { it, describe } from 'node:test'
import { payloadCidRequest } from '../lib/piece-indexer-service.js'
import assert from 'node:assert/strict'

describe('piece-indexer-service', () => {
  describe('integration', () => {
    it('ignores missing deal payload cids', async () => {
      const sample = await payloadCidRequest('f0notfound', 'bafynotfound')
      assert.strictEqual(sample, null)
    })
  })
})
