// TPC-B horizontal scaling test — ramping read load to force replica scaling.
//
// Designed for reproducible comparison between:
//   A) Primary-only baseline (no replicas, all reads on primary)
//   B) Horizontal scaling (reads on replicas that scale under load)
//
// Write workload: constant VUs against primary (steady baseline)
// Read workload: ramping VUs against readonly endpoint (forces scaling)
//
// Phases:
//   1. Warmup     — low read VUs establish baseline metrics
//   2. Ramp-up    — read VUs increase linearly, intended to trigger HPA/autoscaler
//   3. Peak       — sustained high read load, measures scaled-out steady state
//   4. Ramp-down  — read VUs decrease, measures scale-down behavior
//   5. Cool-down  — low read VUs again, measures return to baseline
//
// Compare runs A vs B using the `testid` label in Grafana to see:
//   - When latency degrades on primary-only vs stays flat with replicas
//   - TPS ceiling on primary-only vs linear scaling with replicas
//   - Scale-out/scale-in timing and its effect on latency

import { openPrimary, openReadonly, closeAll, queryReadonly } from '../lib/db.js';
import { getConfig } from '../lib/config.js';
import { createMetrics, recordTx, recordError, recordStmt } from '../lib/metrics.js';

const config = getConfig();
const metrics = createMetrics(config.metricsLevel);

// Write workload — constant load on primary
const writeVus = parseInt(__ENV.K6_WRITE_VUS || '5', 10);

// Read workload — ramping stages
const readVusStart = parseInt(__ENV.K6_READ_VUS_START || '5', 10);
const readVusPeak = parseInt(__ENV.K6_READ_VUS_PEAK || '50', 10);
const warmupDuration = __ENV.K6_SCALE_WARMUP || '2m';
const rampUpDuration = __ENV.K6_SCALE_RAMP_UP || '5m';
const peakDuration = __ENV.K6_SCALE_PEAK || '10m';
const rampDownDuration = __ENV.K6_SCALE_RAMP_DOWN || '5m';
const coolDownDuration = __ENV.K6_SCALE_COOL_DOWN || '2m';

// Total test duration for the constant write workload
const totalDuration = __ENV.K6_DURATION || '24m';

export const options = {
  scenarios: {
    write_workload: {
      executor: 'constant-vus',
      vus: writeVus,
      duration: totalDuration,
      exec: 'writeTransaction',
      tags: { target: 'primary', workload: 'write' },
    },
    read_workload: {
      executor: 'ramping-vus',
      startVUs: readVusStart,
      stages: [
        { duration: warmupDuration, target: readVusStart },     // warmup: hold at baseline
        { duration: rampUpDuration, target: readVusPeak },      // ramp: linear increase
        { duration: peakDuration, target: readVusPeak },         // peak: sustained high load
        { duration: rampDownDuration, target: readVusStart },   // ramp-down: linear decrease
        { duration: coolDownDuration, target: readVusStart },   // cool-down: back to baseline
      ],
      exec: 'readTransaction',
      tags: { target: 'readonly', workload: 'read' },
    },
  },
  tags: {
    benchmark: 'tpcb-scale-test',
    scenario: config.scenario,
    connection_mode: config.connection.mode,
  },
};

// Full TPC-B transaction on primary (identical to tpcb-readonly.js)
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
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore rollback errors */ }
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

export default function () {
  readTransaction();
}

export function teardown() {
  closeAll();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
