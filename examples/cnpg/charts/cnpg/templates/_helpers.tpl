{{- define "cnpg.clusterName" -}}
{{- .Values.cluster.name }}
{{- end }}

{{- define "cnpg.labels" -}}
app.kubernetes.io/name: {{ include "cnpg.clusterName" . }}
app.kubernetes.io/managed-by: Helm
{{- end }}
