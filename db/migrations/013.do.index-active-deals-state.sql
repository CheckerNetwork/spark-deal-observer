CREATE INDEX CONCURRENTLY active_deals_payload_retrievability_state ON active_deals (payload_retrievability_state);

CREATE INDEX CONCURRENTLY active_deals_submittable ON active_deals (submitted_at, payload_cid, activated_at_epoch, term_start_epoch, term_min)
WHERE submitted_at IS NULL AND payload_cid IS NOT NULL;
