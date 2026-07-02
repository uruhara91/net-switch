#!/system/bin/sh
# Net Switch - boot-time isolation applier
# Hardened: exact UID match, idempotent rules, bounded boot-wait, dedicated chain

MODDIR="${0%/*}"
CONFIG="/data/adb/.config/net-switch/isolated.json"
PKGLIST="/data/system/packages.list"
CHAIN="netswitch"
MAX_WAIT=180   # seconds

log() { echo "net-switch: $1" >>/dev/kmsg; }

# --- bounded wait for boot completion ---------------------------------
i=0
until [ "$(getprop sys.boot_completed)" = "1" ] && [ -f "$PKGLIST" ]; do
	sleep 1
	i=$((i + 1))
	if [ "$i" -ge "$MAX_WAIT" ]; then
		log "timeout after ${MAX_WAIT}s waiting for boot_completed/packages.list, aborting"
		exit 1
	fi
done

# --- ensure iptables/ip6tables exist -----------------------------------
command -v iptables >/dev/null 2>&1 || { log "iptables not found, aborting"; exit 1; }
HAS_IP6=1
command -v ip6tables >/dev/null 2>&1 || HAS_IP6=0

# --- (re)create dedicated chain, idempotent ----------------------------
setup_chain() {
	_bin="$1"
	"$_bin" -N "$CHAIN" 2>/dev/null
	"$_bin" -F "$CHAIN" 2>/dev/null
	"$_bin" -C OUTPUT -j "$CHAIN" 2>/dev/null || "$_bin" -I OUTPUT -j "$CHAIN"
}
setup_chain iptables
[ "$HAS_IP6" = "1" ] && setup_chain ip6tables

# --- nothing to do if config missing/empty -----------------------------
[ -f "$CONFIG" ] || { log "no config found, nothing to isolate"; exit 0; }

packages="$(sed 's|[]\"[]||g; s|,| |g' "$CONFIG" 2>/dev/null)"
[ -z "$packages" ] && { log "isolation list empty"; exit 0; }

blocked=0
for apk in $packages; do
	uid="$(awk -v pkg="$apk" '$1 == pkg { print $2; exit }' "$PKGLIST")"
	if [ -n "$uid" ]; then
		iptables -A "$CHAIN" -m owner --uid-owner "$uid" -j REJECT
		[ "$HAS_IP6" = "1" ] && ip6tables -A "$CHAIN" -m owner --uid-owner "$uid" -j REJECT
		log "blocked $apk (uid: $uid)"
		blocked=$((blocked + 1))
	else
		log "uid not found for $apk, skipped (uninstalled?)"
	fi
done

log "applied isolation to $blocked package(s)"
