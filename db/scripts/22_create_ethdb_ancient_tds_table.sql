\connect rollup;

CREATE TABLE IF NOT EXISTS ethdb.ancient_tds (
  block_number INTEGER PRIMARY KEY,
  td BYTEA NOT NULL
);

/* ROLLBACK SCRIPT
DROP TABLE ethdb.ancient_tds;
*/