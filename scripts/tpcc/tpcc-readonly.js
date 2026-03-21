// TPC-C with read transactions routed to replicas.
//
// Same mix as tpcc.js. Order-Status (4%) and Stock-Level (4%) are routed
// to the readonly connection, totaling 8% of transactions on replicas.
// All other transactions (92%) go to the primary.

import { openPrimary, openReadonly, closeAll, queryReadonly } from '../lib/db.js';
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
  { type: 'new_order',    weight: 45, fn: newOrder,    isRead: false, useReadonly: false },
  { type: 'payment',      weight: 43, fn: payment,     isRead: false, useReadonly: false },
  { type: 'order_status', weight: 4,  fn: orderStatus, isRead: true,  useReadonly: true },
  { type: 'delivery',     weight: 4,  fn: delivery,    isRead: false, useReadonly: false },
  { type: 'stock_level',  weight: 4,  fn: stockLevel,  isRead: true,  useReadonly: true },
];

const CUMULATIVE = [];
let totalWeight = 0;
for (const w of WEIGHTS) {
  totalWeight += w.weight;
  CUMULATIVE.push({ ...w, cumWeight: totalWeight });
}

export const options = {
  scenarios: {
    tpcc_readonly: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.K6_VUS || '20', 10),
      duration: __ENV.K6_DURATION || '600s',
    },
  },
  tags: {
    benchmark: 'tpcc-readonly',
    scenario: config.scenario,
    connection_mode: config.connection.mode,
  },
};

export default function () {
  // Weighted random selection
  const r = Math.random() * totalWeight;
  let selected = CUMULATIVE[CUMULATIVE.length - 1];
  for (const entry of CUMULATIVE) {
    if (r < entry.cumWeight) {
      selected = entry;
      break;
    }
  }

  // Route to the appropriate connection
  const db = selected.useReadonly ? openReadonly() : openPrimary();
  const target = selected.useReadonly ? 'readonly' : 'primary';

  const start = Date.now();
  try {
    const success = selected.fn(db, metrics, config);
    if (success !== false) {
      recordTx(metrics, selected.type, Date.now() - start, selected.isRead);
    } else {
      recordTx(metrics, selected.type, Date.now() - start, selected.isRead);
    }
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore rollback errors */ }
    recordError(metrics);
    console.error(`TPC-C ${selected.type} (${target}) failed: ${e.message}`);
  }
}

export function teardown() {
  closeAll();
}
