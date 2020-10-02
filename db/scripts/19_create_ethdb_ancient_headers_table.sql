\connect rollup;

CREATE TABLE IF NOT EXISTS ethdb.ancient_headers (
  block_number INTEGER PRIMARY KEY,
  header BYTEA NOT NULL
);

/* ROLLBACK SCRIPT
DROP TABLE ethdb.ancient_headers;
*/