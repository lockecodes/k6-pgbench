// TPC-C NURand (Non-Uniform Random) distribution.
//
// NURand(A, x, y) = (((random(0, A) | random(x, y)) + C) % (y - x + 1)) + x
//
// The constant C is chosen randomly within [0, A] and held fixed for the
// duration of a test run. For A=255 (customer last name), C_RUN must satisfy
// |C_RUN - C_LOAD| not in {0, 65, 119, 96, 223, 230} (mod 256).

// C constants for each A value, chosen once at module load time.
// C_LOAD is used during data generation; C_RUN during test execution.
const C_LAST_LOAD = 157; // A=255 — fixed for reproducible data generation
const C_ID = Math.floor(Math.random() * 1024); // A=1023
const C_OL_I_ID = Math.floor(Math.random() * 8192); // A=8191

// C_RUN for A=255 must differ from C_LOAD per the constraint.
// |C_RUN - C_LOAD| must NOT be in {0, 65, 119, 96, 223, 230}.
const FORBIDDEN_DELTAS = new Set([0, 65, 119, 96, 223, 230]);

function pickCLastRun() {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = Math.floor(Math.random() * 256);
    const delta = Math.abs(candidate - C_LAST_LOAD) % 256;
    if (!FORBIDDEN_DELTAS.has(delta)) {
      return candidate;
    }
  }
  return 100; // safe fallback
}

const C_LAST_RUN = pickCLastRun();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Core NURand function.
function nurand(A, x, y, C) {
  return (((randomInt(0, A) | randomInt(x, y)) + C) % (y - x + 1)) + x;
}

// Customer ID: NURand(1023, 1, 3000)
export function nurandCustomerId() {
  return nurand(1023, 1, 3000, C_ID);
}

// Item ID: NURand(8191, 1, 100000)
export function nurandItemId() {
  return nurand(8191, 1, 100000, C_OL_I_ID);
}

// Customer last name number for test execution: NURand(255, 0, 999)
export function nurandLastName() {
  return nurand(255, 0, 999, C_LAST_RUN);
}

// Customer last name number for data generation: NURand(255, 0, 999) with C_LOAD
export function nurandLastNameLoad() {
  return nurand(255, 0, 999, C_LAST_LOAD);
}

// Uniform random fallback — matches the signatures above.
export function uniformCustomerId() {
  return randomInt(1, 3000);
}

export function uniformItemId() {
  return randomInt(1, 100000);
}

export function uniformLastName() {
  return randomInt(0, 999);
}

// Factory: returns the right set of functions based on config.
export function createRandom(useNurand) {
  if (useNurand) {
    return {
      customerId: nurandCustomerId,
      itemId: nurandItemId,
      lastName: nurandLastName,
      lastNameLoad: nurandLastNameLoad,
    };
  }
  return {
    customerId: uniformCustomerId,
    itemId: uniformItemId,
    lastName: uniformLastName,
    lastNameLoad: uniformLastName,
  };
}
