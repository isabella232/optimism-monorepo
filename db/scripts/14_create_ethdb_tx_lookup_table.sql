\connect rollup;

CREATE TABLE IF NOT EXISTS ethdb.tx_lookups (
  lookup_key BYTEA PRIMARY KEY,
  lookup BYTEA NOT NULL
);

/* ROLLBACK SCRIPT
DROP TABLE ethdb.tx_lookups;
*/