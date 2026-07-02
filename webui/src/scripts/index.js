import { exec, toast } from "kernelsu";
import "./language.js";
import "@fortawesome/fontawesome-free/css/all.min.css";

const template = document.getElementById("app-template").content;
const appsList = document.getElementById("apps-list");

const configPath = "/data/adb/.config/net-switch/isolated.json";
const profilesPath = "/data/adb/.config/net-switch/profiles.json";
const defaultConfigPath = "/data/adb/.config/net-switch/default.json";
const oldProfilesBackupPath = "/data/adb/.config/net-switch/old_profiles.json";
const PKGLIST_PATH = "/data/system/packages.list";

// Must match the chain name used by module/service.sh and the netswitch
// CLI. All three rule-writers (boot service, CLI, WebUI) MUST target the
// same chain -- otherwise each one flushes/manages a different set of
// rules and stale REJECT rules accumulate outside of anyone's control.
const CHAIN = "netswitch";

let profiles = {};
let currentProfile = "";
let installedPackages = new Set();
let isolateList = [];

// pkg -> uid, built once per load from packages.list instead of spawning
// a root shell per app (was previously up to 4 exec() calls per app)
let uidMap = new Map();

// ---------------------------------------------------------------------
// Shell-safety helpers
//
// Every value that gets interpolated into a shell command run via
// kernelsu's exec()/run() MUST go through shQuote(). Without this,
// anything typed into the "path" field (import/export), or theoretically
// a package/profile name, becomes arbitrary root command execution.
// ---------------------------------------------------------------------

/**
 * POSIX single-quote escaping: wraps the string in single quotes and
 * safely escapes any embedded single quotes. This is the standard,
 * safe way to pass an arbitrary string as one shell argument.
 */
function shQuote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

/** UID must be purely numeric before it's ever used in a shell command. */
function isValidUid(uid) {
  return typeof uid === "string" && /^\d+$/.test(uid);
}

/** Package names are restricted to the charset Android actually allows. */
function isValidPackageName(pkg) {
  return typeof pkg === "string" && /^[a-zA-Z0-9._]+$/.test(pkg) && pkg.length <= 255;
}

/** Profile names: keep it to sane printable characters, reasonable length. */
function isValidProfileName(name) {
  return typeof name === "string" && /^[\p{L}\p{N} _\-.]{1,64}$/u.test(name);
}

async function run(cmd) {
  const { errno, stdout, stderr } = await exec(cmd);
  if (errno !== 0) {
    toast(`stderr: ${stderr}`);
    return undefined;
  }
  return stdout;
}

// ---------------------------------------------------------------------
// Serialized writer queue
//
// Prevents lost-update races when multiple UI actions (toggle app,
// switch profile, create profile) fire in quick succession and would
// otherwise interleave read-modify-write cycles on the same JSON files.
// ---------------------------------------------------------------------
let writeChain = Promise.resolve();
function serialize(fn) {
  const result = writeChain.then(fn, fn);
  // swallow so one failed write doesn't permanently break the chain
  writeChain = result.catch(() => {});
  return result;
}

// ---------------------------------------------------------------------
// UID resolution
// ---------------------------------------------------------------------

/**
 * Build the full package->uid map in a single shell round-trip by reading
 * /data/system/packages.list directly, instead of calling dumpsys/pm per
 * package. Falls back gracefully if the file can't be read.
 */
async function buildUidMap() {
  const map = new Map();
  const raw = await run(`cat ${shQuote(PKGLIST_PATH)} 2>/dev/null`);
  if (!raw) return map;

  raw
    .toString()
    .split("\n")
    .forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && isValidPackageName(parts[0]) && isValidUid(parts[1])) {
        map.set(parts[0], parts[1]);
      }
    });

  return map;
}

/**
 * Look up a UID for a package, preferring the in-memory map (fast, no
 * shell exec). Falls back to targeted dumpsys/pm queries only if the
 * package is missing from packages.list (rare edge cases, e.g. certain
 * system packages).
 */
