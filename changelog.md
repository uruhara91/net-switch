## 1.3.1

- **SECURITY**: Fixed shell command injection in WebUI (`index.js`) — unescaped import/export path and shell arguments could allow arbitrary root command execution. All shell interpolation now passed through `shQuote()`.
- **FIX**: Fixed incorrect config path in `uninstall.sh` (`/data/adb/net-switch` → `/data/adb/.config/net-switch`) — config directory was never actually removed on uninstall.
- **FIX**: `uninstall.sh` now flushes iptables rules on uninstall — isolated apps regain internet access immediately instead of only after reboot.
- **FIX**: UID lookup (`service.sh`, `netswitch` CLI) now matches package names exactly instead of by prefix — prevents accidentally blocking a package whose name is a prefix of another (e.g. `com.foo` matching `com.foo.bar`).
- **FIX**: WebUI, boot service, and CLI now all write iptables rules to the same dedicated `netswitch` chain instead of mixed direct-`OUTPUT` writes — prevents stale/orphaned REJECT rules from accumulating outside of any single source of truth.
- **IMPROVED**: All iptables rule writes are now idempotent (check-before-add/delete) across `service.sh`, `netswitch` CLI, and WebUI.
- **IMPROVED**: Boot service now has a bounded wait (180s) for `sys.boot_completed`/`packages.list` instead of waiting indefinitely.
- **IMPROVED**: WebUI UID resolution now reads `/data/system/packages.list` once into memory instead of spawning a root shell (`dumpsys`/`pm dump`) per app — significantly faster app list load on devices with many installed apps.
- **IMPROVED**: WebUI config writes (`isolated.json`, `profiles.json`, `default.json`) are now serialized to prevent lost-update races from rapid UI interactions.
- **IMPROVED**: `netswitch` CLI JSON writes are now atomic (write-to-temp + `mv`) to avoid corrupting `isolated.json` if interrupted mid-write.
- **IMPROVED**: Added input validation for package names, profile names, and import/export paths across WebUI and CLI.
- **IMPROVED**: WebUI now rolls back checkbox/isolation-list state if applying an iptables rule fails, instead of leaving UI and actual state out of sync.
- **IMPROVED**: WebUI import now validates the source file is a well-formed profiles object before overwriting `profiles.json`.
- **IMPROVED**: Search input is now debounced to avoid DOM thrashing on devices with large app lists.
- **IMPROVED**: Config directory permissions tightened (700/600) in `customize.sh`.

## 1.3

- **NEW**: Added Profiles System for app isolation management
- **IMPROVED**: Enhanced UI with profile management controls
- **IMPROVED**: Better user feedback with status indicators
- **NEW**: Added profile backup system

## 1.2

- Fix wrong UID fetch
- Automatically remove uninstalled apps from isolated.json
- Refactor and Migrate WebUI to Vite

---
**SHA256**: `4d79e6d6b27c3e5f7f7b319d65f0cfd14d395c57e750b02f9e3b405f0f9a91f8`
