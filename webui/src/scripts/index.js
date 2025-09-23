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

async function run(cmd) {
  const { errno, stdout, stderr } = await exec(cmd);
  if (errno !== 0) {
    toast(`stderr: ${stderr}`);
    return undefined;
  }
  return stdout;
}

// Default config read/write helpers (store json with { lang, currentProfile })
async function readDefaultConfig() {
  try {
    const out = await run(`cat ${defaultConfigPath} 2>/dev/null || true`);
    if (!out) return {};
    try {
      return JSON.parse(out.toString());
    } catch (e) {
      // legacy plain text: assume it's just the lang
      return { lang: out.toString().trim() };
    }
  } catch (e) {
    return {};
  }
}

async function writeDefaultConfig(cfg) {
  try {
    await run(`echo '${JSON.stringify(cfg)}' > ${defaultConfigPath}`);
  } catch (e) {
    // ignore write errors
  }
}

async function persistDefaultKey(key, value) {
  try {
    const cfg = await readDefaultConfig();
    cfg[key] = value;
    await writeDefaultConfig(cfg);
  } catch (e) {
    // ignore
  }
}

async function loadPersistedProfile() {
  try {
    const cfg = await readDefaultConfig();
    if (cfg.currentProfile) {
      currentProfile = cfg.currentProfile;
    }
  } catch (e) {}
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
      "app-status text-xs text-red-600 dark:text-red-400 switch-label font-medium";
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
      "app-status text-xs text-green-600 dark:text-green-400 switch-label font-medium";
    labelEl.className =
      "switch-label text-xs text-green-600 dark:text-green-400 switch-label font-medium";
  }
}

function populateApp(name, checked) {
  const clone = template.cloneNode(true);
  const toggle = clone.querySelector(".ns-toggle");
  const nameEl = clone.querySelector("p");
  const container = clone.querySelector("div");

  if (!toggle || !nameEl || !container) return;

  const checkboxId = safeId("app", name);
  toggle.id = checkboxId;
  toggle.checked = checked;
  nameEl.textContent = name;

  // Update the status based on current state
  updateStatus(container);

  // Handle toggle change
  toggle.addEventListener("change", async (e) => {
    e.target.disabled = true;
    sortChecked();

    try {
      const checked = e.target.checked;
      const config = JSON.parse((await run(`cat ${configPath}`)) || "{}");

      if (currentProfile) {
        if (!profiles[currentProfile]) profiles[currentProfile] = {};
        profiles[currentProfile][name] = checked;
      } else {
        config[name] = checked;
      }

      if (currentProfile) {
        await run(`echo '${JSON.stringify(profiles)}' > ${profilesPath}`);
      } else {
        await run(`echo '${JSON.stringify(config)}' > ${configPath}`);
      }

      const uid = await run(
        `pm list packages | grep -E "^package:${name}$" | head -1 | cut -d: -f2 | xargs -r dumpsys package | grep -E "^[ ]*userId=" | head -1 | cut -d= -f2`,
      );

      if (!uid || uid.trim() === "") {
        throw new Error(
          getTranslation
            ? getTranslation("cannot_get_uid", name)
            : `Unable to get UID for ${name}`,
        );
      }

      const uidTrimmed = uid.trim();
      const netdCmd = checked
        ? `netd firewallctl setUidRule 1 ${uidTrimmed} 2`
        : `netd firewallctl setUidRule 1 ${uidTrimmed} 0`;

      const result = await run(netdCmd);

      // Update status after successful operation
      updateStatus(container);

      const message = getTranslation
        ? getTranslation("operation_completed")
        : "Operation completed!";
      toast(message, "success");
    } catch (error) {
      e.target.checked = !e.target.checked;
      updateStatus(container);

      const errorMsg = getTranslation
        ? getTranslation("operation_error")
        : "Operation error!";
      toast(`${errorMsg} ${error.message}`, "error");
    } finally {
      e.target.disabled = false;
    }
  });

  appsList.appendChild(container);
}

