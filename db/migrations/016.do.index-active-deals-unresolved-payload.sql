CREATE INDEX CONCURRENTLY active_deals_unresolved_payload ON active_deals (payload_cid) WHERE payload_cid IS NULL;
