\connect rollup;

CREATE TABLE IF NOT EXISTS ethdb.ancient_hashes (
  block_number INTEGER PRIMARY KEY,
  hash BYTEA NOT NULL
);

/* ROLLBACK SCRIPT
DROP TABLE ethdb.ancient_hashes;
*/