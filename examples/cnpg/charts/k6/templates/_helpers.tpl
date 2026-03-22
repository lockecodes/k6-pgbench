{{- define "k6.clusterName" -}}
{{- .Values.cluster.name }}
{{- end }}

{{- define "k6.labels" -}}
app.kubernetes.io/name: k6-benchmark
app.kubernetes.io/instance: {{ include "k6.clusterName" . }}
app.kubernetes.io/managed-by: Helm
{{- end }}

{{/* Primary (rw) service name — CNPG convention */}}
{{- define "k6.primaryHost" -}}
{{- include "k6.clusterName" . }}-rw
{{- end }}

{{/* Readonly (ro) service name — CNPG convention */}}
{{- define "k6.readonlyHost" -}}
{{- include "k6.clusterName" . }}-ro
{{- end }}

{{/* Secret name for app credentials — CNPG convention */}}
{{- define "k6.secretName" -}}
{{- include "k6.clusterName" . }}-app
{{- end }}

{{/* Script path based on benchmark type */}}
{{- define "k6.initScript" -}}
{{- if hasPrefix "tpcc" .Values.benchmark.type -}}
/scripts/tpcc/init.js
{{- else -}}
/scripts/pgbench/init.js
{{- end -}}
{{- end }}

{{- define "k6.benchmarkScript" -}}
{{- $type := .Values.benchmark.type -}}
{{- if eq $type "tpcb" -}}
/scripts/pgbench/tpcb.js
{{- else if eq $type "tpcb-select-only" -}}
/scripts/pgbench/select-only.js
{{- else if eq $type "tpcb-simple-update" -}}
/scripts/pgbench/simple-update.js
{{- else if eq $type "tpcb-readonly" -}}
/scripts/pgbench/tpcb-readonly.js
{{- else if eq $type "tpcb-scale-test" -}}
/scripts/pgbench/tpcb-scale-test.js
{{- else if eq $type "tpcc" -}}
/scripts/tpcc/tpcc.js
{{- else if eq $type "tpcc-readonly" -}}
/scripts/tpcc/tpcc-readonly.js
{{- else -}}
/scripts/pgbench/tpcb.js
{{- end -}}
{{- end }}