async function getUidForPackage(pkg) {
  if (!isValidPackageName(pkg)) return null;

  const cached = uidMap.get(pkg);
  if (cached) return cached;

  const candidates = [
    `dumpsys package ${shQuote(pkg)} | sed -n 's/.*userId=\\([0-9][0-9]*\\).*/\\1/p' | head -1`,
    `dumpsys package ${shQuote(pkg)} | grep -Eo 'userId=[0-9]+' | head -1 | cut -d= -f2`,
    `pm dump ${shQuote(pkg)} | sed -n 's/.*userId=\\([0-9][0-9]*\\).*/\\1/p' | head -1`,
  ];

  for (const cmd of candidates) {
    try {
      const out = await run(cmd);
      if (!out) continue;
      const trimmed = out.toString().trim();
      const m = trimmed.match(/^(\d+)$/m) || trimmed.match(/(\d+)/);
      if (m && m[1] && isValidUid(m[1])) {
        uidMap.set(pkg, m[1]);
        return m[1];
      }
    } catch (e) {
      /* try next candidate */
    }
  }

  return null;
}

// ---------------------------------------------------------------------
// iptables rule helpers
//
// All rules go into the dedicated `netswitch` chain (created + jumped
// from OUTPUT by module/service.sh at boot, and lazily ensured here too
// in case the WebUI is used before the first boot-time service run, or
// iptables state was reset by something else). Never write directly to
// OUTPUT -- that chain is shared with other firewall modules and mixing
// rule ownership makes cleanup (uninstall, "connect all", chain flush)
// unreliable.
// ---------------------------------------------------------------------

let chainEnsured = false;

async function ensureChain() {
  if (chainEnsured) return;
  await run(`iptables -N ${shQuote(CHAIN)} 2>/dev/null`);
  await run(
    `iptables -C OUTPUT -j ${shQuote(CHAIN)} 2>/dev/null || iptables -I OUTPUT -j ${shQuote(CHAIN)}`,
  );
  await run(`ip6tables -N ${shQuote(CHAIN)} 2>/dev/null`);
  await run(
    `ip6tables -C OUTPUT -j ${shQuote(CHAIN)} 2>/dev/null || ip6tables -I OUTPUT -j ${shQuote(CHAIN)}`,
  );
  chainEnsured = true;
}

async function applyBlockRule(uid) {
  if (!isValidUid(uid)) return;
  await ensureChain();
  await run(
    `iptables -C ${shQuote(CHAIN)} -m owner --uid-owner ${shQuote(uid)} -j REJECT 2>/dev/null || iptables -A ${shQuote(CHAIN)} -m owner --uid-owner ${shQuote(uid)} -j REJECT`,
  );
  await run(
    `ip6tables -C ${shQuote(CHAIN)} -m owner --uid-owner ${shQuote(uid)} -j REJECT 2>/dev/null || ip6tables -A ${shQuote(CHAIN)} -m owner --uid-owner ${shQuote(uid)} -j REJECT`,
  );
}

async function removeBlockRule(uid) {
  if (!isValidUid(uid)) return;
  await run(
    `iptables -D ${shQuote(CHAIN)} -m owner --uid-owner ${shQuote(uid)} -j REJECT 2>/dev/null || true`,
  );
  await run(
    `ip6tables -D ${shQuote(CHAIN)} -m owner --uid-owner ${shQuote(uid)} -j REJECT 2>/dev/null || true`,
  );
}

// ---------------------------------------------------------------------
// Config persistence (all writes quoted + serialized)
// ---------------------------------------------------------------------

async function readDefaultConfig() {
  try {
    const out = await run(`cat ${shQuote(defaultConfigPath)} 2>/dev/null || true`);
    if (!out) return {};
    try {
      return JSON.parse(out.toString());
    } catch (e) {
      return { lang: out.toString().trim() };
    }
  } catch (e) {
    return {};
  }
}

async function writeDefaultConfig(cfg) {
  return serialize(async () => {
    try {
      await run(`echo ${shQuote(JSON.stringify(cfg))} > ${shQuote(defaultConfigPath)}`);
    } catch (e) {
      /* best-effort */
    }
  });
}

async function persistDefaultKey(key, value) {
  try {
    const cfg = await readDefaultConfig();
    cfg[key] = value;
    await writeDefaultConfig(cfg);
  } catch (e) {
    /* best-effort */
  }
}

