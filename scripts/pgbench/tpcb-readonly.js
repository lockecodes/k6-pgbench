// TPC-B with read workload routed to replicas.
//
// NOTE: This is an intentional deviation from standard TPC-B for replica load testing.
// The standard TPC-B SELECT reads abalance just updated in the same transaction —
// routing it to a replica would return stale data.
//
// Instead, this runs two parallel workloads:
//   1. Write workload on primary: Full TPC-B transaction
//   2. Read workload on readonly: Independent SELECT queries
//
// Read/write ratio is controlled via VU counts per scenario.

import { openPrimary, openReadonly, closeAll, queryReadonly } from '../lib/db.js';
import { getConfig } from '../lib/config.js';
import { createMetrics, recordTx, recordError, recordStmt } from '../lib/metrics.js';

const config = getConfig();
const metrics = createMetrics(config.metricsLevel);

const writeVus = parseInt(__ENV.K6_WRITE_VUS || '5', 10);
const readVus = parseInt(__ENV.K6_READ_VUS || '5', 10);
const duration = __ENV.K6_DURATION || '600s';

export const options = {
  scenarios: {
    write_workload: {
      executor: 'constant-vus',
      vus: writeVus,
      duration: duration,
      exec: 'writeTransaction',
      tags: { target: 'primary' },
    },
    read_workload: {
      executor: 'constant-vus',
      vus: readVus,
      duration: duration,
      exec: 'readTransaction',
      tags: { target: 'readonly' },
    },
  },
  tags: {
    benchmark: 'tpcb-readonly',
    scenario: config.scenario,
    connection_mode: config.connection.mode,
  },
};

// Full TPC-B transaction on primary
export function writeTransaction() {
  const db = openPrimary();
  const scale = config.scale;

  const aid = randomInt(1, scale * 100000);
  const bid = randomInt(1, scale);
  const tid = randomInt(1, scale * 10);
  const delta = randomInt(-5000, 5000);

  const start = Date.now();
  try {
    db.exec('BEGIN');

    let t0 = Date.now();
    db.exec(`UPDATE pgbench_accounts SET abalance = abalance + ${delta} WHERE aid = ${aid}`);
    recordStmt(metrics, 'update_accounts', Date.now() - t0);

    t0 = Date.now();
    db.query(`SELECT abalance FROM pgbench_accounts WHERE aid = ${aid}`);
    recordStmt(metrics, 'select_abalance', Date.now() - t0);

    t0 = Date.now();
    db.exec(`UPDATE pgbench_tellers SET tbalance = tbalance + ${delta} WHERE tid = ${tid}`);
    recordStmt(metrics, 'update_tellers', Date.now() - t0);

    t0 = Date.now();
    db.exec(`UPDATE pgbench_branches SET bbalance = bbalance + ${delta} WHERE bid = ${bid}`);
    recordStmt(metrics, 'update_branches', Date.now() - t0);

    t0 = Date.now();
    db.exec(`INSERT INTO pgbench_history (tid, bid, aid, delta, mtime) VALUES (${tid}, ${bid}, ${aid}, ${delta}, CURRENT_TIMESTAMP)`);
    recordStmt(metrics, 'insert_history', Date.now() - t0);

    db.exec('END');

    recordTx(metrics, 'tpcb_write', Date.now() - start, false);
  } catch (e) {
    db.exec('ROLLBACK');
    recordError(metrics);
    console.error(`TPC-B write transaction failed: ${e.message}`);
  }
}

// Read-only SELECT on readonly connection
export function readTransaction() {
  const db = openReadonly();
  const scale = config.scale;
  const aid = randomInt(1, scale * 100000);

  const start = Date.now();
  try {
    queryReadonly(db, `SELECT abalance FROM pgbench_accounts WHERE aid = ${aid}`);
    recordTx(metrics, 'tpcb_read', Date.now() - start, true);
  } catch (e) {
    recordError(metrics);
    console.error(`TPC-B read query failed: ${e.message}`);
  }
}

export function teardown() {
  closeAll();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
