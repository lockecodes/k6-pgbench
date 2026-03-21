// TPC-C Payment transaction (43% of mix).
// Write-only: updates warehouse/district YTD, customer balance, inserts history.
//
// TPC-C compliance notes:
// - Customer lookup by last name uses simplified approach (clause 2.5.2.2)
// - 60% by last name, 40% by ID

import { recordStmt } from '../lib/metrics.js';

const SYLLABLES = ['BAR', 'OUGHT', 'ABLE', 'PRI', 'PRES', 'ESE', 'ANTI', 'CALLY', 'ATION', 'EING'];

export function payment(db, metrics, config) {
  const w = config.warehouses;
  const wId = randomInt(1, w);
  const dId = randomInt(1, 10);
  const hAmount = (randomInt(100, 500000) / 100).toFixed(2);

  db.exec('BEGIN');

  // Update warehouse YTD
  let t0 = Date.now();
  db.exec(`UPDATE warehouse SET w_ytd = w_ytd + ${hAmount} WHERE w_id = ${wId}`);
  recordStmt(metrics, 'pay_update_warehouse', Date.now() - t0);

  t0 = Date.now();
  const wRows = db.query(`SELECT w_name, w_street_1, w_street_2, w_city, w_state, w_zip FROM warehouse WHERE w_id = ${wId}`);
  recordStmt(metrics, 'pay_select_warehouse', Date.now() - t0);

  // Update district YTD
  t0 = Date.now();
  db.exec(`UPDATE district SET d_ytd = d_ytd + ${hAmount} WHERE d_w_id = ${wId} AND d_id = ${dId}`);
  recordStmt(metrics, 'pay_update_district', Date.now() - t0);

  t0 = Date.now();
  const dRows = db.query(`SELECT d_name, d_street_1, d_street_2, d_city, d_state, d_zip FROM district WHERE d_w_id = ${wId} AND d_id = ${dId}`);
  recordStmt(metrics, 'pay_select_district', Date.now() - t0);

  // Customer lookup: 60% by last name, 40% by ID
  let cId;
  if (Math.random() < 0.6) {
    // By last name — find customer at midpoint of matching set
    const num = randomInt(0, 999);
    const lastName = customerLastName(num);
    t0 = Date.now();
    const cRows = db.query(
      `SELECT c_id FROM customer WHERE c_w_id = ${wId} AND c_d_id = ${dId} AND c_last = '${lastName}' ORDER BY c_first`
    );
    recordStmt(metrics, 'pay_select_customer_by_name', Date.now() - t0);

    if (cRows.length === 0) {
      db.exec('ROLLBACK');
      return false;
    }
    // Select the midpoint row per TPC-C spec
    cId = parseInt(cRows[Math.floor(cRows.length / 2)].c_id, 10);
  } else {
    cId = randomInt(1, 3000);
  }

  // Get customer data
  t0 = Date.now();
  const custRows = db.query(
    `SELECT c_first, c_middle, c_last, c_street_1, c_street_2, c_city, c_state, c_zip,
            c_phone, c_since, c_credit, c_credit_lim, c_discount, c_balance, c_data
     FROM customer WHERE c_w_id = ${wId} AND c_d_id = ${dId} AND c_id = ${cId}`
  );
  recordStmt(metrics, 'pay_select_customer', Date.now() - t0);

  // Update customer balance
  t0 = Date.now();
  if (custRows[0].c_credit === 'BC') {
    // Bad credit: append to c_data
    const newData = `${cId} ${dId} ${wId} ${dId} ${wId} ${hAmount}`;
    db.exec(
      `UPDATE customer SET c_balance = c_balance - ${hAmount}, c_ytd_payment = c_ytd_payment + ${hAmount},
       c_payment_cnt = c_payment_cnt + 1, c_data = LEFT('${newData}' || c_data, 500)
       WHERE c_w_id = ${wId} AND c_d_id = ${dId} AND c_id = ${cId}`
    );
  } else {
    db.exec(
      `UPDATE customer SET c_balance = c_balance - ${hAmount}, c_ytd_payment = c_ytd_payment + ${hAmount},
       c_payment_cnt = c_payment_cnt + 1
       WHERE c_w_id = ${wId} AND c_d_id = ${dId} AND c_id = ${cId}`
    );
  }
  recordStmt(metrics, 'pay_update_customer', Date.now() - t0);

  // Insert history
  const wName = wRows.length > 0 ? wRows[0].w_name : '';
  const dName = dRows.length > 0 ? dRows[0].d_name : '';
  const hData = `${wName}    ${dName}`;
  t0 = Date.now();
  db.exec(
    `INSERT INTO history (h_c_id, h_c_d_id, h_c_w_id, h_d_id, h_w_id, h_date, h_amount, h_data)
     VALUES (${cId}, ${dId}, ${wId}, ${dId}, ${wId}, CURRENT_TIMESTAMP, ${hAmount}, '${escapeSql(hData)}')`
  );
  recordStmt(metrics, 'pay_insert_history', Date.now() - t0);

  db.exec('COMMIT');
  return true;
}

function customerLastName(num) {
  return SYLLABLES[Math.floor(num / 100) % 10] +
         SYLLABLES[Math.floor(num / 10) % 10] +
         SYLLABLES[num % 10];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function escapeSql(s) {
  return s.replace(/'/g, "''");
}
