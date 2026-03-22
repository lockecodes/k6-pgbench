#!/usr/bin/env bash
#
# utils.sh — Utility functions for k6-pgbench CNPG example.
#
# Usage: scripts/utils.sh <command> [args...]
#
# Commands:
#   ensure-cluster
#   status [ns]
#
set -euo pipefail

# ── Tool resolution ─────────────────────────────────────────────────
KUBECTL="${KUBECTL:-$(command -v kubectl 2>/dev/null || echo "${HOME}/.rd/bin/kubectl")}"

# ── Logging ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()   { echo -e "${BLUE}==>${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail()  { echo -e "${RED}  ✗${NC} $*"; exit 1; }

# ── Commands ────────────────────────────────────────────────────────

cmd_ensure_cluster() {
    local script_dir example_dir tmp_dir
    script_dir="$(cd "$(dirname "$0")" && pwd)"
    example_dir="$(dirname "$script_dir")"
    tmp_dir="${example_dir}/tmp"

    # Ensure ~/.local/bin exists and is in PATH
    mkdir -p "${HOME}/.local/bin"
    export PATH="${HOME}/.local/bin:${PATH}"

    local ctlptl
    ctlptl="$(command -v ctlptl 2>/dev/null || echo "")"
    if [ -z "$ctlptl" ]; then
        log "Installing ctlptl..."
        local ctlptl_version="0.8.36"
        curl -fsSL "https://github.com/tilt-dev/ctlptl/releases/download/v${ctlptl_version}/ctlptl.${ctlptl_version}.linux.x86_64.tar.gz" \
            | tar -xz -C "${HOME}/.local/bin" ctlptl
        ctlptl="${HOME}/.local/bin/ctlptl"
        ok "ctlptl installed"
    fi

    local k3d
    k3d="$(command -v k3d 2>/dev/null || echo "")"
    if [ -z "$k3d" ]; then
        log "Installing k3d..."
        curl -fsSL https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh \
            | K3D_INSTALL_DIR="${HOME}/.local/bin" USE_SUDO=false bash
        ok "k3d installed"
    fi

    mkdir -p "$tmp_dir"
    cp "${example_dir}/cluster.yaml" "${tmp_dir}/cluster.yaml"

    log "Applying ctlptl cluster config..."
    $ctlptl apply -f "${tmp_dir}/cluster.yaml"
    ok "k3d cluster + registry ready"

    # Switch to k3d context
    local k3d_context
    k3d_context=$($KUBECTL config get-contexts -o name 2>/dev/null | grep k3d | head -1 || echo "")
    if [ -n "$k3d_context" ]; then
        $KUBECTL config use-context "$k3d_context"
        ok "Switched to context: ${k3d_context}"
    fi

    $KUBECTL cluster-info >/dev/null 2>&1 || fail "Cannot reach Kubernetes cluster"
    ok "Cluster reachable"
}

cmd_status() {
    local ns="${1:-k6-pgbench}"

    echo -e "${GREEN}━━━ k6-pgbench Status ━━━${NC}\n"

    log "CNPG Operator:"
    $KUBECTL -n cnpg-system get pods -o wide 2>/dev/null || echo "  (namespace not found)"

    echo ""
    log "CNPG Cluster (${ns}):"
    $KUBECTL -n "$ns" get cluster 2>/dev/null || echo "  (none)"

    echo ""
    log "Pods (${ns}):"
    $KUBECTL -n "$ns" get pods -o wide 2>/dev/null || echo "  (namespace not found)"

    echo ""
    log "Services (${ns}):"
    $KUBECTL -n "$ns" get svc 2>/dev/null || echo "  (none)"

    echo ""
    log "Jobs (${ns}):"
    $KUBECTL -n "$ns" get jobs 2>/dev/null || echo "  (none)"
}

# ── Dispatch ────────────────────────────────────────────────────────

main() {
    local cmd="${1:-help}"
    shift || true

    case "$cmd" in
        ensure-cluster)  cmd_ensure_cluster ;;
        status)          cmd_status "$@" ;;
        help|--help|-h)
            echo "Usage: $(basename "$0") <command> [args...]"
            echo ""
            echo "Commands:"
            echo "  ensure-cluster    Create k3d cluster + registry"
            echo "  status [ns]       Show deployment status"
            ;;
        *)
            fail "Unknown command: ${cmd}" ;;
    esac
}

main "$@"
