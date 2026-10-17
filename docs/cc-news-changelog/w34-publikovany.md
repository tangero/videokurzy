---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Stručnější výstupy, návrhové plátno a ovládání z telefonu: novinky v Claude Code za 34. týden"
post_excerpt: "Ve 34. týdnu (17.–21. srpna 2026) přinesly verze 2.1.234 až 2.1.239 tři výraznější změny: nový styl výstupu Concise, příkaz /design pro práci s UI prototypy přímo v CLI a plnohodnotné vzdálené ovládání sezení z mobilního telefonu. Doplňuje je bohatá sada drobností zaměřených na komfort práce, správu oprávnění a mezisezení komunikaci."
summary_points:
- "Styl výstupu Concise (v2.1.237) zkracuje naraci a vede rovnou k výsledku, přičemž úplnost zachovává tam, kde záleží — u chyb, varování a destruktivních akcí."
- "Příkaz /design (research preview, od v2.1.234) přináší do CLI a Desktopu návrhové plátno s upravitelnými artboardy, z nichž lze rovnou vygenerovat implementaci."
- "Remote Control opustil research preview: stroj s běžícím claude remote-control se zobrazuje jako karta v záložce Code v mobilní aplikaci a lze z telefonu měnit i úroveň úsilí nebo režim oprávnění."
---

# Stručnější výstupy, návrhové plátno a ovládání z telefonu: novinky v Claude Code za 34. týden

Za 34. týden (17.–21. srpna 2026) prošel Claude Code verzemi 2.1.234 až 2.1.239. Jde o středně velké vydání se třemi výraznými liniemi: novým stylem výstupu Concise zaměřeným na úspornost, příkazem /design, který vtahuje workflow UI prototypování přímo do CLI, a přechodem Remote Control z výzkumného preview do plné dostupnosti včetně mobilní aplikace. Vedle toho přibyla řada drobností posilujících komfort — od kontroly pravopisu přes mezisezení komunikaci po přizpůsobení klávesových zkratek.

## Přehled velkých změn

- Nový styl výstupu Concise — kratší odpovědi bez ztráty přesnosti (v2.1.237)
- Příkaz /design s plátnem upravitelných artboardů (research preview, od v2.1.234)
- Remote Control z výzkumného preview do produkce; ovládání sezení z telefonu (mobile)

---

## Velké změny

### Styl výstupu Concise

Claude nově nabízí vestavěný styl výstupu s názvem Concise. Oproti výchozímu stylu vynechává preambuli a průběžnou naraci — rovnou prezentuje výsledek. Hloubka práce zůstává stejná jako v Default stylu; zkracuje se jen to, co není informačně nezbytné. Pokud uživatel výslovně požádá o vysvětlení nebo větší detail, Claude odpoví plně. Chybová hlášení, bezpečnostní varování a potvrzení destruktivních akcí si uchovávají úplný obsah bez ohledu na zvolený styl.

