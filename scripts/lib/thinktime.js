// TPC-C terminal emulation: keying time and think time.
//
// Keying time (clause 5.2.5.2): fixed delay before each transaction.
// Think time (clause 5.2.5.4): negative exponential distribution after each transaction.
//
// All times in seconds.

import { sleep } from 'k6';

// Keying times per transaction type (seconds) — TPC-C clause 5.2.5.2
const KEYING_TIME = {
  new_order: 18.0,
  payment: 3.0,
  order_status: 2.0,
  delivery: 2.0,
  stock_level: 2.0,
};

// Think time means per transaction type (seconds) — TPC-C clause 5.2.5.4
const THINK_TIME_MEAN = {
  new_order: 12.0,
  payment: 12.0,
  order_status: 10.0,
  delivery: 5.0,
  stock_level: 5.0,
};

// Negative exponential distribution: -mean * ln(random)
// Clamped to 10x mean per TPC-C spec (clause 5.2.5.4).
function negativeExponential(mean) {
  const r = Math.random();
  // Avoid log(0)
  const val = -mean * Math.log(r === 0 ? 1e-10 : r);
  return Math.min(val, 10 * mean);
}

// Apply keying time before a transaction.
export function applyKeyingTime(txType) {
  const t = KEYING_TIME[txType];
  if (t && t > 0) {
    sleep(t);
  }
}

// Apply think time after a transaction.
export function applyThinkTime(txType) {
  const mean = THINK_TIME_MEAN[txType];
  if (mean && mean > 0) {
    sleep(negativeExponential(mean));
  }
}
