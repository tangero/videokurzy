#!/usr/bin/env bash
# Založí v Resendu eventy, e-mailové šablony a 3 VYPNUTÉ (disabled) automations
# pro aktivační sekvenci. Idempotentní jen částečně — opakované spuštění může
# vytvořit duplicitní šablony/automations, takže před re-runem ukliď v dashboardu.
#
# Použití:
#   RESEND_API_KEY=re_xxx bash scripts/resend/setup.sh
#
# Vyžaduje: resend CLI (npm i -g resend-cli) a python3.
set -euo pipefail

: "${RESEND_API_KEY:?Nastav RESEND_API_KEY (full-access klíč produkčního Resend účtu)}"
cd "$(dirname "$0")"

FROM="Videokurzy <andrea@vibecoding.cz>"

id_of() { python3 -c "import sys,json; print(json.load(sys.stdin)['id'])"; }

echo "▶ 1/3 Eventy"
resend events create --name "purchase.completed" \
  --schema '{"type":"string","paymentMethod":"string"}' --json || echo "  (purchase.completed už možná existuje)"
resend events create --name "account.created" --json || echo "  (account.created už možná existuje)"
resend events create --name "lesson.completed" \
  --schema '{"lessonId":"number","lessonTitle":"string","nextLessonSlug":"string","completedCount":"number","totalCount":"number"}' --json \
  || echo "  (lesson.completed už možná existuje)"

echo "▶ 2/3 Šablony (create + publish)"
TPL_A=$(resend templates create --name "Onboarding — dokonči přihlášení" \
  --subject "Máš zaplaceno — ještě se přihlas do kurzu" --from "$FROM" \
  --html-file templates/onboarding-login.html --json | id_of)
resend templates publish "$TPL_A" >/dev/null && echo "  A=$TPL_A"

TPL_B=$(resend templates create --name "Aktivace — pusť si první lekci" \
  --subject "Tvůj kurz čeká — začni první lekcí" --from "$FROM" \
  --html-file templates/aktivace-prvni-lekce.html --json | id_of)
resend templates publish "$TPL_B" >/dev/null && echo "  B=$TPL_B"

TPL_C=$(resend templates create --name "Re-engagement — zasekl ses?" \
  --subject "Zasekl ses? Pokračuj tam, kde jsi skončil" --from "$FROM" \
  --html-file templates/reengagement-zasekl.html \
  --var LESSON_TITLE:string --var NEXT_LESSON_SLUG:string --json | id_of)
resend templates publish "$TPL_C" >/dev/null && echo "  C=$TPL_C"

echo "▶ 3/3 Automations (disabled)"
sed "s/__TPL_A__/$TPL_A/" automations/a-onboarding-login.json | resend automations create --file - --status disabled --json
sed "s/__TPL_B__/$TPL_B/" automations/b-aktivace-prvni-lekce.json | resend automations create --file - --status disabled --json
sed "s/__TPL_C__/$TPL_C/" automations/c-reengagement-zasekl.json | resend automations create --file - --status disabled --json

echo "✓ Hotovo. V Resend dashboardu (Automations) si je zkontroluj a teprve pak zapni."
