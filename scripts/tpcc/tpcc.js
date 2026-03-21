// TPC-C full transaction mix — all 5 transaction types with standard weights.
//
// Mix ratios (TPC-C spec):
//   New-Order:    45%
//   Payment:      43%
//   Order-Status:  4%
//   Delivery:      4%
//   Stock-Level:   4%
//
// All transactions execute against the primary connection.

import { openPrimary, closeAll } from '../lib/db.js';
import { getConfig } from '../lib/config.js';
import { createMetrics, recordTx, recordError } from '../lib/metrics.js';
import { newOrder } from './new-order.js';
import { payment } from './payment.js';
import { orderStatus } from './order-status.js';
import { delivery } from './delivery.js';
import { stockLevel } from './stock-level.js';

const config = getConfig();
const metrics = createMetrics(config.metricsLevel);

const WEIGHTS = [
  { type: 'new_order',    weight: 45, fn: newOrder,    isRead: false },
  { type: 'payment',      weight: 43, fn: payment,     isRead: false },
  { type: 'order_status', weight: 4,  fn: orderStatus, isRead: true },
  { type: 'delivery',     weight: 4,  fn: delivery,    isRead: false },
  { type: 'stock_level',  weight: 4,  fn: stockLevel,  isRead: true },
];

// Build cumulative weight array for weighted random selection
const CUMULATIVE = [];
let totalWeight = 0;
for (const w of WEIGHTS) {
  totalWeight += w.weight;
  CUMULATIVE.push({ ...w, cumWeight: totalWeight });
}

export const options = {
  scenarios: {
    tpcc: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.K6_VUS || '20', 10),
      duration: __ENV.K6_DURATION || '600s',
    },
  },
  tags: {
    benchmark: 'tpcc',
    scenario: config.scenario,
    target: 'primary',
    connection_mode: config.connection.mode,
  },
};

export default function () {
  const db = openPrimary();

  // Weighted random selection
  const r = Math.random() * totalWeight;
  let selected = CUMULATIVE[CUMULATIVE.length - 1];
  for (const entry of CUMULATIVE) {
    if (r < entry.cumWeight) {
      selected = entry;
      break;
    }
  }

  const start = Date.now();
  try {
    const success = selected.fn(db, metrics, config);
    if (success !== false) {
      recordTx(metrics, selected.type, Date.now() - start, selected.isRead);
    } else {
      // Transaction returned false (e.g., invalid item in new-order) — not an error per TPC-C spec
      recordTx(metrics, selected.type, Date.now() - start, selected.isRead);
    }
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore rollback errors */ }
    recordError(metrics);
    console.error(`TPC-C ${selected.type} failed: ${e.message}`);
  }
}

export function teardown() {
  closeAll();
}
