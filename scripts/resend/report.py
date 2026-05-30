"""Vypíše report o aktivačních e-mailech (flow A–D) z 'resend emails list' (stdin).
Volá se z report.sh. Flow se odvozuje z předmětu — emails list nevrací template ID."""
import sys
import json
from collections import Counter

FLOWS = {
    "Máš zaplaceno — ještě se přihlas do kurzu": "A — onboarding (přihlas se)",
    "Tvůj kurz čeká — začni první lekcí": "B — aktivace (první lekce)",
    "Zasekl ses? Pokračuj tam, kde jsi skončil": "C — zasekl ses",
    "Dokoukej lekci, kterou jsi začal": "D — dokoukej (early-drop)",
}

data = json.load(sys.stdin)
rows = data.get("data", [])
ours = [r for r in rows if r.get("subject") in FLOWS]

print("Vzorek: {} e-mailů (has_more={})".format(len(rows), data.get("has_more")))
print("Naše automatizace A–D ve vzorku: {}".format(len(ours)))
print()

if not ours:
    print("(Žádný e-mail z flow A–D zatím neodešel — automatizace čekají na timeouty 3–7 dní.)")
    sys.exit(0)

by = {}
for r in ours:
    flow = FLOWS[r["subject"]]
    by.setdefault(flow, Counter())[r.get("last_event", "?")] += 1

print("=== Souhrn za flow (počet podle posledního stavu) ===")
for flow in sorted(by):
    stats = ", ".join("{}: {}".format(ev, n) for ev, n in by[flow].most_common())
    print("  {}: {}".format(flow, stats))

print()
print("=== Per-příjemce ===")
for r in ours:
    to = r["to"][0] if r.get("to") else "?"
    print("  {:28} {:32} {}  {}".format(
        FLOWS[r["subject"]], to, r.get("last_event", "?"), (r.get("created_at") or "")[:16]
    ))