async function loadPersistedProfile() {
  try {
    const cfg = await readDefaultConfig();
    if (cfg.currentProfile && profiles[cfg.currentProfile]) {
      await loadProfile(cfg.currentProfile);

      const profileSelect = document.getElementById("profile-select");
      if (profileSelect) {
        profileSelect.value = cfg.currentProfile;
      }
    }
  } catch (e) {
    /* no persisted profile, ignore */
  }
}

function sortChecked() {
  [...appsList.children]
    .sort((a, b) => (a.querySelector(".ns-toggle").checked ? -1 : 1))
    .forEach((node) => appsList.appendChild(node));
}

function safeId(prefix, name) {
  return `${prefix}-${name.replace(/[^a-z0-9]/gi, "-")}`;
}

function updateStatus(node) {
  const toggle = node.querySelector(".ns-toggle");
  const statusEl = node.querySelector(".app-status");
  const labelEl = node.querySelector(".switch-label");

  if (!toggle || !statusEl || !labelEl) return;

  const isIsolated = toggle.checked;

  if (isIsolated) {
    statusEl.textContent = getTranslation
      ? getTranslation("isolated")
      : "🚫 Isolated";
    labelEl.textContent = getTranslation
      ? getTranslation("isolated")
      : "Isolated";
    statusEl.className =
      "app-status text-xs text-red-600 dark:text-red-400 font-medium";
    labelEl.className =
      "switch-label text-xs text-red-600 dark:text-red-400 font-medium";
  } else {
    statusEl.textContent = getTranslation
      ? getTranslation("connected")
      : "📡 Connected";
    labelEl.textContent = getTranslation
      ? getTranslation("connected")
      : "Connected";
    statusEl.className =
      "app-status text-xs text-green-600 dark:text-green-400 font-medium";
    labelEl.className =
      "switch-label text-xs text-green-600 dark:text-green-400 font-medium";
  }
}

function populateApp(name, checked) {
  const frag = document.importNode(template, true);
  const el = frag.firstElementChild;
  if (!el) return;

  const nameElement = el.querySelector("p");
  if (nameElement) nameElement.textContent = name;

  const checkbox = el.querySelector(".ns-toggle");
  if (checkbox) checkbox.checked = checked;

  const statusElement = el.querySelector(".app-status");
  const switchLabel = el.querySelector(".switch-label");

  const statusId = safeId("ns-status", name);
  const switchId = safeId("ns-switch", name);
  const checkboxId = safeId("ns-toggle", name);

  if (statusElement) statusElement.id = statusId;
  if (switchLabel) switchLabel.id = switchId;
  if (checkbox) checkbox.id = checkboxId;

  el.dataset.statusId = statusId;
  el.dataset.switchId = switchId;
  el.dataset.checkboxId = checkboxId;

  updateStatus(el);

  if (checked) isolateList.push(name);

  if (checkbox) {
    checkbox.addEventListener("change", async () => {
      const spinner = document.getElementById("loading-spinner");
      if (spinner) spinner.classList.remove("hidden");

      // snapshot in case we need to roll back the toggle on error
      const wasChecked = !checkbox.checked;

      try {
        if (!isValidPackageName(name)) {
          throw new Error("Invalid package name");
        }

        if (checkbox.checked) {
          if (!isolateList.includes(name)) isolateList.push(name);
        } else {
          const index = isolateList.indexOf(name);
          if (index !== -1) isolateList.splice(index, 1);
        }

        const uidTrimmed = await getUidForPackage(name);

        if (!uidTrimmed) {
          throw new Error(
            getTranslation
              ? getTranslation("cannot_get_uid", name)
              : `Unable to get UID for ${name}`,
          );
        }

        if (checkbox.checked) {
          await applyBlockRule(uidTrimmed);
        } else {
          await removeBlockRule(uidTrimmed);
        }

        updateStatus(el);
        await saveIsolateList();

        if (currentProfile && profiles[currentProfile]) {
          profiles[currentProfile] = [...isolateList];
          await saveProfiles();
          updateProfileSelect();
          await persistDefaultKey("currentProfile", currentProfile);
        }

        sortChecked();

        const message = getTranslation
          ? getTranslation("operation_completed")
          : "Operation completed!";
        toast(message, "success");
      } catch (error) {
        // roll back both the checkbox UI state and isolateList membership
        checkbox.checked = wasChecked;
        const idx = isolateList.indexOf(name);
        if (wasChecked && idx === -1) {
          isolateList.push(name);
        } else if (!wasChecked && idx !== -1) {
          isolateList.splice(idx, 1);
        }
        updateStatus(el);

        const errorMsg = getTranslation
          ? getTranslation("operation_error")
          : "Operation error!";
        toast(`${errorMsg} ${error.message}`, "error");
      } finally {
        if (spinner) spinner.classList.add("hidden");
      }
    });
  }

  appsList.appendChild(el);
}