*Proč na tom záleží:* Uživatelé, kteří mají Claude Code zapojený do delšího pracovního toku nebo sledují výstup v terminálu periferním pohledem, ocení, že nemusí přeskakovat úvodní odstavce. Concise přitom nezkracuje tam, kde zkratka škodí — chyby a destruktivní akce zůstávají čitelné v plné délce. Jde o dobré rozlišení mezi „méně slov" a „méně informací". (v2.1.237) — [Dokumentace: vestavěné styly výstupu](https://code.claude.com/docs/en/output-styles#built-in-output-styles)

---

### Příkaz /design — návrhové plátno v CLI

Příkaz `/design` přináší do Claude Code CLI a aplikace Desktop workflow Claude Design postavený na artefaktech. Stačí zadat krátký brief a Claude publikuje plátno s upravitelnými artboardy pro vaše uživatelské rozhraní. Jeden artboard lze vybrat, upravit a nechat Clauda přímo implementovat. Funkce je dostupná na plánech Pro, Max, Team a Enterprise, vyžaduje verzi 2.1.234 nebo novější a je zatím označena jako research preview.

*Proč na tom záleží:* Dosud bylo návrhové plátno odděleno od vývojového procesu — nyní lze projít od skici přes výběr varianty k implementaci v jediném Claude Code sezení bez přepínání nástrojů. Pro vývojáře, kteří navrhují vlastní rozhraní bez dedikovaného designéra, to smysluplně zkracuje cestu od nápadu ke kódu. Research preview nicméně znamená, že chování se může měnit. (research preview, od v2.1.234) — [Dokumentace: dostupnost artefaktů](https://code.claude.com/docs/en/artifacts#availability)

---

### Vzdálené ovládání sezení z telefonu

Remote Control opouští výzkumné preview a vstupuje do plné dostupnosti. Každý stroj s běžícím příkazem `claude remote-control` se zobrazí jako karta zařízení v záložce Code v mobilní aplikaci Claude. Nové sezení tak lze spustit přímo z telefonu. Z mobilní aplikace nebo z claude.ai/code lze navíc měnit úroveň úsilí — změna se okamžitě projeví v sezení na počítači. Sezení hostovaná aplikací Desktop nebo rozšířením VS Code navíc zobrazují připojeným zařízením aktuální režim oprávnění.

*Proč na tom záleží:* Přechod z preview do produkce signalizuje, že Anthropic považuje funkci za stabilní. Schopnost měnit úroveň úsilí a sledovat režim oprávnění z telefonu dává uživatelům přehled o běžících sezení bez nutnosti sednout k počítači — užitečné zejména u dlouhotrvajících úloh spuštěných na vzdáleném stroji. (mobile) — [Dokumentace: spuštění sezení Remote Control](https://code.claude.com/docs/en/remote-control#start-a-remote-control-session)

---

## Drobnosti

- Claude Code po resetování limitu využití na claude.ai automaticky pokračuje v sezení; lze vypnout v `/config` na řádku „Continue automatically at usage limit"
- Volitelné [nastavení kontroly pravopisu](https://code.claude.com/docs/en/interactive-mode#check-spelling-as-you-type) podtrhuje chybně napsaná slova přímo v poli promptu za použití nainstalovaného aspell, hunspell nebo ispell
- Na větvi s otevřeným merge requestem na GitLabu zobrazuje zápatí [odznak MR !N](https://code.claude.com/docs/en/interactive-mode#gitlab-merge-requests) s barvou odpovídající stavu (draft, open, mergeable); vyžaduje autentizovaný `glab` CLI
- Změna úrovně úsilí z telefonu nebo claude.ai/code se [projeví v sezení na počítači](https://code.claude.com/docs/en/remote-control#what-connected-devices-see); sezení hostovaná Desktopem nebo VS Code zobrazují připojeným zařízením aktuální režim oprávnění
- [Oprávnění `/permissions`](https://code.claude.com/docs/en/permissions#manage-permissions) lze otevřít a `/add-dir` spustit i v průběhu práce Clauda; změny pravidel se uplatní pro zbytek aktuálního tahu
- Při čekání na úlohy na pozadí [`/goal`](https://code.claude.com/docs/en/goal#background-work-defers-evaluation) Claude zkontroluje jejich stav po 30 minutách místo čekání na neurčito; při nečinnosti sezení se intervaly prodlužují; `CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0` přihlašování vypne
- Vlastní prompty se v přepisu nyní vykreslují jako markdown — zvýrazněné bloky kódu, inline kód i seznamy — stejně jako odpovědi Clauda
- Proměnná prostředí [`ANTHROPIC_DEFAULT_MODEL`](https://code.claude.com/docs/en/model-config#set-a-default-model-for-new-sessions) nastavuje výchozí model pro nová sezení; výběr přes `/model` ji přepisuje a přetrvává přes restarty
- Se vstupem `notify_when_idle` u `SendMessage` může Claude požádat jiné sezení Claude Code na tomtéž stroji, aby [zaslalo oznámení při příštím přechodu do nečinnosti](https://code.claude.com/docs/en/cross-session-messaging#get-a-notice-when-another-session-goes-idle)
- Nastavení [`keybindingFlavor`](https://code.claude.com/docs/en/interactive-mode#make-ctrl-w-delete-back-to-whitespace) na hodnotu `"readline"` zajistí, že Ctrl+W v promptu maže zpět po mezeru jako v Bashi, nikoli po interpunkci jako `/`
- Na nativním Windows mohou sezení Claude Code [navzájem komunikovat](https://code.claude.com/docs/en/cross-session-messaging#availability) přes `SendMessage` a vzájemně se nacházet přes `ListAgents`, stejně jako na macOS a Linuxu
- Vlastní hostované spouštěče (self-hosted runners) přijímají `--defer-shutdown-max-min`, který [udržuje připojená sezení aktivní](https://code.claude.com/docs/en/self-hosted-environments-deploy#defer-the-drain-past-the-first-signal) po zadaný počet minut po přijetí SIGTERM
- Vlastní hostované spouštěče přijímají `--proxy-authorization-command` nebo `--proxy-authorization-file` pro dodání čerstvé hlavičky `Proxy-Authorization` [výstupním proxy vyžadujícím autentizaci](https://code.claude.com/docs/en/self-hosted-environments-deploy#authenticate-to-an-egress-proxy)

---

## Závěr

34. týden přinesl změny, které jsou zajímavé každý pro jiný typ uživatele. Styl Concise ocení ti, kdo Claude Code zapojují do hustých pracovních toků a nepotřebují průvodní komentář — zkrátka chtějí výsledek. Příkaz /design míří na vývojáře pracující samostatně na produktech s vlastním rozhraním: spojuje skicování a implementaci do jediného sezení. Nejširší dosah má pravděpodobně přechod Remote Control do produkce — možnost spustit, sledovat a řídit sezení z telefonu mění to, jak lze s Claude Code pracovat při pohybu nebo na vzdálených strojích. Drobnosti pak doplácejí detaily, které každodenní používání cizelují: od kontroly pravopisu a markdown v promptech po ladění chování `/goal` a nové možnosti pro správce vlastní infrastruktury.
