#!/system/bin/sh
# Net Switch uninstaller
# Hardened: fixes wrong config path (was /data/adb/net-switch, config actually
# lives at /data/adb/.config/net-switch), and flushes the dedicated iptables
# chain so isolated apps regain internet access immediately instead of
# waiting for a reboot.

CHAIN="netswitch"

HAS_IP6=1
command -v ip6tables >/dev/null 2>&1 || HAS_IP6=0

# --- remove our chain from OUTPUT and delete it -------------------------
cleanup_chain() {
	_bin="$1"
	# remove the jump rule from OUTPUT (loop in case it was ever inserted
	# more than once by a buggy prior version)
	while "$_bin" -C OUTPUT -j "$CHAIN" 2>/dev/null; do
		"$_bin" -D OUTPUT -j "$CHAIN" 2>/dev/null
	done
	"$_bin" -F "$CHAIN" 2>/dev/null
	"$_bin" -X "$CHAIN" 2>/dev/null
}
cleanup_chain iptables
[ "$HAS_IP6" = "1" ] && cleanup_chain ip6tables

# --- fallback cleanup for rules from older versions that inserted -------
# --- REJECT rules directly onto OUTPUT (pre-chain releases) -------------
OLD_CONFIG="/data/adb/.config/net-switch/isolated.json"
if [ -f "$OLD_CONFIG" ]; then
	packages="$(sed 's|[]\"[]||g; s|,| |g' "$OLD_CONFIG" 2>/dev/null)"
	for apk in $packages; do
		uid="$(awk -v pkg="$apk" '$1 == pkg { print $2; exit }' /data/system/packages.list 2>/dev/null)"
		if [ -n "$uid" ]; then
			iptables -D OUTPUT -m owner --uid-owner "$uid" -j REJECT 2>/dev/null
			[ "$HAS_IP6" = "1" ] && ip6tables -D OUTPUT -m owner --uid-owner "$uid" -j REJECT 2>/dev/null
		fi
	done
fi

# --- remove configs (fix: correct path) ---------------------------------
rm -rf /data/adb/.config/net-switch
# also clean up the old/incorrect path in case it was ever created
rm -rf /data/adb/net-switch

# --- clean our symlinks (fix: -f so missing symlink isn't a noisy error)
rm -f /data/adb/ap/bin/netswitch
rm -f /data/adb/ksu/bin/netswitch
