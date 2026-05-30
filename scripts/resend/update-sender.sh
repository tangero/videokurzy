#!/usr/bin/env bash
# Přesměruje odesílatele (from) u tří EXISTUJÍCÍCH automation šablon a znovu je
# publikuje. Šablony hledá podle názvu, takže netvoří duplicity.
# (templates update vytvoří nový draft → nutný publish.)
#
# Použití:
#   RESEND_API_KEY=re_xxx bash scripts/resend/update-sender.sh
#
# Vyžaduje: resend CLI a python3.
set -euo pipefail
: "${RESEND_API_KEY:?Nastav RESEND_API_KEY (full-access klíč)}"
cd "$(dirname "$0")"

FROM="Videokurzy <andrea@vibecoding.cz>"

id_by_name() {
  resend templates list --json | python3 -c \
    "import sys,json; n=sys.argv[1]; d=json.load(sys.stdin); rows=d.get('data', d if isinstance(d,list) else []); print(next((t['id'] for t in rows if t.get('name')==n), ''))" "$1"
}

upd() { # id  name  subject  html-file  [extra args...]
  local id="$1" name="$2" subject="$3" html="$4"; shift 4
  resend templates update "$id" --name "$name" --subject "$subject" \
    --from "$FROM" --html-file "$html" "$@" >/dev/null
  resend templates publish "$id" >/dev/null
  echo "  ✓ $name → $FROM ($id)"
}

A=$(id_by_name "Onboarding — dokonči přihlášení")
B=$(id_by_name "Aktivace — pusť si první lekci")
C=$(id_by_name "Re-engagement — zasekl ses?")

[ -n "$A" ] && upd "$A" "Onboarding — dokonči přihlášení" \
  "Máš zaplaceno — ještě se přihlas do kurzu" templates/onboarding-login.html
[ -n "$B" ] && upd "$B" "Aktivace — pusť si první lekci" \
  "Tvůj kurz čeká — začni první lekcí" templates/aktivace-prvni-lekce.html
[ -n "$C" ] && upd "$C" "Re-engagement — zasekl ses?" \
  "Zasekl ses? Pokračuj tam, kde jsi skončil" templates/reengagement-zasekl.html \
  --var LESSON_TITLE:string --var NEXT_LESSON_SLUG:string

echo "✓ Hotovo. Odesílatel změněn a šablony publikovány."
