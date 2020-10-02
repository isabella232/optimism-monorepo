\connect rollup;

CREATE TABLE IF NOT EXISTS ethdb.bloom_indexes (
  bbi_key BYTEA PRIMARY KEY,
  index BYTEA NOT NULL
);

/* ROLLBACK SCRIPT
DROP TABLE ethdb.bloom_indexes;
*/