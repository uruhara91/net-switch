# Net Switch
![Net Switch](./banner.webp)

Net Switch isola le app dall'accesso a Internet sul tuo dispositivo Android usando regole iptables. Leggero, stand-alone e progettato per offrire controllo granulare sulle app senza usare VPN.

---

## Highlights (novità)
- Profiles: sistema di profili per salvare/riattivare insiemi di app isolate (nuovo)
- WebUI rinnovata: interfaccia responsive, animazioni e feedback migliorati (Vite + Tailwind)
- Miglior gestione: rimozione automatica delle app disinstallate dall'elenco di isolate
- Feedback in tempo reale: toasts, spinner di caricamento e badge di stato

---

## Panoramica rapida
- Tipo: Magisk module / KernelSU compatible WebUI
- Versione attuale: v1.3 (vedi `version` e `update.json`)
- Architettura: interfaccia WebUI servita dal modulo + comandi di sistema (iptables, ip6tables, pm)

## File modificati rilevanti in questa branch
- `webui/src/index.html` — nuova UI con template per la lista app e componenti (toasts, spinner, switch)
- `webui/src/scripts/index.js` — logica di gestione profili, applicazione regole iptables, ricerca e salvataggio config
- `webui/src/styles/index.css` — stile moderno, animazioni e miglioramenti UX (scrollbar, pulsanti, switch)
- `update.json`, `version`, `module/module.prop`, `changelog.md` — aggiornamento metadati a v1.3

Queste modifiche introducono il supporto ai profili e una UI più moderna e reattiva.

---

## Come usare (WebUI)
1. Flasha il modulo Net Switch e riavvia il dispositivo.
2. Apri la WebUI (es. tramite KsuWebUI o MMRL se usi Magisk).
3. Usa la barra di ricerca per trovare le app.
4. Usa l'interruttore di ogni app per isolare (viene applicata una regola iptables per l'UID dell'app).
5. Crea un profilo per salvare lo stato attuale delle app isolate. Puoi selezionare e applicare profili in seguito.

### Note rapide
- Le modifiche vengono applicate immediatamente.
- Se un'app viene disinstallata, viene rimossa automaticamente dall'elenco di isolate al prossimo avvio della UI.

---

## Uso da terminale (comandi forniti dal modulo)
Apri un terminale con permessi root (adb shell o Termux con root) e usa:

```bash
netswitch block <package>      # isola (blocca) il package
netswitch unblock <package>    # rimuove l'isolamento su package
netswitch list                 # mostra package attualmente isolati
netswitch unblock all          # rimuove l'isolamento da tutti
```

---

## Changelog sintetico (ultime modifiche)
- v1.3 — Profiles system, WebUI overhaul, UX improvements, automatic cleanup of uninstalled apps
- v1.2 — Fix UID fetch, remove uninstalled apps from isolated.json, migrate WebUI to Vite

Per il changelog completo vedere `changelog.md`.

---

## Contribuire
- Segnala bug e feature su: https://github.com/Rem01Gaming/net-switch/issues
- PRs benvenute: https://github.com/Rem01Gaming/net-switch/pulls

---

## Link utili
- Release: https://github.com/Rem01Gaming/net-switch/releases
- Telegram: https://t.me/rem01schannel

---

_File aggiornato automaticamente per riflettere le nuove implementazioni della branch `FE/UpdateUX_UI`._
