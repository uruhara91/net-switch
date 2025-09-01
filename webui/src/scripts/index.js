import { exec, toast } from 'kernelsu';
import { t, setLang, getLang, onLangChange, availableLangs, ICONS, getLangDisplay } from './i18n.js';

const template = document.getElementById('app-template').content;
const appsList = document.getElementById('apps-list');

const configPath = "/data/adb/.config/net-switch/isolated.json";
const profilesPath = "/data/adb/.config/net-switch/profiles.json";
// Single default config file (stores language, last profile, etc.)
const defaultConfigPath = "/data/adb/.config/net-switch/default.json";

let profiles = {};
let currentProfile = '';
let installedPackages = new Set();

// Language selector + runtime translations
function createLangSelector() {
    // Place the selector absolutely inside the header bar so it's pinned to the right edge
    // Find the header bar element (the top container with border and bg classes)
    const headerBar = document.querySelector('.border-b') || document.querySelector('.px-4.py-3');
    if (!headerBar) return;

    // ensure headerBar is positioned relative so absolute children are positioned against it
    const prevPosition = headerBar.style.position;
    if (!prevPosition || prevPosition === '') headerBar.style.position = 'relative';

    const container = document.createElement('div');
    // absolute position near the right edge, vertically centered
    container.className = 'absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center';

    const select = document.createElement('select');
    select.id = 'ns-lang-select';
    select.title = 'Language';
    select.setAttribute('aria-label', 'Select language');
    // small, compact selector to sit near the edge
    select.className = 'rounded-md border border-gray-200 bg-white px-2 py-1 text-sm dark:bg-gray-800 dark:border-gray-700';
    availableLangs.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = getLangDisplay(lang);
        select.appendChild(opt);
    });
    select.value = getLang();
    select.addEventListener('change', (e) => setLang(e.target.value));
    container.appendChild(select);
    headerBar.appendChild(container);
}

function applyTranslations() {
    const elTitle = document.getElementById('ns-title');
    const elSubtitle = document.getElementById('ns-subtitle');
    const elProfilesTitle = document.getElementById('ns-profiles-title');
    const elSelectProfile = document.getElementById('ns-select-profile');
    const elCreate = document.getElementById('ns-create');
    const elSearchTitle = document.getElementById('ns-search-title');
    const elAppsTitle = document.getElementById('ns-apps-title');

    if (elTitle) elTitle.textContent = t('title');
    if (elSubtitle) elSubtitle.textContent = t('subtitle');
    if (elProfilesTitle) elProfilesTitle.textContent = t('profiles_title');
    if (elSelectProfile) elSelectProfile.textContent = `${t('select_profile_placeholder')}`;
    if (elCreate) elCreate.textContent = t('create');
    if (elSearchTitle) elSearchTitle.textContent = t('search_title');
    if (elAppsTitle) elAppsTitle.textContent = t('apps_list_title');

    const spinnerText = document.querySelector('#loading-spinner .text-base');
    if (spinnerText) spinnerText.textContent = t('loading');

    // update profile select placeholder if it exists
    const profileSelect = document.getElementById('profile-select');
    if (profileSelect) profileSelect.innerHTML = `<option value="">${t('select_profile_placeholder')}</option>`;

    // Refresh app list items so their status labels reflect newly selected language
    if (appsList) {
        [...appsList.children].forEach(node => {
            const checkbox = node.querySelector('.ns-toggle');
            const statusElement = node.querySelector('.app-status');
            const switchLabel = node.querySelector('.switch-label');
            if (!checkbox || !statusElement || !switchLabel) return;
            if (checkbox.checked) {
                statusElement.textContent = `${t('isolated')}`;
                statusElement.className = 'app-status text-red-600 dark:text-red-400 font-medium';
                switchLabel.textContent = `${t('isolated')}`;
                switchLabel.className = 'text-xs text-red-600 dark:text-red-400 switch-label font-medium';
            } else {
                statusElement.textContent = `${t('connected')}`;
                statusElement.className = 'app-status text-green-600 dark:text-green-400 font-medium';
                switchLabel.textContent = `${t('connected')}`;
                switchLabel.className = 'text-xs text-green-600 dark:text-green-400 switch-label font-medium';
            }
        });
    }

    // sync lang select value if present
    const langSelect = document.getElementById('ns-lang-select');
    if (langSelect) langSelect.value = getLang();
}

