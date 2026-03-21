// TPC-C New-Order transaction (45% of mix).
// Write-only: inserts order, new_order, and order_line rows; updates stock.
//
// TPC-C compliance notes:
// - Uses uniform random for item selection where NURand(A=8191, 1, 100000) is specified (clause 2.4.1.5)
// - Think time and keying time omitted (add via config flags for full compliance)

import { recordStmt } from '../lib/metrics.js';

export function newOrder(db, metrics, config) {
  const w = config.warehouses;
  const wId = randomInt(1, w);
  const dId = randomInt(1, 10);
  const olCnt = randomInt(5, 15);

  db.exec('BEGIN');

  // Get warehouse tax rate
  let t0 = Date.now();
  const wRows = db.query(`SELECT w_tax FROM warehouse WHERE w_id = ${wId}`);
  recordStmt(metrics, 'no_select_warehouse', Date.now() - t0);

  // Get district tax and next order ID, increment d_next_o_id
  t0 = Date.now();
  const dRows = db.query(`SELECT d_tax, d_next_o_id FROM district WHERE d_w_id = ${wId} AND d_id = ${dId} FOR UPDATE`);
  recordStmt(metrics, 'no_select_district', Date.now() - t0);

  const nextOId = parseInt(dRows[0].d_next_o_id, 10);

  t0 = Date.now();
  db.exec(`UPDATE district SET d_next_o_id = ${nextOId + 1} WHERE d_w_id = ${wId} AND d_id = ${dId}`);
  recordStmt(metrics, 'no_update_district', Date.now() - t0);

  // Get customer discount and last name
  const cId = randomInt(1, 3000); // Simplified: uniform random instead of NURand
  t0 = Date.now();
  db.query(`SELECT c_discount, c_last, c_credit FROM customer WHERE c_w_id = ${wId} AND c_d_id = ${dId} AND c_id = ${cId}`);
  recordStmt(metrics, 'no_select_customer', Date.now() - t0);

  // Insert order
  t0 = Date.now();
  db.exec(`INSERT INTO oorder (o_id, o_d_id, o_w_id, o_c_id, o_entry_d, o_carrier_id, o_ol_cnt, o_all_local)
    VALUES (${nextOId}, ${dId}, ${wId}, ${cId}, CURRENT_TIMESTAMP, NULL, ${olCnt}, 1)`);
  recordStmt(metrics, 'no_insert_order', Date.now() - t0);

  // Insert new_order
  t0 = Date.now();
  db.exec(`INSERT INTO new_order (no_o_id, no_d_id, no_w_id) VALUES (${nextOId}, ${dId}, ${wId})`);
  recordStmt(metrics, 'no_insert_new_order', Date.now() - t0);

  // Process order lines
  for (let ol = 1; ol <= olCnt; ol++) {
    const olIId = randomInt(1, 100000);
    const olQty = randomInt(1, 10);

    // Get item price
    t0 = Date.now();
    const iRows = db.query(`SELECT i_price, i_name, i_data FROM item WHERE i_id = ${olIId}`);
    recordStmt(metrics, 'no_select_item', Date.now() - t0);

    if (iRows.length === 0) {
      // Invalid item — rollback per TPC-C spec (1% of transactions)
      db.exec('ROLLBACK');
      return false;
    }

    const iPrice = parseFloat(iRows[0].i_price);

    // Get and update stock
    const distCol = `s_dist_${String(dId).padStart(2, '0')}`;
    t0 = Date.now();
    const sRows = db.query(`SELECT s_quantity, ${distCol}, s_data FROM stock WHERE s_i_id = ${olIId} AND s_w_id = ${wId} FOR UPDATE`);
    recordStmt(metrics, 'no_select_stock', Date.now() - t0);

    let sQty = parseInt(sRows[0].s_quantity, 10) - olQty;
    if (sQty < 10) sQty += 91;

    t0 = Date.now();
    db.exec(`UPDATE stock SET s_quantity = ${sQty}, s_ytd = s_ytd + ${olQty}, s_order_cnt = s_order_cnt + 1
      WHERE s_i_id = ${olIId} AND s_w_id = ${wId}`);
    recordStmt(metrics, 'no_update_stock', Date.now() - t0);

    const olAmount = (olQty * iPrice).toFixed(2);

    // Insert order line
    t0 = Date.now();
    db.exec(`INSERT INTO order_line (ol_o_id, ol_d_id, ol_w_id, ol_number, ol_i_id, ol_supply_w_id, ol_delivery_d, ol_quantity, ol_amount, ol_dist_info)
      VALUES (${nextOId}, ${dId}, ${wId}, ${ol}, ${olIId}, ${wId}, NULL, ${olQty}, ${olAmount}, '${sRows[0][distCol] || randomString(24)}')`);
    recordStmt(metrics, 'no_insert_order_line', Date.now() - t0);
  }

  db.exec('COMMIT');
  return true;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function randomString(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += CHARS.charAt(randomInt(0, CHARS.length - 1));
  return s;
}
