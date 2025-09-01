import { exec, toast } from 'kernelsu';

const template = document.getElementById('app-template').content;
const appsList = document.getElementById('apps-list');

const configPath = "/data/adb/.config/net-switch/isolated.json";
const profilesPath = "/data/adb/.config/net-switch/profiles.json";

let profiles = {};
let currentProfile = '';
let installedPackages = new Set();

async function run(cmd) {
    const { errno, stdout, stderr } = await exec(cmd);
    if (errno !== 0) {
        toast(`stderr: ${stderr}`);
        return undefined;
    }
    return stdout;
}

function sortChecked() {
    [...appsList.children]
        .sort((a, b) => (a.querySelector('input[type="checkbox"]').checked ? -1 : 1))
        .forEach((node) => appsList.appendChild(node));
}

const isolateList = [];

function populateApp(name, checked) {
    const node = document.importNode(template, true);
    const nameElement = node.querySelector('p');
    nameElement.textContent = name;

    const checkbox = node.querySelector('input[type="checkbox"]');
    checkbox.checked = checked;

    // Update app status indicator
    const statusElement = node.querySelector('.app-status');
    const switchLabel = node.querySelector('.switch-label');
    
    function updateStatus() {
        if (checkbox.checked) {
            statusElement.textContent = '🚫 Isolato';
            statusElement.className = 'app-status text-red-600 dark:text-red-400 font-medium';
            switchLabel.textContent = 'Isolato';
            switchLabel.className = 'text-xs text-red-600 dark:text-red-400 switch-label font-medium';
        } else {
            statusElement.textContent = '📡 Connesso';
            statusElement.className = 'app-status text-green-600 dark:text-green-400 font-medium';
            switchLabel.textContent = 'Connesso';
            switchLabel.className = 'text-xs text-green-600 dark:text-green-400 switch-label font-medium';
        }
    }
    
    updateStatus();
    
    if (checked) isolateList.push(name);

    checkbox.addEventListener('change', async () => {
        showLoading();

        const { stdout: appUid } = await exec(`grep "^${name}" /data/system/packages.list | awk '{print $2; exit}'`);

        if (!appUid || isNaN(appUid)) {
            showError(`Impossibile ottenere UID di ${name}`);
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
        toast.classList.remove('translate-x-full', 'toast-hidden');
        setTimeout(() => {
            toast.classList.add('translate-x-full', 'toast-hidden');
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
    select.innerHTML = '<option value="">🔍 Seleziona Profilo</option>';

    Object.keys(profiles).forEach(profileName => {
        const option = document.createElement('option');
        option.value = profileName;
        const appCount = profiles[profileName] ? profiles[profileName].length : 0;
        option.textContent = `📁 ${profileName} (${appCount})`;
        if (profileName === currentProfile) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

async function loadProfile(profileName) {
    if (!profiles[profileName]) {
        showError(`Profilo "${profileName}" non trovato`);
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
        const checkbox = node.querySelector('input[type="checkbox"]');
        const statusElement = node.querySelector('.app-status');
        const switchLabel = node.querySelector('.switch-label');
        
        checkbox.checked = isolateList.includes(appName);
        
        if (checkbox.checked) {
            statusElement.textContent = '� Isolato';
            statusElement.className = 'app-status text-red-600 dark:text-red-400 font-medium';
            switchLabel.textContent = 'Isolato';
            switchLabel.className = 'text-xs text-red-600 dark:text-red-400 switch-label font-medium';
        } else {
            statusElement.textContent = '📡 Connesso';
            statusElement.className = 'app-status text-green-600 dark:text-green-400 font-medium';
            switchLabel.textContent = 'Connesso';
            switchLabel.className = 'text-xs text-green-600 dark:text-green-400 switch-label font-medium';
        }
    });

    currentProfile = profileName;
    await saveIsolateList();
    sortChecked();
    hideLoading();
    showSuccess(`✅ Profilo "${profileName}" attivato • ${profileApps.length} app isolate`);
}

async function saveCurrentProfile(profileName) {
    profiles[profileName] = [...isolateList];
    await saveProfiles();
    currentProfile = profileName;
    updateProfileSelect();
    showSuccess(`🎉 Profilo "${profileName}" creato • ${isolateList.length} app configurate`);
}

async function deleteProfile(profileName) {
    if (!profileName) {
        showError(`Nome profilo non valido`);
        return false;
    }
    // Remove the profile from the profiles object
    delete profiles[profileName];
    await saveProfiles();
    if (currentProfile === profileName) {
        currentProfile = '';
    }
    updateProfileSelect();
    showSuccess(`🗑️ Profilo "${profileName}" eliminato`);
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
            showError('⚠️ Inserisci un nome per il nuovo profilo');
            return;
        }
        if (profiles[newProfileName]) {
            showError('⚠️ Un profilo con questo nome esiste già');
            return;
        }

        await clearAllIsolation();
        isolateList.length = 0;
        await saveIsolateList();

        [...appsList.children].forEach(node => {
            const checkbox = node.querySelector('input[type="checkbox"]');
            const statusElement = node.querySelector('.app-status');
            const switchLabel = node.querySelector('.switch-label');
            
            checkbox.checked = false;
            statusElement.textContent = '📡 Connesso';
            statusElement.className = 'app-status text-green-600 dark:text-green-400 font-medium';
            switchLabel.textContent = 'Connesso';
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
            showError('⚠️ Seleziona un profilo da eliminare dal menu a tendina');
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
                    const checkbox = node.querySelector('input[type="checkbox"]');
                    const statusElement = node.querySelector('.app-status');
                    const switchLabel = node.querySelector('.switch-label');
                    
                    checkbox.checked = false;
                    statusElement.textContent = '📡 Connesso';
                    statusElement.className = 'app-status text-green-600 dark:text-green-400 font-medium';
                    switchLabel.textContent = 'Connesso';
                    switchLabel.className = 'text-xs text-green-600 dark:text-green-400 switch-label font-medium';
                });

                sortChecked();
                showSuccess(`🧹 Tutte le app sono ora connesse`);
            }
        }
    });
}

main();
                
