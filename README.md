# k6-pgbench

**pgbench (TPC-B)** and **TPC-C** benchmark implementations using [k6](https://grafana.com/docs/k6/) with the [xk6-sql](https://github.com/grafana/xk6-sql) extension. Designed for benchmarking [CloudNativePG](https://cloudnative-pg.io/) clusters with read replica routing, configurable metrics tiers, and optional Grafana Cloud observability.

## Features

- **Exact pgbench TPC-B** — faithful reproduction of pgbench's schema, data generation, and transaction logic (standard, select-only, simple-update modes)
- **Production-quality TPC-C** — 9-table schema with all 5 transaction types in the correct 45/43/4/4/4 weighted mix (see [TPC-C simplifications](#tpc-c-simplifications) for deviations from strict compliance)
- **Read replica routing** — separate connection strings for primary and readonly endpoints, with `separate` and `pooler` connection modes
- **Configurable metrics** — three tiers (minimal, standard, comprehensive) controlling how much telemetry is emitted
- **Prometheus remote write** — push metrics directly to Grafana Cloud or any Prometheus-compatible endpoint
- **Grafana dashboard** — importable dashboard with TPS, latency percentiles, per-transaction and per-statement breakdowns
- **CNPG example** — turnkey local environment using k3d, Tilt, and Helm charts

## Repository Structure

```
k6-pgbench/
├── Dockerfile                  # Custom k6 binary with xk6-sql
├── scripts/
│   ├── lib/
│   │   ├── config.js           # Environment-based configuration
│   │   ├── db.js               # Connection manager (primary/readonly routing)
│   │   ├── metrics.js          # Tiered metrics (minimal/standard/comprehensive)
│   │   └── pgstats.js          # pg_stat_* sampler (comprehensive tier)
│   ├── pgbench/
│   │   ├── init.js             # pgbench schema + data generation
│   │   ├── tpcb.js             # Standard TPC-B (pgbench default)
│   │   ├── select-only.js      # pgbench -S equivalent
│   │   ├── simple-update.js    # pgbench -N equivalent
│   │   └── tpcb-readonly.js    # Write/read split for replica testing
│   └── tpcc/
│       ├── init.js             # TPC-C 9-table schema + per-warehouse data
│       ├── tpcc.js             # Full TPC-C mix (45/43/4/4/4)
│       ├── tpcc-readonly.js    # Routes read txns to replicas
│       ├── new-order.js        # New-Order transaction (45%)
│       ├── payment.js          # Payment transaction (43%)
│       ├── order-status.js     # Order-Status transaction (4%)
│       ├── delivery.js         # Delivery transaction (4%)
│       └── stock-level.js      # Stock-Level transaction (4%)
├── dashboards/
│   └── k6-pgbench.json         # Grafana dashboard (import-ready)
└── examples/
    └── cnpg/                   # CloudNativePG local example
```

## Benchmark Types

| Type | Script | Description |
|------|--------|-------------|
| `tpcb` | `pgbench/tpcb.js` | Standard TPC-B — UPDATE accounts, SELECT abalance, UPDATE tellers, UPDATE branches, INSERT history |
| `tpcb-select-only` | `pgbench/select-only.js` | Read-only workload (`pgbench -S`) — SELECT abalance only |
| `tpcb-simple-update` | `pgbench/simple-update.js` | Simplified writes (`pgbench -N`) — skips tellers/branches updates |
| `tpcb-readonly` | `pgbench/tpcb-readonly.js` | Parallel write + read VU groups targeting primary and replicas |
| `tpcc` | `tpcc/tpcc.js` | Full TPC-C mix: New-Order 45%, Payment 43%, Order-Status 4%, Delivery 4%, Stock-Level 4% |
| `tpcc-readonly` | `tpcc/tpcc-readonly.js` | TPC-C with Order-Status and Stock-Level routed to read replicas |

## Metrics Tiers

| Tier | Metrics |
|------|---------|
| **minimal** | `pgbench_tps` (success rate), `pgbench_latency` (overall), `pgbench_errors` (error count) |
| **standard** | All minimal + per-transaction-type latency, per-statement latency, read/write TPS split, active connections |
| **comprehensive** | All standard + replication lag, waiting locks, per-table row counts (via pg_stat sampler) |

## Docker Image

The Dockerfile builds a custom k6 binary with PostgreSQL support:

```dockerfile
FROM grafana/xk6:latest AS builder
RUN xk6 build \
    --with github.com/grafana/xk6-sql@v1.0.6 \
    --with github.com/grafana/xk6-sql-driver-postgres@v0.1.2 \
    --output /tmp/k6
```

Build locally:

```bash
docker build -t k6-pgbench .
```

## Environment Variables

### Connection

| Variable | Default | Description |
|----------|---------|-------------|
| `K6_PG_HOST` | `localhost` | Primary PostgreSQL host |
| `K6_PG_PORT` | `5432` | Primary PostgreSQL port |
| `K6_PG_USER` | `app` | Database user |
| `K6_PG_PASSWORD` | (empty) | Database password |
| `K6_PG_DATABASE` | `app` | Database name |
| `K6_PG_READONLY_HOST` | (empty) | Readonly replica host |
| `K6_PG_READONLY_PORT` | same as primary | Readonly replica port |
| `K6_PG_CONNECTION_MODE` | `separate` | `separate` (distinct hosts) or `pooler` (SET commands for routing) |

### Benchmark

| Variable | Default | Description |
|----------|---------|-------------|
| `K6_PGBENCH_SCALE` | `50` | Scale factor (number of accounts = scale * 100,000) |
| `K6_VUS` | `5` | Number of virtual users |
| `K6_DURATION` | `600s` | Benchmark duration |
| `K6_METRICS_LEVEL` | `standard` | Metrics tier: `minimal`, `standard`, or `comprehensive` |
| `K6_TPCC_WAREHOUSES` | same as scale | Number of TPC-C warehouses |
| `K6_PGSTAT_INTERVAL` | `10` | Seconds between pg_stat samples (comprehensive tier) |

### Prometheus

| Variable | Default | Description |
|----------|---------|-------------|
| `K6_PROMETHEUS_RW_SERVER_URL` | (empty) | Prometheus remote write endpoint |
| `K6_PROMETHEUS_RW_USERNAME` | (empty) | Basic auth username |
| `K6_PROMETHEUS_RW_PASSWORD` | (empty) | Basic auth password |
| `K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM` | `true` | Send Trend metrics as native histograms |

---

## CNPG Example

The `examples/cnpg/` directory provides a complete local environment that deploys a CloudNativePG cluster on k3d and runs benchmarks against it using Tilt.

### Prerequisites

- **Docker** (running)
- **Tilt** ([install](https://docs.tilt.dev/install.html))
- **kubectl**
- **Helm**

k3d and ctlptl are installed automatically by `make cluster` if not present.

### Quick Start

```bash
cd examples/cnpg

# Create k3d cluster, build image, deploy CNPG, run TPC-B benchmark
make up
```

This will:

1. Create a k3d cluster with a local registry (`ctlptl-registry:5005`)
2. Install the CNPG operator
3. Deploy a single-instance PostgreSQL cluster
4. Build the k6-pgbench Docker image
5. Run the init job (create schema + load data at scale 50)
6. Run the benchmark job (TPC-B, 16 VUs, 10 minutes)

Tilt's UI opens at http://localhost:10350 where you can watch progress and logs.

### Make Targets

```
make up              # Start Tilt (creates cluster if needed)
make down            # Stop Tilt and tear down k8s resources
make cluster         # Ensure k3d cluster + registry exist
make clean           # Destroy k3d cluster and all temp files
make status          # Show pods, services, and jobs
make scenarios       # List available benchmark scenarios
make benchmark SCENARIO=tpcc-default   # Run a specific scenario
```

### Configuration

Configuration uses a layered YAML merge strategy:

```
values.yaml                  # Defaults (committed)
  + .values.override.yaml    # Local overrides (gitignored)
    + configs/<scenario>.yaml  # Scenario-specific settings
      + CLI --values           # Ad-hoc overrides via tilt up -- --values foo.yaml
```

Each layer is deep-merged on top of the previous one; later values win.

#### values.yaml (defaults)

```yaml
tilt:
  scenario: tpcb-default       # Which config from configs/ to load
  monitoring:
    enabled: false              # Enable Grafana kubernetes-monitoring

cnpg:
  instances: 1                  # Primary instances
  replicas: 0                   # Read replicas
  storage:
    size: 2Gi
  postgresql:
    parameters:
      shared_buffers: "256MB"

k6:
  benchmark:
    type: tpcb                  # Benchmark type (see table above)
    scale: 50                   # Scale factor
    vus: 5                      # Virtual users
    duration: "600s"            # Test duration
    warmupDuration: "300s"
    readOnly: false             # Enable readonly replica routing
    connectionMode: separate    # separate or pooler
    metricsLevel: standard      # minimal, standard, or comprehensive
  connection:
    port: 5432
    user: app
    database: app

monitoring: {}                  # Grafana k8s-monitoring values (see below)
```

#### .values.override.yaml (local overrides)

Create this file to customize your local environment. It is gitignored.

```yaml
tilt:
  monitoring:
    enabled: true

# Direct k6 → Grafana Cloud Prometheus remote write
k6:
  prometheus:
    enabled: true
    remoteWriteUrl: "https://prometheus-prod-XX-prod-XX.grafana.net/api/prom/push"
    username: "YOUR_PROMETHEUS_USERNAME"
    password: "YOUR_GRAFANA_CLOUD_API_KEY"

# Grafana kubernetes-monitoring (Alloy) — cluster metrics, logs, events
monitoring:
  k8sMonitoring:
    cluster:
      name: your-cluster-name
    destinations:
      - name: grafana-cloud-metrics
        type: prometheus
        url: https://prometheus-prod-XX-prod-XX.grafana.net/api/prom/push
        auth:
          type: basic
          username: "YOUR_PROMETHEUS_USERNAME"
          password: "YOUR_GRAFANA_CLOUD_API_KEY"
      - name: grafana-cloud-logs
        type: loki
        url: https://logs-prod-XXX.grafana.net/loki/api/v1/push
        auth:
          type: basic
          username: "YOUR_LOKI_USERNAME"
          password: "YOUR_GRAFANA_CLOUD_API_KEY"
```

### Scenario Configs

Predefined scenarios live in `examples/cnpg/configs/`. Each is a partial YAML overlay that gets merged into the base config.

#### tpcb-default.yaml

```yaml
# TPC-B default — pgbench equivalent, 16 VUs, scale 50, 10m duration
k6:
  benchmark:
    type: tpcb
    scale: 50
    vus: 16
    duration: "600s"
    metricsLevel: standard
```

#### tpcc-default.yaml

```yaml
# TPC-C default — 10 warehouses, 20 VUs, full transaction mix, 10m duration
k6:
  benchmark:
    type: tpcc
    scale: 10
    warehouses: "10"
    vus: 20
    duration: "600s"
    metricsLevel: standard
```

#### tpcc-readonly.yaml

```yaml
# TPC-C readonly — 2 replicas, read txns routed to replicas, 10m duration
cnpg:
  replicas: 2

k6:
  benchmark:
    type: tpcc-readonly
    scale: 10
    warehouses: "10"
    vus: 20
    duration: "600s"
    readOnly: true
    connectionMode: separate
    metricsLevel: standard
```

#### Creating Custom Scenarios

Create a new file in `configs/`:

```yaml
# configs/my-heavy-load.yaml
# Heavy TPC-B — 100 VUs, scale 200, comprehensive metrics
cnpg:
  instances: 1
  replicas: 0
  storage:
    size: 10Gi
  postgresql:
    parameters:
      shared_buffers: "1GB"
      max_connections: "400"

k6:
  benchmark:
    type: tpcb
    scale: 200
    vus: 100
    duration: "1800s"
    metricsLevel: comprehensive
```

Then run it:

```bash
# Via Tilt scenario selection
make benchmark SCENARIO=my-heavy-load

# Or set in .values.override.yaml
tilt:
  scenario: my-heavy-load
```

### Read Replica Testing

To benchmark read replicas, use a `readonly` benchmark type with replicas configured:

```yaml
# .values.override.yaml or a custom scenario config
cnpg:
  replicas: 2

k6:
  benchmark:
    type: tpcb-readonly    # or tpcc-readonly
    readOnly: true
    connectionMode: separate
```

In `separate` mode, CNPG's `-rw` and `-ro` services route connections to the appropriate instances. In `pooler` mode, a single connection is used with `SET` commands to switch between read and write targets (useful with PgBouncer-style poolers).

### Monitoring & Grafana

There are two independent monitoring paths:

1. **k6 Prometheus remote write** — k6 pushes benchmark metrics directly to a Prometheus endpoint (e.g., Grafana Cloud). Configure under `k6.prometheus` in your override file.

2. **Grafana kubernetes-monitoring** — deploys Alloy agents that scrape cluster metrics, pod logs, and events, sending them to Grafana Cloud. Configure under `monitoring.k8sMonitoring` and enable with `tilt.monitoring.enabled: true`.

Both are optional and independent. You can use one, both, or neither.

#### Grafana Dashboard

Import `dashboards/k6-pgbench.json` into Grafana:

**Grafana UI** > **Dashboards** > **Import** > **Upload JSON file** > select the file > choose your Prometheus datasource.

The dashboard includes:

- **Overview** — VUs, TPS, iterations, success rate, errors, avg latency
- **Throughput** — TPS over time, read/write/success rate split
- **Latency** — p50/p95/p99 percentiles, error rate
- **Transaction Breakdown** — per-type latency for TPC-B and TPC-C transactions
- **Statement-Level Performance** (collapsed) — per-SQL-statement p95 latency
- **Database Health** (collapsed) — replication lag, waiting locks, active connections
- **k6 Engine** — VU ramp, iteration rate, iteration duration

A `testid` template variable lets you filter between test runs.

> **Note:** k6's Prometheus remote write prefixes all metrics with `k6_` and applies naming transforms (e.g., `pgbench_latency` becomes `k6_pgbench_latency_seconds`). The dashboard queries use these transformed names. The standard k6 dashboard (18030) will not work — it expects HTTP metrics.

### Tilt Workflow

The Tiltfile orchestrates deployment in phases with dependency ordering:

```
create-namespace
    └─→ cnpg-operator
            └─→ cnpg-cluster
                    └─→ wait-for-cluster
                            └─→ docker_build (k6-pgbench image)
                                    └─→ k6-init (schema + data load)
                                            └─→ k6-benchmark (run test)
```

If monitoring is enabled, `grafana-k8s-monitoring` deploys in parallel after namespace creation.

Tilt watches `values.yaml`, `.values.override.yaml`, and the active scenario config for live reloads. Changes to `scripts/` or the `Dockerfile` trigger an image rebuild and job re-run.

### Helm Charts

The example uses three local Helm charts under `examples/cnpg/charts/`:

| Chart | Description |
|-------|-------------|
| `cnpg/` | CNPG `Cluster` CR with configurable instances, storage, and PostgreSQL parameters |
| `k6/` | Two Kubernetes Jobs — `k6-init` (schema/data) and `k6-benchmark` (test run) |
| `monitoring/` | Wrapper around `grafana/k8s-monitoring` chart (Alloy-based telemetry) |

### Troubleshooting

**Tilt keeps reloading in a loop**
The `tmp/` directory is ignored via `watch_settings(ignore=['tmp'])`. If you see reloads, check that nothing else is writing inside the watched context.

**CNPG operator install times out**
The default Tilt timeout is extended to 300s. If it still times out, check pod logs: `kubectl -n cnpg-system logs -l app.kubernetes.io/name=cloudnative-pg`

**k6 init job fails with connection refused**
The init job has a `wait-for-postgres` init container that polls the CNPG `-rw` service. If the cluster is slow to start, the job will retry (backoffLimit: 3).

**Alloy pods in CreateContainerConfigError**
The kubernetes-monitoring chart creates secrets from the `destinations` and `remoteConfig` auth credentials. If secrets are missing, verify your `.values.override.yaml` has the full `monitoring.k8sMonitoring` section with `destinations` and the `alloy-*` `remoteConfig` blocks.

**No data in Grafana dashboard**
Verify k6 is running with `--out experimental-prometheus-rw` by checking the benchmark pod logs. Confirm `k6.prometheus.enabled: true` and that `remoteWriteUrl`, `username`, and `password` are set in your override file.

## TPC-C Simplifications

The TPC-C implementation preserves full transaction semantics and is suitable for realistic database benchmarking, but deviates from strict TPC-C compliance in three documented areas:

| Area | Spec Requirement | Current Implementation |
|------|-----------------|----------------------|
| **Customer/item selection** | NURand distribution (non-uniform random with hotspot bias) | Uniform random. Affects data access patterns — uniform spreads load evenly rather than concentrating on hot rows. |
| **Delivery execution** | Deferred/background transaction (clause 2.7.4) | Runs inline as a single transaction. Does not affect SQL logic, only execution model. |
| **Think time / keying time** | Terminal emulation delays between transactions | Omitted. Standard practice for automated load testing harnesses. |

The pgbench (TPC-B) implementation is an exact match to native `pgbench` — schema, data generation, random distributions, and all transaction variants.

## License

See [LICENSE](LICENSE).
