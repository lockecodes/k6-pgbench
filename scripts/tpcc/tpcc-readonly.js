// TPC-C with read transactions routed to replicas.
//
// Same mix as tpcc.js. Order-Status (4%) and Stock-Level (4%) are routed
// to the readonly connection, totaling 8% of transactions on replicas.
// All other transactions (92%) go to the primary.
//
// Supports all TPC-C compliance options: NURand, deferred delivery, think time.

import { openPrimary, openReadonly, closeAll } from '../lib/db.js';
import { getConfig } from '../lib/config.js';
import { createMetrics, recordTx, recordError } from '../lib/metrics.js';
import { createRandom } from '../lib/nurand.js';
import { applyKeyingTime, applyThinkTime } from '../lib/thinktime.js';
import { newOrder } from './new-order.js';
import { payment } from './payment.js';
import { orderStatus } from './order-status.js';
import { delivery } from './delivery.js';
import { stockLevel } from './stock-level.js';

const config = getConfig();
const metrics = createMetrics(config.metricsLevel);
const rng = createRandom(config.tpcc.nurand);

const TERMINAL_WEIGHTS = [
  { type: 'new_order',    weight: 45, fn: newOrder,    isRead: false, useReadonly: false, hasRng: true },
  { type: 'payment',      weight: 43, fn: payment,     isRead: false, useReadonly: false, hasRng: true },
  { type: 'order_status', weight: 4,  fn: orderStatus, isRead: true,  useReadonly: true,  hasRng: true },
  { type: 'stock_level',  weight: 4,  fn: stockLevel,  isRead: true,  useReadonly: true,  hasRng: false },
];

const ALL_WEIGHTS = [
  ...TERMINAL_WEIGHTS,
  { type: 'delivery',     weight: 4,  fn: delivery,    isRead: false, useReadonly: false, hasRng: false },
];

function buildCumulative(weights) {
  const cum = [];
  let total = 0;
  for (const w of weights) {
    total += w.weight;
    cum.push({ ...w, cumWeight: total });
  }
  return { entries: cum, total };
}

const activeWeights = config.tpcc.deferredDelivery ? TERMINAL_WEIGHTS : ALL_WEIGHTS;
const { entries: CUMULATIVE, total: totalWeight } = buildCumulative(activeWeights);

const vus = parseInt(__ENV.K6_VUS || '20', 10);
const duration = __ENV.K6_DURATION || '600s';

const scenarios = {
  tpcc_terminal: {
    executor: 'constant-vus',
    vus: config.tpcc.deferredDelivery ? Math.max(1, vus - Math.ceil(vus * 0.04)) : vus,
    duration: duration,
    exec: 'terminal',
  },
};

if (config.tpcc.deferredDelivery) {
  scenarios.tpcc_delivery = {
    executor: 'constant-vus',
    vus: Math.max(1, Math.ceil(vus * 0.04)),
    duration: duration,
    exec: 'deliveryWorker',
  };
}

export const options = {
  scenarios,
  tags: {
    benchmark: 'tpcc-readonly',
    scenario: config.scenario,
    connection_mode: config.connection.mode,
    cluster: config.cluster,
    namespace: config.namespace,
  },
};

export function terminal() {
  const r = Math.random() * totalWeight;
  let selected = CUMULATIVE[CUMULATIVE.length - 1];
  for (const entry of CUMULATIVE) {
    if (r < entry.cumWeight) {
      selected = entry;
      break;
    }
  }

  const db = selected.useReadonly ? openReadonly() : openPrimary();
  const target = selected.useReadonly ? 'readonly' : 'primary';

  if (config.tpcc.thinkTime) {
    applyKeyingTime(selected.type);
  }

  const start = Date.now();
  try {
    const success = selected.hasRng
      ? selected.fn(db, metrics, config, rng)
      : selected.fn(db, metrics, config);
    recordTx(metrics, selected.type, Date.now() - start, selected.isRead);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore rollback errors */ }
    recordError(metrics);
    console.error(`TPC-C ${selected.type} (${target}) failed: ${e.message}`);
  }

  if (config.tpcc.thinkTime) {
    applyThinkTime(selected.type);
  }
}

export function deliveryWorker() {
  const db = openPrimary();

  if (config.tpcc.thinkTime) {
    applyKeyingTime('delivery');
  }

  const start = Date.now();
  try {
    delivery(db, metrics, config);
    recordTx(metrics, 'delivery', Date.now() - start, false);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore rollback errors */ }
    recordError(metrics);
    console.error(`TPC-C delivery (deferred) failed: ${e.message}`);
  }

  if (config.tpcc.thinkTime) {
    applyThinkTime('delivery');
  }
}

export default function () {
  terminal();
}

export function teardown() {
  closeAll();
}
