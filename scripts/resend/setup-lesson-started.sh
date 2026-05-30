#!/usr/bin/env bash
# Doplní do Resendu flow D (re-engagement na early-droppery):
#   event lesson.started + šablona "dokoukej lekci" + automace (disabled).
# Idempotentní: event 409 (už existuje) přeskočí; šablonu hledá podle názvu,
# takže opakované spuštění netvoří duplicity.
#
# Použití:
#   RESEND_API_KEY=re_xxx bash scripts/resend/setup-lesson-started.sh
#
# Vyžaduje: resend CLI a python3.
set -euo pipefail
: "${RESEND_API_KEY:?Nastav RESEND_API_KEY (full-access klíč)}"
cd "$(dirname "$0")"

FROM="Videokurzy <andrea@vibecoding.cz>"
TPL_NAME="Re-engagement — dokoukej lekci"

id_of() { python3 -c "import sys,json; print(json.load(sys.stdin)['id'])"; }
id_by_name() {
  resend templates list --json | python3 -c \
    "import sys,json; n=sys.argv[1]; d=json.load(sys.stdin); rows=d.get('data', d if isinstance(d,list) else []); print(next((t['id'] for t in rows if t.get('name')==n), ''))" "$1"
}

echo "▶ 1/3 Event lesson.started"
resend events create --name "lesson.started" --schema '{"lessonId":"number"}' --json \
  || echo "  (lesson.started už existuje)"

echo "▶ 2/3 Šablona (create nebo update existující) + publish"
TPL=$(id_by_name "$TPL_NAME")
if [ -z "$TPL" ]; then
  TPL=$(resend templates create --name "$TPL_NAME" \
    --subject "Dokoukej lekci, kterou jsi začal" --from "$FROM" \
    --html-file templates/reengagement-dokoukej.html --json | id_of)
  echo "  vytvořena $TPL"
else
  resend templates update "$TPL" --subject "Dokoukej lekci, kterou jsi začal" \
    --from "$FROM" --html-file templates/reengagement-dokoukej.html >/dev/null
  echo "  aktualizována $TPL"
fi
resend templates publish "$TPL" >/dev/null && echo "  publikována"

echo "▶ 3/3 Automace D (disabled)"
sed "s/__TPL_D__/$TPL/" automations/d-reengagement-dokoukej.json \
  | resend automations create --file - --status disabled --json

echo "✓ Hotovo. V Resend dashboardu (Automations) zkontroluj a teprve pak zapni."
