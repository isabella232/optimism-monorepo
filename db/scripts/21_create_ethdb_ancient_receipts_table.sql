\connect rollup;

CREATE TABLE IF NOT EXISTS ethdb.ancient_receipts (
  block_number INTEGER PRIMARY KEY,
  receipts BYTEA NOT NULL
);

/* ROLLBACK SCRIPT
DROP TABLE ethdb.ancient_receipts;
*/