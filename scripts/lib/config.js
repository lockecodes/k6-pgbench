// Config resolution from environment variables with sensible defaults.

export function getConfig() {
  const scale = parseInt(__ENV.K6_PGBENCH_SCALE || '50', 10);
  const metricsLevel = __ENV.K6_METRICS_LEVEL || 'standard';
  const scenario = __ENV.K6_BENCHMARK_SCENARIO || 'default';
  const connectionMode = __ENV.K6_PG_CONNECTION_MODE || 'separate';

  return {
    connection: {
      primary: {
        host: __ENV.K6_PG_HOST || 'localhost',
        port: parseInt(__ENV.K6_PG_PORT || '5432', 10),
        user: __ENV.K6_PG_USER || 'app',
        password: __ENV.K6_PG_PASSWORD || '',
        database: __ENV.K6_PG_DATABASE || 'app',
      },
      readonly: {
        host: __ENV.K6_PG_READONLY_HOST || '',
        port: parseInt(__ENV.K6_PG_READONLY_PORT || __ENV.K6_PG_PORT || '5432', 10),
        user: __ENV.K6_PG_READONLY_USER || __ENV.K6_PG_USER || 'app',
        password: __ENV.K6_PG_READONLY_PASSWORD || __ENV.K6_PG_PASSWORD || '',
        database: __ENV.K6_PG_READONLY_DATABASE || __ENV.K6_PG_DATABASE || 'app',
      },
      mode: connectionMode,
    },
    scale: scale,
    metricsLevel: metricsLevel,
    scenario: scenario,

    // TPC-C specific
    warehouses: parseInt(__ENV.K6_TPCC_WAREHOUSES || String(scale), 10),
    tpcc: {
      nurand: (__ENV.K6_TPCC_NURAND || 'true') === 'true',
      deferredDelivery: (__ENV.K6_TPCC_DEFERRED_DELIVERY || 'false') === 'true',
      thinkTime: (__ENV.K6_TPCC_THINK_TIME || 'false') === 'true',
    },

    // pg_stat sampler interval (comprehensive tier)
    pgstatInterval: parseInt(__ENV.K6_PGSTAT_INTERVAL || '10', 10),

    // Kubernetes context labels (for Prometheus filtering)
    cluster: __ENV.K6_CLUSTER_NAME || '',
    namespace: __ENV.K6_NAMESPACE || '',
  };
}

// Build a PostgreSQL connection string from connection config.
export function buildConnectionString(connConfig) {
  const { host, port, user, password, database } = connConfig;
  if (password) {
    return `postgres://${user}:${password}@${host}:${port}/${database}?sslmode=disable`;
  }
  return `postgres://${user}@${host}:${port}/${database}?sslmode=disable`;
}