createLangSelector();
applyTranslations();
onLangChange(() => applyTranslations());

async function run(cmd) {
    const { errno, stdout, stderr } = await exec(cmd);
    if (errno !== 0) {
        toast(`stderr: ${stderr}`);
        return undefined;
    }
    return stdout;
}

// Load persisted language from filesystem (if available) and apply it.
async function loadPersistedLang() {
    try {
        const out = await run(`cat ${defaultConfigPath} 2>/dev/null || true`);
        if (out) {
            try {
                const cfg = JSON.parse(out.toString());
                if (cfg.lang && availableLangs.includes(cfg.lang)) setLang(cfg.lang);
            } catch (e) {
                // if file is plain text (legacy) try to treat as single lang value
                const fileLang = out.toString().trim();
                if (availableLangs.includes(fileLang)) setLang(fileLang);
            }
        }
    } catch (e) {
        // ignore
    }
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
        if (cfg.currentProfile && profiles[cfg.currentProfile]) {
            await loadProfile(cfg.currentProfile);
        }
    } catch (e) {
        // ignore
    }
}

// Persist language changes to the default config so selection survives restarts
onLangChange(async (lang) => {
    await persistDefaultKey('lang', lang);
});

// attempt to load persisted language (and any legacy value)
loadPersistedLang();

function sortChecked() {
    [...appsList.children]
        .sort((a, b) => (a.querySelector('.ns-toggle').checked ? -1 : 1))
        .forEach((node) => appsList.appendChild(node));
}

const isolateList = [];

function populateApp(name, checked) {
    const node = document.importNode(template, true);
    const nameElement = node.querySelector('p');
    nameElement.textContent = name;

    const checkbox = node.querySelector('.ns-toggle');
    checkbox.checked = checked;

    // Update app status indicator
    const statusElement = node.querySelector('.app-status');
    const switchLabel = node.querySelector('.switch-label');
    
    function updateStatus() {
        if (checkbox.checked) {
            statusElement.textContent = t('isolated');
            statusElement.className = 'app-status text-red-600 dark:text-red-400 font-medium';
            switchLabel.textContent = t('isolated');
            switchLabel.className = 'text-xs text-red-600 dark:text-red-400 switch-label font-medium';
        } else {
            statusElement.textContent = t('connected');
            statusElement.className = 'app-status text-green-600 dark:text-green-400 font-medium';
            switchLabel.textContent = t('connected');
            switchLabel.className = 'text-xs text-green-600 dark:text-green-400 switch-label font-medium';
        }
    }
    
    updateStatus();
    
    if (checked) isolateList.push(name);

    checkbox.addEventListener('change', async () => {
        showLoading();

        const { stdout: appUid } = await exec(`grep "^${name}" /data/system/packages.list | awk '{print $2; exit}'`);

        if (!appUid || isNaN(appUid)) {
            showError(t('cannot_get_uid', { app: name }));
            hideLoading();
            await saveIsolateList();
            return;
        }

        if (checkbox.checked) {
            isolateList.push(name);
            await run(`iptables -I OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
            await run(`ip6tables -I OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
        } else {
            const index = isolateList.indexOf(name);
            if (index !== -1) isolateList.splice(index, 1);
            await run(`iptables -D OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
            await run(`ip6tables -D OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
        }

        updateStatus();
        await saveIsolateList();
        hideLoading();

            if (currentProfile && profiles[currentProfile]) {
                profiles[currentProfile] = [...isolateList];
                await saveProfiles();
                updateProfileSelect();
                await persistDefaultKey('currentProfile', currentProfile);
            }
    });

    appsList.appendChild(node);
}

async function saveIsolateList() {
    await run(`echo '${JSON.stringify(isolateList)}' >${configPath}`);
}

async function loadProfiles() {
    const profilesOut = await run(`cat ${profilesPath}`);
    profiles = profilesOut ? JSON.parse(profilesOut) : {};
    updateProfileSelect();
}

async function saveProfiles() {
    await run(`echo '${JSON.stringify(profiles)}' >${profilesPath}`);
}

function showLoading() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) {
        spinner.classList.remove('hidden');
        spinner.classList.add('flex');
    }
}

