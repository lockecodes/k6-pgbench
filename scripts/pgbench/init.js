// pgbench schema initialization — exact equivalent of `pgbench -i`.
// Creates tables, populates data, adds primary keys, runs VACUUM ANALYZE.

import sql from 'k6/x/sql';
import driver from 'k6/x/sql/driver/postgres';
import { getConfig, buildConnectionString } from '../lib/config.js';

const BATCH_SIZE = 1000;

export const options = {
  iterations: 1,
  vus: 1,
};

export default function () {
  const config = getConfig();
  const db = sql.open(driver, buildConnectionString(config.connection.primary));
  const scale = config.scale;

  try {
    initSchema(db, scale);
  } finally {
    db.close();
  }
}

function initSchema(db, scale) {
  console.log(`Initializing pgbench schema with scale factor ${scale}`);

  // Drop existing tables (idempotent)
  db.exec('DROP TABLE IF EXISTS pgbench_history');
  db.exec('DROP TABLE IF EXISTS pgbench_accounts');
  db.exec('DROP TABLE IF EXISTS pgbench_tellers');
  db.exec('DROP TABLE IF EXISTS pgbench_branches');

  // Create tables — exact pgbench schema
  db.exec(`CREATE TABLE pgbench_branches (
    bid INT NOT NULL,
    bbalance INT NOT NULL,
    filler CHAR(88) NOT NULL DEFAULT ''
  )`);

  db.exec(`CREATE TABLE pgbench_tellers (
    tid INT NOT NULL,
    bid INT NOT NULL,
    tbalance INT NOT NULL,
    filler CHAR(84) NOT NULL DEFAULT ''
  )`);

  db.exec(`CREATE TABLE pgbench_accounts (
    aid INT NOT NULL,
    bid INT NOT NULL,
    abalance INT NOT NULL,
    filler CHAR(84) NOT NULL DEFAULT ''
  )`);

  db.exec(`CREATE TABLE pgbench_history (
    tid INT NOT NULL,
    bid INT NOT NULL,
    aid INT NOT NULL,
    delta INT NOT NULL,
    mtime TIMESTAMP NOT NULL,
    filler CHAR(22)
  )`);

  // Populate pgbench_branches
  console.log(`Populating pgbench_branches: ${scale} rows`);
  for (let bid = 1; bid <= scale; bid++) {
    db.exec(`INSERT INTO pgbench_branches (bid, bbalance, filler) VALUES (${bid}, 0, '')`);
  }

  // Populate pgbench_tellers
  const numTellers = scale * 10;
  console.log(`Populating pgbench_tellers: ${numTellers} rows`);
  for (let i = 0; i < numTellers; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, numTellers);
    const values = [];
    for (let j = i; j < batchEnd; j++) {
      const tid = j + 1;
      const bid = Math.floor(j / 10) + 1;
      values.push(`(${tid}, ${bid}, 0, '')`);
    }
    db.exec(`INSERT INTO pgbench_tellers (tid, bid, tbalance, filler) VALUES ${values.join(',')}`);
  }

  // Populate pgbench_accounts
  const numAccounts = scale * 100000;
  console.log(`Populating pgbench_accounts: ${numAccounts} rows`);
  for (let i = 0; i < numAccounts; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, numAccounts);
    const values = [];
    for (let j = i; j < batchEnd; j++) {
      const aid = j + 1;
      const bid = Math.floor(j / 100000) + 1;
      values.push(`(${aid}, ${bid}, 0, '')`);
    }
    db.exec(`INSERT INTO pgbench_accounts (aid, bid, abalance, filler) VALUES ${values.join(',')}`);
  }

  // Add primary keys
  console.log('Creating primary keys');
  db.exec('ALTER TABLE pgbench_branches ADD PRIMARY KEY (bid)');
  db.exec('ALTER TABLE pgbench_tellers ADD PRIMARY KEY (tid)');
  db.exec('ALTER TABLE pgbench_accounts ADD PRIMARY KEY (aid)');

  // VACUUM and ANALYZE
  console.log('Running VACUUM ANALYZE');
  db.exec('VACUUM ANALYZE pgbench_branches');
  db.exec('VACUUM ANALYZE pgbench_tellers');
  db.exec('VACUUM ANALYZE pgbench_accounts');
  db.exec('VACUUM ANALYZE pgbench_history');

  console.log('pgbench initialization complete');
}
