#!/usr/bin/env bash
# Ad-hoc report o aktivačních e-mailech (flow A–D) z Resendu.
# NEukládá nic — jen vypíše aktuální stav z 'resend emails list'.
#
# Použití:
#   RESEND_API_KEY=re_xxx bash scripts/resend/report.sh
#
# Pozn.: Resend 'emails list' nevrací template/automation ID, takže flow se
# odvozuje z PŘEDMĚTU e-mailu. Když změníš subject šablony, uprav i FLOWS níže.
# Vrací jen poslední stránku; pro hlubší historii by bylo potřeba stránkovat.
set -euo pipefail
: "${RESEND_API_KEY:?Nastav RESEND_API_KEY}"

resend emails list --json | python3 "$(dirname "$0")/report.py"