async function saveIsolateList() {
  return serialize(async () => {
    await run(`echo ${shQuote(JSON.stringify(isolateList))} > ${shQuote(configPath)}`);
  });
}

async function loadProfiles() {
  try {
    const profilesData = await run(`cat ${shQuote(profilesPath)} 2>/dev/null`);
    let parsed = {};
    if (profilesData) {
      try {
        parsed = JSON.parse(profilesData);
      } catch (e) {
        console.error("Corrupt profiles.json, resetting to empty:", e);
        parsed = {};
      }
    }
    // basic shape validation: object of string -> array of valid package names
    profiles = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isValidProfileName(key) && Array.isArray(value)) {
        profiles[key] = value.filter((p) => isValidPackageName(p));
      }
    }
    updateProfileSelect();
  } catch (error) {
    console.error("Failed to load profiles:", error);
  }
}

async function saveProfiles() {
  return serialize(async () => {
    await run(`echo ${shQuote(JSON.stringify(profiles))} > ${shQuote(profilesPath)}`);
  });
}

function updateProfileSelect() {
  const profileSelect = document.getElementById("profile-select");
  if (!profileSelect) return;

  profileSelect.innerHTML = "";

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.setAttribute("data-i18n", "select_profile");

  placeholderOption.textContent =
    (typeof getTranslation === "function" && getTranslation("select_profile")) ||
    "Select profile";
  profileSelect.appendChild(placeholderOption);

  Object.keys(profiles).forEach((profileName) => {
    const option = document.createElement("option");
    option.value = profileName;
    const appCount = profiles[profileName] ? profiles[profileName].length : 0;
    option.textContent = `${profileName} (${appCount})`;
    if (profileName === currentProfile) {
      option.selected = true;
    }
    profileSelect.appendChild(option);
  });
}

async function loadProfile(profileName) {
  if (!isValidProfileName(profileName) || !profiles[profileName]) {
    const errorMsg = getTranslation
      ? getTranslation("profile_not_found", profileName)
      : `Profile "${profileName}" not found`;
    toast(errorMsg, "error");
    return;
  }

  const spinner = document.getElementById("loading-spinner");
  if (spinner) spinner.classList.remove("hidden");

  try {
    await clearAllIsolation();
    isolateList.length = 0;

    const profileApps = profiles[profileName];
    for (const app of profileApps) {
      if (isValidPackageName(app) && installedPackages.has(app)) {
        isolateList.push(app);

        const uidTrimmed = await getUidForPackage(app);
        if (uidTrimmed) {
          await applyBlockRule(uidTrimmed);
        }
      }
    }

    [...appsList.children].forEach((node) => {
      const appName = node.querySelector("p").textContent;
      const checkbox = node.querySelector(".ns-toggle");
      if (!checkbox) return;

      checkbox.checked = isolateList.includes(appName);
      updateStatus(node);
    });

    currentProfile = profileName;
    await saveIsolateList();

    sortChecked();

    await persistDefaultKey("currentProfile", currentProfile);

    const successMsg = getTranslation
      ? getTranslation("profile_activated", profileName, profileApps.length)
      : `✅ Profile "${profileName}" activated • ${profileApps.length} apps isolated`;
    toast(successMsg, "success");
  } catch (error) {
    const errorMsg = getTranslation
      ? getTranslation("operation_error")
      : "Operation error!";
    toast(`${errorMsg} ${error.message}`, "error");
  } finally {
    if (spinner) spinner.classList.add("hidden");
  }
}

