\connect rollup;

CREATE TABLE IF NOT EXISTS ethdb.ancient_bodies (
  block_number INTEGER PRIMARY KEY,
  body BYTEA NOT NULL
);

/* ROLLBACK SCRIPT
DROP TABLE ethdb.ancient_bodies;
*/