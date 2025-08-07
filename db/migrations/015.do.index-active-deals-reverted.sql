CREATE INDEX CONCURRENTLY active_deals_reverted ON active_deals (reverted) WHERE reverted = true;