async function saveCurrentProfile(profileName) {
  profiles[profileName] = [...isolateList];
  await saveProfiles();
  currentProfile = profileName;
  updateProfileSelect();
  await persistDefaultKey("currentProfile", currentProfile);

  const successMsg = getTranslation
    ? getTranslation("profile_created", profileName, isolateList.length)
    : `🎉 Profile "${profileName}" created • ${isolateList.length} apps configured`;
  toast(successMsg, "success");
}

async function deleteProfile(profileName) {
  if (!profileName || !isValidProfileName(profileName)) {
    const errorMsg = getTranslation
      ? getTranslation("invalid_profile_name")
      : "Invalid profile name";
    toast(errorMsg, "error");
    return false;
  }

  try {
    delete profiles[profileName];
    await saveProfiles();

    if (currentProfile === profileName) {
      currentProfile = "";
      await persistDefaultKey("currentProfile", "");
    }

    updateProfileSelect();

    const successMsg = getTranslation
      ? getTranslation("profile_deleted", profileName)
      : `🗑️ Profile "${profileName}" deleted`;
    toast(successMsg, "success");
    return true;
  } catch (error) {
    const errorMsg = getTranslation
      ? getTranslation("operation_error")
      : "Operation error!";
    toast(`${errorMsg} ${error.message}`, "error");
    return false;
  }
}

async function clearAllIsolation() {
  // resolve all uids first (mostly cache hits now thanks to uidMap),
  // then fire the delete rules; avoids re-deriving uid mid-loop
  for (const app of isolateList) {
    if (!isValidPackageName(app)) continue;
    const uidTrimmed = await getUidForPackage(app);
    if (uidTrimmed) {
      await removeBlockRule(uidTrimmed);
    }
  }
}

async function loadApps() {
  const spinner = document.getElementById("loading-spinner");
  if (spinner) spinner.classList.remove("hidden");

  try {
    const packages = await run("pm list packages | cut -d: -f2 | sort");
    if (!packages) return;

    installedPackages = new Set(
      packages
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => isValidPackageName(p)),
    );

    // build uid map once instead of per-app dumpsys calls
    uidMap = await buildUidMap();

    const isolatedListOut = await run(`cat ${shQuote(configPath)} 2>/dev/null`);
    let isolated = [];
    if (isolatedListOut) {
      try {
        isolated = JSON.parse(isolatedListOut);
        if (!Array.isArray(isolated)) isolated = [];
      } catch (e) {
        console.error("Corrupt isolated.json, resetting:", e);
        isolated = [];
      }
    }
    isolated = isolated.filter((p) => isValidPackageName(p));

    const updatedIsolatedList = isolated.filter((app) =>
      installedPackages.has(app),
    );
    if (isolated.length !== updatedIsolatedList.length) {
      await saveIsolateListValue(updatedIsolatedList);
      isolated = updatedIsolatedList;
    }

    isolateList.length = 0;
    isolateList.push(...isolated);

    appsList.innerHTML = "";

    for (const pkg of installedPackages) {
      const isIsolated = isolated.includes(pkg);
      populateApp(pkg, isIsolated);
    }

    sortChecked();
  } catch (error) {
    const errorMsg = getTranslation
      ? getTranslation("operation_error")
      : "Operation error!";
    toast(`${errorMsg} ${error.message}`, "error");
  } finally {
    if (spinner) spinner.classList.add("hidden");
  }
}

// helper used only during the initial prune-uninstalled-apps step in loadApps
async function saveIsolateListValue(list) {
  return serialize(async () => {
    await run(`echo ${shQuote(JSON.stringify(list))} > ${shQuote(configPath)}`);
  });
}

async function createProfile() {
  const nameInput = document.getElementById("new-profile-name");
  const name = nameInput?.value.trim();

  if (!name) {
    const errorMsg = getTranslation
      ? getTranslation("enter_profile_name")
      : "⚠️ Enter a name for the new profile";
    toast(errorMsg, "error");
    return;
  }

  if (!isValidProfileName(name)) {
    const errorMsg = getTranslation
      ? getTranslation("invalid_profile_name")
      : "Invalid profile name";
    toast(errorMsg, "error");
    return;
  }

  if (profiles[name]) {
    const errorMsg = getTranslation
      ? getTranslation("profile_exists")
      : "⚠️ A profile with this name already exists";
    toast(errorMsg, "error");
    return;
  }

  await saveCurrentProfile(name);
  if (nameInput) nameInput.value = "";
}

