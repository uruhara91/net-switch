CONFIG_DIR="/data/adb/.config/net-switch"
ISOLATED="$CONFIG_DIR/isolated.json"

# ensure config dir exists with sane permissions before anything writes to it
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR" 2>/dev/null

if [ ! -f "$ISOLATED" ]; then
	echo "[]" >"$ISOLATED"
fi
chmod 600 "$ISOLATED" 2>/dev/null

if [ "$KSU" = "true" ] || [ "$APATCH" = "true" ]; then
	# remove action on APatch / KernelSU
	rm -f "$MODPATH/action.sh"
	# skip mount on APatch / KernelSU
	touch "$MODPATH/skip_mount"
	# symlink ourselves on $PATH
	manager_paths="/data/adb/ap/bin /data/adb/ksu/bin"
	for dir in $manager_paths; do
		if [ -d "$dir" ]; then
			ui_print "- creating symlink in $dir"
			ln -sf /data/adb/modules/net-switch/system/bin/netswitch "$dir/netswitch"
		fi
	done
fi

set_perm_recursive "$MODPATH/system" 0 0 0755 0755