function hideLoading() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) {
        spinner.classList.add('hidden');
        spinner.classList.remove('flex');
    }
}

function showSuccess(message) {
    const toast = document.getElementById('success-toast');
    const messageEl = document.getElementById('success-message');
    if (toast && messageEl) {
        messageEl.textContent = message;
        // center the message text and center the toast container
        messageEl.style.textAlign = 'center';
        toast.style.display = 'flex';
        toast.style.justifyContent = 'center';
        toast.style.alignItems = 'center';
        toast.classList.remove('translate-x-full', 'toast-hidden');
        setTimeout(() => {
            toast.classList.add('translate-x-full', 'toast-hidden');
            // restore inline styles
            messageEl.style.textAlign = '';
            toast.style.justifyContent = '';
            toast.style.alignItems = '';
        }, 2500);
    }
}

function showError(message) {
    const toast = document.getElementById('error-toast');
    const messageEl = document.getElementById('error-message');
    if (toast && messageEl) {
        messageEl.textContent = message;
        toast.classList.remove('translate-x-full', 'toast-hidden');
        setTimeout(() => {
            toast.classList.add('translate-x-full', 'toast-hidden');
        }, 2500);
    }
}

function updateProfileSelect() {
    const select = document.getElementById('profile-select');
    select.innerHTML = `<option value="">${t('select_profile_placeholder')}</option>`;

    Object.keys(profiles).forEach(profileName => {
        const option = document.createElement('option');
        option.value = profileName;
        const appCount = profiles[profileName] ? profiles[profileName].length : 0;
    option.textContent = `${ICONS.folder} ${profileName} (${appCount})`;
        if (profileName === currentProfile) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

// Import/Export profiles: UI helpers
function createImportExportControls() {
    // The actual controls are present in the dedicated HTML panel; this function
    // wires them to the runtime logic so translations and ICONS can be applied.
    const exportBtn = document.getElementById('export-profiles-btn');
    const importBtn = document.getElementById('import-profiles-btn');
    const importInput = document.getElementById('import-profiles-input');
    const importTitle = document.getElementById('ns-import-title');
    if (importTitle) importTitle.textContent = `${t('import_export_title') || 'Import / Export Profiles'}`;

    if (exportBtn) {
        exportBtn.textContent = `${ICONS.save} ${t('export_profiles') || 'Export Profiles'}`;
        exportBtn.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'net-switch-profiles.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        });
    }

    if (importBtn && importInput) {
        importBtn.textContent = `${ICONS.import} ${t('import_profiles') || 'Import Profiles'}`;
        importBtn.addEventListener('click', () => importInput.click());

        importInput.addEventListener('change', async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            try {
                const text = await f.text();
                const imported = JSON.parse(text);
                Object.keys(imported).forEach(k => { profiles[k] = imported[k]; });
                await saveProfiles();
                updateProfileSelect();
                showSuccess(t('profiles_imported') || 'Profiles imported');
            } catch (err) {
                showError(t('profiles_import_error') || 'Invalid profiles file');
            }
        });
    }

    // Make the two buttons share the full width: 50% / 50%
    try {
        const wrapper = exportBtn?.parentElement || importBtn?.parentElement;
        if (wrapper) {
            wrapper.style.display = 'flex';
            wrapper.style.width = '100%';
            wrapper.style.gap = '0.5rem';
            // ensure children shrink/grow evenly
            if (exportBtn) {
                exportBtn.style.flex = '1 1 50%';
                exportBtn.style.width = '50%';
                exportBtn.style.boxSizing = 'border-box';
            }
            if (importBtn) {
                importBtn.style.flex = '1 1 50%';
                importBtn.style.width = '50%';
                importBtn.style.boxSizing = 'border-box';
            }
        }
    } catch (e) {
        // ignore styling errors
    }
}

// initialize import/export controls
createImportExportControls();

async function loadProfile(profileName) {
    if (!profiles[profileName]) {
        showError(t('profile_not_found', { name: profileName }));
        return;
    }

    showLoading();

    // Clear current isolation first
    await clearAllIsolation();
    isolateList.length = 0;
    
    // Apply profile apps
    const profileApps = profiles[profileName];
    for (const app of profileApps) {
        if (installedPackages.has(app)) {
            isolateList.push(app);
            
            // Apply iptables rules
            const { stdout: appUid } = await exec(`grep "^${app}" /data/system/packages.list | awk '{print $2; exit}'`);
            if (appUid && !isNaN(appUid)) {
                await run(`iptables -I OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
                await run(`ip6tables -I OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
            }
        }
    }

    // Update UI checkboxes and status
    [...appsList.children].forEach(node => {
        const appName = node.querySelector('p').textContent;
        const checkbox = node.querySelector('.ns-toggle');
        const statusElement = node.querySelector('.app-status');
        const switchLabel = node.querySelector('.switch-label');
        
        checkbox.checked = isolateList.includes(appName);
        
            if (checkbox.checked) {
                statusElement.textContent = t('isolated');
                statusElement.className = 'app-status text-red-600 dark:text-red-400 font-medium';
                switchLabel.textContent = t('isolated');
                switchLabel.className = 'text-xs text-red-600 dark:text-red-400 switch-label font-medium';
            } else {
                statusElement.textContent = t('connected');
                statusElement.className = 'app-status text-green-600 dark:text-green-400 font-medium';
                switchLabel.textContent = t('connected');
                switchLabel.className = 'text-xs text-green-600 dark:text-green-400 switch-label font-medium';
            }
    });

    currentProfile = profileName;
    await saveIsolateList();
    sortChecked();
    hideLoading();
    await persistDefaultKey('currentProfile', currentProfile);
    showSuccess(t('profile_activated', { name: profileName, count: profileApps.length }));
}

async function saveCurrentProfile(profileName) {
    profiles[profileName] = [...isolateList];
    await saveProfiles();
    currentProfile = profileName;
    updateProfileSelect();
    await persistDefaultKey('currentProfile', currentProfile);
    showSuccess(t('profile_created', { name: profileName, count: isolateList.length }));
}

async function deleteProfile(profileName) {
    if (!profileName) {
        showError(t('invalid_profile_name'));
        return false;
    }
    // Remove the profile from the profiles object
    delete profiles[profileName];
    await saveProfiles();
        if (currentProfile === profileName) {
        currentProfile = '';
        await persistDefaultKey('currentProfile', '');
    }
    updateProfileSelect();
    showSuccess(t('profile_deleted', { name: profileName }));
    // Clean up empty profile entry in config file using sed
    await run(`sed -i "s/\\"${profileName}\\":\\[\\],//g; s/,\\\"${profileName}\\":\\[\\]//g; s/\\"${profileName}\\":\\[\\]//g" ${profilesPath}`);
    return true;
}

async function clearAllIsolation() {
    for (const app of isolateList) {
        const { stdout: appUid } = await exec(`grep "^${app}" /data/system/packages.list | awk '{print $2; exit}'`);
        if (appUid && !isNaN(appUid)) {
            await run(`iptables -D OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
            await run(`ip6tables -D OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
        }
    }
}

async function main() {
    const pkgs = await run("pm list packages");
    if (pkgs === undefined) return;

    const isolatedListOut = await run(`cat ${configPath}`);
    let isolated = isolatedListOut ? JSON.parse(isolatedListOut) : [];

    installedPackages = new Set(pkgs.split('\n').map((line) => line.split(':')[1]).filter(Boolean));
    const updatedIsolatedList = isolated.filter((app) => installedPackages.has(app));

    if (isolated.length !== updatedIsolatedList.length) {
        await run(`echo '${JSON.stringify(updatedIsolatedList)}' >${configPath}`);
        isolated = updatedIsolatedList;
    }

    await loadProfiles();

    // try to restore last selected profile (if any)
    await loadPersistedProfile();

    for (const pkg of installedPackages) {
        const isIsolated = isolated.includes(pkg);
        populateApp(pkg, isIsolated);
    }

    sortChecked();

    const searchInput = document.getElementById("search");
    searchInput.addEventListener('input', (e) => {
        const searchVal = e.target.value.toLowerCase();
        let hasResults = false;
        
        [...appsList.children].forEach((node) => {
            const appName = node.querySelector('p').textContent.toLowerCase();
            const isVisible = appName.includes(searchVal);
            node.style.display = isVisible ? '' : 'none';
            if (isVisible) hasResults = true;
        });
        
        if (searchVal && hasResults) {
            const firstVisibleApp = [...appsList.children].find(node => 
                node.style.display !== 'none'
            );
            if (firstVisibleApp) {
                firstVisibleApp.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }
        }
    });
    
    searchInput.addEventListener('focus', () => {
        searchInput.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
        });
    });

    document.getElementById('create-profile').addEventListener('click', async () => {
        const newProfileName = document.getElementById('new-profile-name').value.trim();
        if (!newProfileName) {
            showError(t('enter_profile_name'));
            return;
        }
        if (profiles[newProfileName]) {
            showError(t('profile_exists'));
            return;
        }

        await clearAllIsolation();
        isolateList.length = 0;
        await saveIsolateList();

        [...appsList.children].forEach(node => {
            const checkbox = node.querySelector('.ns-toggle');
            const statusElement = node.querySelector('.app-status');
            const switchLabel = node.querySelector('.switch-label');
            
            checkbox.checked = false;
            statusElement.textContent = t('connected');
            statusElement.className = 'app-status text-green-600 dark:text-green-400 font-medium';
            switchLabel.textContent = t('connected');
            switchLabel.className = 'text-xs text-green-600 dark:text-green-400 switch-label font-medium';
        });

        sortChecked();

        await saveCurrentProfile(newProfileName);
        document.getElementById('new-profile-name').value = '';
    });

    document.getElementById('delete-profile').addEventListener('click', async (e) => {
        e.preventDefault();
        const selectedProfile = document.getElementById('profile-select').value;
        const profileToDelete = selectedProfile || currentProfile;
        if (!profileToDelete) {
            showError(t('select_profile_to_delete'));
            return;
        }

        const deleted = await deleteProfile(profileToDelete);
        if (deleted) document.getElementById('profile-select').value = '';
    });

    document.getElementById('profile-select').addEventListener('change', async (e) => {
        if (e.target.value) {
            await loadProfile(e.target.value);
        } else {
            if (currentProfile) {
                await clearAllIsolation();
                isolateList.length = 0;
                await saveIsolateList();
                currentProfile = '';

                [...appsList.children].forEach(node => {
                    const checkbox = node.querySelector('.ns-toggle');
                    const statusElement = node.querySelector('.app-status');
                    const switchLabel = node.querySelector('.switch-label');
                    
                    checkbox.checked = false;
                    statusElement.textContent = t('connected');
                    statusElement.className = 'app-status text-green-600 dark:text-green-400 font-medium';
                    switchLabel.textContent = t('connected');
                    switchLabel.className = 'text-xs text-green-600 dark:text-green-400 switch-label font-medium';
                });

                sortChecked();
                showSuccess(t('all_apps_connected'));
            }
        }
    });
}

main();
                