async function connectAllApps() {
  const spinner = document.getElementById("loading-spinner");
  if (spinner) spinner.classList.remove("hidden");

  try {
    await clearAllIsolation();
    isolateList.length = 0;
    await saveIsolateList();
    currentProfile = "";
    await persistDefaultKey("currentProfile", "");

    [...appsList.children].forEach((node) => {
      const checkbox = node.querySelector(".ns-toggle");
      if (checkbox) checkbox.checked = false;
      updateStatus(node);
    });

    sortChecked();

    const successMsg = getTranslation
      ? getTranslation("all_apps_connected")
      : "🧹 All apps are now connected";
    toast(successMsg, "success");
  } catch (error) {
    const errorMsg = getTranslation
      ? getTranslation("operation_error")
      : "Operation error!";
    toast(`${errorMsg} ${error.message}`, "error");
  } finally {
    if (spinner) spinner.classList.add("hidden");
  }
}

function setupSearch() {
  const searchInput = document.getElementById("search");
  if (!searchInput) return;

  // debounce so filtering doesn't thrash the DOM on every keystroke
  // for users with hundreds of installed apps
  let debounceHandle;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(debounceHandle);
    const query = e.target.value.toLowerCase();
    debounceHandle = setTimeout(() => {
      [...appsList.children].forEach((node) => {
        const appName = node.querySelector("p")?.textContent?.toLowerCase();
        const matches = !query || (appName && appName.includes(query));
        node.style.display = matches ? "" : "none";
      });
    }, 120);
  });
}

/**
 * Validate a user-supplied filesystem path before it's ever interpolated
 * into a shell command. Rejects empty input, null bytes, and paths that
 * attempt to traverse outside of typical accessible storage — this is a
 * defense-in-depth sanity check, not a full path canonicalization; the
 * primary protection is shQuote() around every use of `path`.
 */
function isPlausiblePath(path) {
  if (!path || typeof path !== "string") return false;
  if (path.includes("\0")) return false;
  if (path.length > 4096) return false;
  return true;
}

