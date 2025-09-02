# Net Switch

![Net Switch](./banner.webp)

Net Switch isolates apps from accessing the Internet on your Android device using iptables rules. Lightweight, stand-alone, and designed to give you granular control over app connectivity without using a VPN.

---

## Highlights (What's New)

* **Profiles**: Save/restore sets of isolated apps via a profile system (new)
* **Backup Manager**: Allows you to save and restore created profiles (new)
* **Revamped WebUI**: Responsive interface with improved animations and feedback (Vite + Tailwind)

---

## Supported Root Managers


- [APatch](https://github.com/bmax121/APatch) 
- [KernelSU](https://github.com/tiann/KernelSU)
- [Magisk](https://github.com/topjohnwu/Magisk)  <sup>([no WebUI](https://github.com/topjohnwu/Magisk/issues/8609#event-15568590949)👀)</sup>

---

## Key Files Modified in This Branch

* `webui/src/index.html` — new UI with app list templates and components (toasts, spinner, switches)
* `webui/src/scripts/index.js` — logic for managing profiles, applying iptables rules, search and config saving
* `webui/src/styles/index.css` — modern styling, animations, and UX improvements (scrollbar, buttons, switches)
* `update.json`, `version`, `module/module.prop`, `changelog.md` — metadata updated for v1.3

These changes introduce profile support, backup manager and a more modern, responsive UI.

---

## How to Use (WebUI)

1. Flash the Net Switch module and reboot your device.
2. Open the WebUI (e.g., via KsuWebUI or MMRL if using Magisk).
3. Use the search bar to find apps.
4. Create a profile to save the current isolation state. You can select and apply profiles later.
5. Toggle each app to isolate it (an iptables rule is applied for the app’s UID).

___

## Terminal Usage (Commands Provided by the Module)

Open a terminal with root permissions (adb shell or Termux with root) and use:

```bash
netswitch block <package>      # isolate (block) the package
netswitch unblock <package>    # remove isolation from the package
netswitch list                 # list currently isolated packages
netswitch unblock all          # remove isolation from all packages
```

![Net-switch Terminal Example](./terminal.webp)

---

## Changelog Summary (Recent Changes)

* **v1.3** — Profiles system, WebUI overhaul, UX improvements, automatic cleanup of uninstalled apps

---

## Contribute

* Report bugs and request features at: [https://github.com/Rem01Gaming/net-switch/issues](https://github.com/Rem01Gaming/net-switch/issues)
* PRs welcome: [https://github.com/Rem01Gaming/net-switch/pulls](https://github.com/Rem01Gaming/net-switch/pulls)
* UX/UI: [Antonio Riccio](https://github.com/Antonio-Riccio)

---

## Useful Links

* Releases: [https://github.com/Rem01Gaming/net-switch/releases](https://github.com/Rem01Gaming/net-switch/releases)
* Telegram: [https://t.me/rem01schannel](https://t.me/rem01schannel)

---