# Stage 1: Build custom k6 binary with xk6-sql
FROM grafana/xk6:latest AS builder

RUN xk6 build \
    --with github.com/grafana/xk6-sql@v2.0.1 \
    --with github.com/grafana/xk6-sql-driver-postgres@v1.0.1 \
    --output /tmp/k6

# Stage 2: Minimal runtime
FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /tmp/k6 /usr/local/bin/k6
COPY scripts/ /scripts/

ENTRYPOINT ["k6"]