// Helper: encode UTF-8 string to base64 without using deprecated `unescape`
function utf8ToBase64(str) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
      return String.fromCharCode(parseInt(p1, 16));
    }),
  );
}

async function loadApps() {
  const spinner = document.getElementById("loading-spinner");
  if (spinner) spinner.classList.remove("hidden");

  try {
    const packages = await run("pm list packages | cut -d: -f2 | sort");
    if (!packages) return;

    installedPackages = new Set(packages.split("\n").filter(Boolean));
    const config = JSON.parse((await run(`cat ${configPath}`)) || "{}");

    // Clear existing apps
    appsList.innerHTML = "";

    // Get current profile config if one is selected
    let profileConfig = {};
    if (currentProfile && profiles[currentProfile]) {
      profileConfig = profiles[currentProfile];
    }

    // Populate apps
    for (const pkg of installedPackages) {
      const isIsolated = currentProfile
        ? profileConfig[pkg] || false
        : config[pkg] || false;
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

async function loadProfiles() {
  try {
    const profilesData = await run(`cat ${profilesPath}`);
    profiles = profilesData ? JSON.parse(profilesData) : {};

    const profileSelect = document.getElementById("profile-select");
    if (!profileSelect) return;

    // Clear existing options except the placeholder
    const placeholder = profileSelect.querySelector('option[value=""]');
    profileSelect.innerHTML = "";
    if (placeholder) profileSelect.appendChild(placeholder);

    // Add profile options
    Object.keys(profiles).forEach((profileName) => {
      const option = document.createElement("option");
      option.value = profileName;
      option.textContent = profileName;
      profileSelect.appendChild(option);
    });

    // Select current profile if exists
    if (currentProfile && profiles[currentProfile]) {
      profileSelect.value = currentProfile;
    }
  } catch (error) {
    console.error("Failed to load profiles:", error);
  }
}

async function activateProfile(profileName) {
  if (!profiles[profileName]) {
    const errorMsg = getTranslation
      ? getTranslation("profile_not_found", profileName)
      : `Profile "${profileName}" not found`;
    toast(errorMsg, "error");
    return;
  }

  try {
    const profileConfig = profiles[profileName];
    const config = {};
    let isolatedCount = 0;

    // Apply profile configuration
    for (const [pkg, isolated] of Object.entries(profileConfig)) {
      if (installedPackages.has(pkg)) {
        config[pkg] = isolated;
        if (isolated) isolatedCount++;
      }
    }

    // Save configuration
    await run(`echo '${JSON.stringify(config)}' > ${configPath}`);

    // Set current profile
    currentProfile = profileName;
    await persistDefaultKey("currentProfile", currentProfile);

    // Reload apps to reflect new configuration
    await loadApps();

    const successMsg = getTranslation
      ? getTranslation("profile_activated", profileName, isolatedCount)
      : `✅ Profile "${profileName}" activated • ${isolatedCount} apps isolated`;
    toast(successMsg, "success");
  } catch (error) {
    const errorMsg = getTranslation
      ? getTranslation("operation_error")
      : "Operation error!";
    toast(`${errorMsg} ${error.message}`, "error");
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

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
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

  try {
    // Get current configuration
    const config = JSON.parse((await run(`cat ${configPath}`)) || "{}");

    // Create profile with current state
    profiles[name] = { ...config };

    // Save profiles
    await run(`echo '${JSON.stringify(profiles)}' > ${profilesPath}`);

    // Reload profiles dropdown
    await loadProfiles();

    // Clear input
    if (nameInput) nameInput.value = "";

    const appCount = Object.keys(config).length;
    const successMsg = getTranslation
      ? getTranslation("profile_created", name, appCount)
      : `🎉 Profile "${name}" created • ${appCount} apps configured`;
    toast(successMsg, "success");
  } catch (error) {
    const errorMsg = getTranslation
      ? getTranslation("operation_error")
      : "Operation error!";
    toast(`${errorMsg} ${error.message}`, "error");
  }
}

async function deleteProfile() {
  const profileSelect = document.getElementById("profile-select");
  const selectedProfile = profileSelect?.value || currentProfile;

  if (!selectedProfile) {
    const errorMsg = getTranslation
      ? getTranslation("select_profile_to_delete")
      : "⚠️ Select a profile to delete";
    toast(errorMsg, "error");
    return;
  }

  if (!profiles[selectedProfile]) {
    const errorMsg = getTranslation
      ? getTranslation("profile_not_found", selectedProfile)
      : `Profile "${selectedProfile}" not found`;
    toast(errorMsg, "error");
    return;
  }

  try {
    delete profiles[selectedProfile];
    await run(`echo '${JSON.stringify(profiles)}' > ${profilesPath}`);

    // Clear current profile if it was deleted
    if (currentProfile === selectedProfile) {
      currentProfile = "";
      await persistDefaultKey("currentProfile", "");
    }

    // Reload profiles and apps
    await loadProfiles();
    await loadApps();

    const successMsg = getTranslation
      ? getTranslation("profile_deleted", selectedProfile)
      : `🗑️ Profile "${selectedProfile}" deleted`;
    toast(successMsg, "success");
  } catch (error) {
    const errorMsg = getTranslation
      ? getTranslation("operation_error")
      : "Operation error!";
    toast(`${errorMsg} ${error.message}`, "error");
  }
}

async function connectAllApps() {
  try {
    const config = {};

    // Clear all isolations
    for (const pkg of installedPackages) {
      config[pkg] = false;
      const uid = await run(
        `pm list packages | grep -E "^package:${pkg}$" | head -1 | cut -d: -f2 | xargs -r dumpsys package | grep -E "^[ ]*userId=" | head -1 | cut -d= -f2`,
      );
      if (uid && uid.trim()) {
        await run(`netd firewallctl setUidRule 1 ${uid.trim()} 0`);
      }
    }

    // Save configuration
    await run(`echo '${JSON.stringify(config)}' > ${configPath}`);

    // Clear current profile
    currentProfile = "";
    await persistDefaultKey("currentProfile", "");

    // Reload apps and profiles
    await loadProfiles();
    await loadApps();

    const successMsg = getTranslation
      ? getTranslation("all_apps_connected")
      : "🧹 All apps are now connected";
    toast(successMsg, "success");
  } catch (error) {
    const errorMsg = getTranslation
      ? getTranslation("operation_error")
      : "Operation error!";
    toast(`${errorMsg} ${error.message}`, "error");
  }
}

// Search functionality
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

// Import/Export functionality
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
        const data = utf8ToBase64(JSON.stringify(profiles, null, 2));
        await run(`echo '${data}' | base64 -d > '${path}'`);
        const successMsg = getTranslation
          ? getTranslation("export_success")
          : "Profiles exported successfully";
        toast(successMsg, "success");
      } else {
        const data = await run(`cat '${path}'`);
        const importedProfiles = JSON.parse(data);
        profiles = { ...profiles, ...importedProfiles };
        await run(`echo '${JSON.stringify(profiles)}' > ${profilesPath}`);
        await loadProfiles();
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

// Event listeners
document.addEventListener("DOMContentLoaded", async () => {
  // Load persisted profile
  await loadPersistedProfile();

  // Load profiles and apps
  await loadProfiles();
  await loadApps();

  // Setup event listeners
  setupSearch();
  setupImportExport();

  // Profile management
  const profileSelect = document.getElementById("profile-select");
  const createProfileBtn = document.getElementById("create-profile");
  const deleteProfileBtn = document.getElementById("delete-profile");

  profileSelect?.addEventListener("change", (e) => {
    if (e.target.value) {
      activateProfile(e.target.value);
    }
  });

  createProfileBtn?.addEventListener("click", createProfile);
  deleteProfileBtn?.addEventListener("click", deleteProfile);

  // Set button text with translation
  const openIoBtn = document.getElementById("open-io-page");
  if (openIoBtn) {
    openIoBtn.textContent = getTranslation
      ? getTranslation("backup_manager")
      : "Backup Manager";
  }
});
