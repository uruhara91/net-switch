import { exec, toast } from "kernelsu";
import "./language.js";
import "@fortawesome/fontawesome-free/css/all.min.css";

const template = document.getElementById("app-template").content;
const appsList = document.getElementById("apps-list");

const configPath = "/data/adb/.config/net-switch/isolated.json";
const profilesPath = "/data/adb/.config/net-switch/profiles.json";
const defaultConfigPath = "/data/adb/.config/net-switch/default.json";

let profiles = {};
let currentProfile = "";
let installedPackages = new Set();
let isolateList = [];

async function run(cmd) {
  const { errno, stdout, stderr } = await exec(cmd);
  if (errno !== 0) {
    toast(`stderr: ${stderr}`);

    return undefined;
  }
  return stdout;
}

async function getUidForPackage(pkg) {
  if (!pkg) return null;

  const candidates = [
    `grep "^${pkg}" /data/system/packages.list | awk '{print $2; exit}'`,
    `dumpsys package '${pkg}' | sed -n 's/.*userId=\\([0-9][0-9]*\\).*/\\1/p' | head -1`,
    `dumpsys package '${pkg}' | grep -Eo 'userId=[0-9]+' | head -1 | cut -d= -f2`,
    `pm dump '${pkg}' | sed -n 's/.*userId=\\([0-9][0-9]*\\).*/\\1/p' | head -1`,
  ];

  for (const cmd of candidates) {
    try {
      const out = await run(cmd);
      if (!out) continue;
      const trimmed = out.toString().trim();
      const m = trimmed.match(/(\d+)/);
      if (m && m[1]) return m[1];
    } catch (e) { }
  }

  return null;
}

async function readDefaultConfig() {
  try {
    const out = await run(`cat ${defaultConfigPath} 2>/dev/null || true`);
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
  try {
    await run(`echo '${JSON.stringify(cfg)}' > ${defaultConfigPath}`);
  } catch (e) { }
}

async function persistDefaultKey(key, value) {
  try {
    const cfg = await readDefaultConfig();
    cfg[key] = value;
    await writeDefaultConfig(cfg);
  } catch (e) { }
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
  } catch (e) { }
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

  // Update app status indicator
  const statusElement = el.querySelector(".app-status");
  const switchLabel = el.querySelector(".switch-label");

  // assign deterministic IDs
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

      try {
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
          await run(
            `iptables -C OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT 2>/dev/null || iptables -I OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT`,
          );
          await run(
            `ip6tables -C OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT 2>/dev/null || ip6tables -I OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT`,
          );
        } else {
          await run(
            `iptables -D OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT 2>/dev/null || true`,
          );
          await run(
            `ip6tables -D OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT 2>/dev/null || true`,
          );
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
        checkbox.checked = !checkbox.checked;
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
  await run(`echo '${JSON.stringify(isolateList)}' > ${configPath}`);
}

async function loadProfiles() {
  try {
    const profilesData = await run(`cat ${profilesPath}`);
    profiles = profilesData ? JSON.parse(profilesData) : {};
    updateProfileSelect();
  } catch (error) {
    console.error("Failed to load profiles:", error);
  }
}

async function saveProfiles() {
  await run(`echo '${JSON.stringify(profiles)}' > ${profilesPath}`);
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
  if (!profiles[profileName]) {
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
      if (installedPackages.has(app)) {
        isolateList.push(app);

        const uidTrimmed = await getUidForPackage(app);
        if (uidTrimmed) {
          await run(
            `iptables -C OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT 2>/dev/null || iptables -I OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT`,
          );
          await run(
            `ip6tables -C OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT 2>/dev/null || ip6tables -I OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT`,
          );
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
  if (!profileName) {
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
  for (const app of isolateList) {
    const uidTrimmed = await getUidForPackage(app);
    if (uidTrimmed) {
      await run(
        `iptables -D OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT 2>/dev/null || true`,
      );
      await run(
        `ip6tables -D OUTPUT -m owner --uid-owner ${uidTrimmed} -j REJECT 2>/dev/null || true`,
      );
    }
  }
}

async function loadApps() {
  const spinner = document.getElementById("loading-spinner");
  if (spinner) spinner.classList.remove("hidden");

  try {
    const packages = await run("pm list packages | cut -d: -f2 | sort");
    if (!packages) return;

    installedPackages = new Set(packages.split("\n").filter(Boolean));

    const isolatedListOut = await run(`cat ${configPath}`);
    let isolated = isolatedListOut ? JSON.parse(isolatedListOut) : [];

    const updatedIsolatedList = isolated.filter((app) =>
      installedPackages.has(app),
    );
    if (isolated.length !== updatedIsolatedList.length) {
      await run(
        `echo '${JSON.stringify(updatedIsolatedList)}' > ${configPath}`,
      );
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

  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    [...appsList.children].forEach((node) => {
      const appName = node.querySelector("p")?.textContent?.toLowerCase();
      const matches = !query || (appName && appName.includes(query));
      node.style.display = matches ? "" : "none";
    });
  });
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

    if (!path) {
      const errorMsg = getTranslation
        ? getTranslation("invalid_path")
        : "Invalid path";
      toast(errorMsg, "error");
      return;
    }

    try {
      if (mode === "export") {
        const exportResult = await exec(`cp ${profilesPath} '${path}'`);
        if (exportResult.errno !== 0) {
          const errorMsg = getTranslation
            ? getTranslation("export_failed")
            : "Export failed";
          toast(`${errorMsg}: ${exportResult.stderr}`, "error");
          return;
        }
        
        await run(`chmod 644 '${path}' || true`);
        const successMsg = getTranslation
          ? getTranslation("export_success")
          : "Profiles exported successfully";
        toast(successMsg, "success");
      } else {
        await run(
          `if [ -f ${profilesPath} ]; then cp ${profilesPath} /data/adb/.config/net-switch/old_profiles.json; fi`,
        );
        
        const importResult = await exec(`cp '${path}' ${profilesPath}`);
        if (importResult.errno !== 0) {
          const errorMsg = getTranslation
            ? getTranslation("import_failed")
            : "Import failed";
          toast(`${errorMsg}: ${importResult.stderr}`, "error");
          return;
        }
        
        await run(`chmod 644 ${profilesPath} || true`);
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