\connect rollup;

CREATE TABLE IF NOT EXISTS ethdb.configs (
  config_key BYTEA PRIMARY KEY,
  config BYTEA NOT NULL
);

/* ROLLBACK SCRIPT
DROP TABLE ethdb.configs;
*/