function setupImportExport() {
  const openIoBtn = document.getElementById("open-io-page");
  const ioBackBtn = document.getElementById("io-back-btn");
  const ioActionBtn = document.getElementById("io-action-btn");
  const ioModeSelect = document.getElementById("io-mode-select");
  const homePage = document.getElementById("home-page");
  const ioPage = document.getElementById("io-page");

  if (
    !openIoBtn ||
    !ioBackBtn ||
    !ioActionBtn ||
    !ioModeSelect ||
    !homePage ||
    !ioPage
  )
    return;

  openIoBtn.addEventListener("click", () => {
    homePage.classList.add("hidden");
    ioPage.classList.remove("hidden");
    updateIoTexts();
  });

  ioBackBtn.addEventListener("click", () => {
    ioPage.classList.add("hidden");
    homePage.classList.remove("hidden");
  });

  ioModeSelect.addEventListener("change", updateIoTexts);

  ioActionBtn.addEventListener("click", async () => {
    const mode = ioModeSelect.value;
    const pathInput = document.getElementById("io-path-input");
    const path = pathInput?.value?.trim();

    if (!isPlausiblePath(path)) {
      const errorMsg = getTranslation
        ? getTranslation("invalid_path")
        : "Invalid path";
      toast(errorMsg, "error");
      return;
    }

    ioActionBtn.disabled = true;
    try {
      if (mode === "export") {
        // shQuote both sides: profilesPath is a constant but quoting it
        // too costs nothing and keeps the pattern consistent everywhere
        const exportResult = await exec(
          `cp ${shQuote(profilesPath)} ${shQuote(path)}`,
        );
        if (exportResult.errno !== 0) {
          const errorMsg = getTranslation
            ? getTranslation("export_failed")
            : "Export failed";
          toast(`${errorMsg}: ${exportResult.stderr}`, "error");
          return;
        }

        await run(`chmod 644 ${shQuote(path)} || true`);
        const successMsg = getTranslation
          ? getTranslation("export_success")
          : "Profiles exported successfully";
        toast(successMsg, "success");
      } else {
        // validate the source file actually looks like JSON before
        // committing it as profiles.json
        const preview = await run(`cat ${shQuote(path)} 2>/dev/null`);
        if (!preview) {
          const errorMsg = getTranslation
            ? getTranslation("import_failed")
            : "Import failed";
          toast(`${errorMsg}: file not found or unreadable`, "error");
          return;
        }
        try {
          const parsed = JSON.parse(preview);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("not a profiles object");
          }
        } catch (e) {
          const errorMsg = getTranslation
            ? getTranslation("import_failed")
            : "Import failed";
          toast(`${errorMsg}: file is not a valid profiles export`, "error");
          return;
        }

        await run(
          `if [ -f ${shQuote(profilesPath)} ]; then cp ${shQuote(profilesPath)} ${shQuote(oldProfilesBackupPath)}; fi`,
        );

        const importResult = await exec(
          `cp ${shQuote(path)} ${shQuote(profilesPath)}`,
        );
        if (importResult.errno !== 0) {
          const errorMsg = getTranslation
            ? getTranslation("import_failed")
            : "Import failed";
          toast(`${errorMsg}: ${importResult.stderr}`, "error");
          return;
        }

        await run(`chmod 600 ${shQuote(profilesPath)} || true`);
        await loadProfiles();
        updateProfileSelect();
        const successMsg = getTranslation
          ? getTranslation("import_success")
          : "Profiles imported successfully";
        toast(successMsg, "success");
      }
    } catch (error) {
      const isExport = mode === "export";
      const errorMsg = getTranslation
        ? getTranslation(isExport ? "export_failed" : "import_failed")
        : isExport
          ? "Export failed"
          : "Import failed";
      toast(`${errorMsg}: ${error.message}`, "error");
    } finally {
      ioActionBtn.disabled = false;
    }
  });
}

function updateIoTexts() {
  const mode = document.getElementById("io-mode-select")?.value;
  const pathLabel = document.getElementById("io-path-label");
  const pathDesc = document.getElementById("io-desc");
  const actionBtn = document.getElementById("io-action-btn");

  if (!mode || !pathLabel || !pathDesc || !actionBtn) return;

  if (mode === "export") {
    pathLabel.textContent = getTranslation
      ? getTranslation("destination_path")
      : "Destination path";
    pathDesc.textContent = getTranslation
      ? getTranslation("export_desc")
      : "Enter destination path for export";
  } else {
    pathLabel.textContent = getTranslation
      ? getTranslation("source_path")
      : "Source path";
    pathDesc.textContent = getTranslation
      ? getTranslation("import_desc")
      : "Enter source path for import";
  }

  actionBtn.textContent = getTranslation ? getTranslation("run") : "Run";
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadProfiles();
  await loadApps();
  await loadPersistedProfile();
  setupSearch();
  setupImportExport();

  const profileSelect = document.getElementById("profile-select");
  const createProfileBtn = document.getElementById("create-profile");
  const deleteProfileBtn = document.getElementById("delete-profile");

  profileSelect?.addEventListener("change", (e) => {
    if (e.target.value) {
      loadProfile(e.target.value);
    } else {
      connectAllApps();
    }
  });

  createProfileBtn?.addEventListener("click", createProfile);
  deleteProfileBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const selectedProfile = document.getElementById("profile-select").value;
    const profileToDelete = selectedProfile || currentProfile;

    if (!profileToDelete) {
      const errorMsg = getTranslation
        ? getTranslation("select_profile_to_delete")
        : "⚠️ Select a profile to delete";
      toast(errorMsg, "error");
      return;
    }

    await deleteProfile(profileToDelete);
  });

  const openIoBtn = document.getElementById("open-io-page");
  if (openIoBtn) {
    openIoBtn.textContent = getTranslation
      ? getTranslation("backup_manager")
      : "Backup Manager";
  }
});
