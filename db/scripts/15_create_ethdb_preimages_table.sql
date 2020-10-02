\connect rollup;

CREATE TABLE IF NOT EXISTS ethdb.preimages (
  preimage_key BYTEA PRIMARY KEY,
  preimage BYTEA NOT NULL
);

/* ROLLBACK SCRIPT
DROP TABLE ethdb.preimages;
*/