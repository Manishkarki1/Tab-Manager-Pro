let tabGroups = {};
let inactiveTabs = new Set();
let suspensionTimeouts = new Map();

// Configuration
const IDLE_TIMEOUT = 30; // minutes
const MAX_SUSPENDED_TABS = 20;
const SYNC_INTERVAL = 2 * 60 * 1000;

// Tab grouping functionality
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    analyzeAndGroupTab(tab);
  }
});
chrome.runtime.onStartup.addListener(async () => {
  await loadSavedState();
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  removeTabFromGroups(tabId);
  inactiveTabs.delete(tabId);
  suspensionTimeouts.delete(tabId);
  await saveState();
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXPORT_TABS") {
    handleExportTabs()
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === "IMPORT_TABS") {
    handleImportTabs(message.data)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
async function handleExportTabs() {
  try {
    // Get all current tabs
    const allTabs = await chrome.tabs.query({});
    const exportData = {
      tabGroups: {},
      urls: {},
      timestamp: Date.now(),
    };

    // Organize tabs by domain
    for (const tab of allTabs) {
      try {
        const url = new URL(tab.url);
        const domain = url.hostname;

        if (!exportData.tabGroups[domain]) {
          exportData.tabGroups[domain] = [];
          exportData.urls[domain] = [];
        }

        exportData.tabGroups[domain].push(tab.id);
        exportData.urls[domain].push(tab.url);
      } catch (error) {
        console.error("Error processing tab:", tab, error);
      }
    }

    return exportData;
  } catch (error) {
    console.error("Error in handleExportTabs:", error);
    throw error;
  }
}
async function handleImportTabs(importedData) {
  try {
    // Validate imported data
    if (
      !importedData ||
      typeof importedData !== "object" ||
      !importedData.urls ||
      typeof importedData.urls !== "object"
    ) {
      throw new Error("Invalid import data format");
    }

    // Ensure `tabGroups` is initialized
    if (typeof tabGroups === "undefined" || tabGroups === null) {
      tabGroups = {}; // Initialize if undefined
    }

    // Process each domain and URL
    for (const [domain, urls] of Object.entries(importedData.urls)) {
      if (!Array.isArray(urls)) continue;

      // Initialize the domain group if it doesn't exist
      if (!tabGroups[domain]) {
        tabGroups[domain] = [];
      }

      // Create new tabs for each URL
      for (const url of urls) {
        try {
          const newTab = await chrome.tabs.create({
            url,
            active: false,
          });
          tabGroups[domain].push(newTab.id); // Add tab ID to the group
        } catch (tabError) {
          console.error(`Failed to create tab for ${url}:`, tabError);
        }
      }
    }

    await saveState(); // Save the updated state
    return true;
  } catch (error) {
    console.error("Error in handleImportTabs:", error);
    throw error;
  }
}
async function analyzeAndGroupTab(tab) {
  try {
    const url = new URL(tab.url);
    const domain = url.hostname;

    // Remove tab from previous groups
    await removeTabFromGroups(tab.id);

    // Add to new group
    if (!tabGroups[domain]) {
      tabGroups[domain] = [];
    }
    if (!tabGroups[domain].includes(tab.id)) {
      tabGroups[domain].push(tab.id);
    }

    await saveTabGroups();
    await syncToCloud();
  } catch (error) {
    console.error("Error in analyzeAndGroupTab:", error);
  }
}
async function loadSavedState() {
  try {
    const { savedTabGroups, savedInactiveTabs } =
      await chrome.storage.local.get(["savedTabGroups", "savedInactiveTabs"]);

    if (savedTabGroups) {
      tabGroups = savedTabGroups;
    }

    if (savedInactiveTabs) {
      inactiveTabs = new Set(savedInactiveTabs);
    }

    // Verify and clean up tabGroups
    await validateTabGroups();
  } catch (error) {
    console.error("Error loading saved state:", error);
  }
}
async function validateTabGroups() {
  try {
    const allTabs = await chrome.tabs.query({});
    const validTabIds = new Set(allTabs.map((tab) => tab.id));

    for (const domain in tabGroups) {
      tabGroups[domain] = tabGroups[domain].filter((tabId) =>
        validTabIds.has(tabId)
      );
      if (tabGroups[domain].length === 0) {
        delete tabGroups[domain];
      }
    }

    await saveState();
  } catch (error) {
    console.error("Error validating tab groups:", error);
  }
}
async function saveState() {
  try {
    await chrome.storage.local.set({
      savedTabGroups: tabGroups,
      savedInactiveTabs: Array.from(inactiveTabs),
      lastSaved: Date.now(),
    });
  } catch (error) {
    console.error("Error saving state:", error);
  }
}
async function removeTabFromGroups(tabId) {
  for (const domain in tabGroups) {
    tabGroups[domain] = tabGroups[domain].filter((id) => id !== tabId);
    if (tabGroups[domain].length === 0) {
      delete tabGroups[domain];
    }
  }
  await saveTabGroups();
}

// Enhanced tab suspension
chrome.idle.onStateChanged.addListener((newState) => {
  if (newState === "idle") {
    suspendInactiveTabs();
  } else if (newState === "active") {
    cancelPendingSuspensions();
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  inactiveTabs.delete(tabId);
  if (suspensionTimeouts.has(tabId)) {
    clearTimeout(suspensionTimeouts.get(tabId));
    suspensionTimeouts.delete(tabId);
  }
});

async function suspendInactiveTabs() {
  try {
    const tabs = await chrome.tabs.query({ active: false });
    const settings = await chrome.storage.local.get("settings");
    const autoSuspend = settings?.settings?.autoSuspend ?? true;

    if (!autoSuspend) return;

    for (const tab of tabs) {
      if (!inactiveTabs.has(tab.id) && !isProtectedTab(tab)) {
        const timeoutId = setTimeout(async () => {
          try {
            await chrome.tabs.discard(tab.id);
            inactiveTabs.add(tab.id);
          } catch (error) {
            console.error("Error suspending tab:", error);
          }
        }, IDLE_TIMEOUT * 60 * 1000);

        suspensionTimeouts.set(tab.id, timeoutId);
      }
    }

    // Limit suspended tabs
    if (inactiveTabs.size > MAX_SUSPENDED_TABS) {
      const tabsToResume = Array.from(inactiveTabs).slice(MAX_SUSPENDED_TABS);
      for (const tabId of tabsToResume) {
        inactiveTabs.delete(tabId);
      }
    }
  } catch (error) {
    console.error("Error in suspendInactiveTabs:", error);
  }
}

function cancelPendingSuspensions() {
  for (const timeoutId of suspensionTimeouts.values()) {
    clearTimeout(timeoutId);
  }
  suspensionTimeouts.clear();
}

function isProtectedTab(tab) {
  return tab.pinned || tab.audible || tab.url.startsWith("chrome://");
}

// Enhanced session management
chrome.runtime.onStartup.addListener(async () => {
  await initializeExtension();
});

chrome.runtime.onInstalled.addListener(async () => {
  await initializeExtension();
});

async function initializeExtension() {
  try {
    const { savedSession } = await chrome.storage.local.get("savedSession");
    if (savedSession) {
      await restoreSession(savedSession);
    }

    // Initialize sync
    await setupSync();

    // Start periodic saving
    setInterval(saveCurrentSession, 5 * 60 * 1000); // Save every 5 minutes
  } catch (error) {
    console.error("Error in initializeExtension:", error);
  }
}

async function saveCurrentSession() {
  try {
    const tabs = await chrome.tabs.query({});
    const session = tabs.map((tab) => ({
      url: tab.url,
      title: tab.title,
      pinned: tab.pinned,
      groupId: tab.groupId,
      lastAccessed: Date.now(),
    }));

    await chrome.storage.local.set({
      savedSession: session,
      lastSaved: Date.now(),
    });
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

async function restoreSession(session) {
  try {
    for (const tab of session) {
      await chrome.tabs.create({
        url: tab.url,
        pinned: tab.pinned,
      });
    }
  } catch (error) {
    console.error("Error restoring session:", error);
  }
}

// Cross-device sync
async function setupSync() {
  const { settings } = await chrome.storage.local.get("settings");
  if (settings?.syncEnabled) {
    startSync();
  }
}

async function startSync() {
  try {
    await syncToCloud(); // Initial sync
    setInterval(syncToCloud, SYNC_INTERVAL); // Schedule periodic sync
  } catch (error) {
    console.error("Error starting sync:", error);
  }
}

async function syncToCloud() {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings?.syncEnabled) return;

    const currentSyncData = await chrome.storage.sync.get(null);
    const newSyncData = {
      tabGroups,
      urls: await getUrlsForGroups(),
      lastSyncTime: Date.now(),
    };

    // Only sync if there are changes
    if (
      JSON.stringify(currentSyncData.tabGroups) !== JSON.stringify(tabGroups) ||
      JSON.stringify(currentSyncData.urls) !== JSON.stringify(newSyncData.urls)
    ) {
      await chrome.storage.sync.set(newSyncData);
      console.log("Sync successful:", newSyncData);
    } else {
      console.log("No changes to sync.");
    }
  } catch (error) {
    console.error("Error syncing to cloud:", error);
  }
}
async function getUrlsForGroups() {
  const urls = {};
  const allTabs = await chrome.tabs.query({});

  for (const domain in tabGroups) {
    urls[domain] = tabGroups[domain]
      .map((tabId) => allTabs.find((tab) => tab.id === tabId)?.url)
      .filter((url) => url);
  }

  return urls;
}

// Helper functions
async function saveTabGroups() {
  try {
    await chrome.storage.local.set({ tabGroups });
  } catch (error) {
    console.error("Error saving tab groups:", error);
  }
}

// Listen for sync changes
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "sync" && changes.tabGroups) {
    await handleSyncedChanges(
      changes.tabGroups.newValue,
      changes.urls?.newValue || {}
    );
  }
});

async function handleSyncedChanges(newTabGroups, newUrls) {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings?.syncEnabled) return;

    // Create new tabs for URLs that don't exist locally
    for (const domain in newUrls) {
      const existingTabs = await chrome.tabs.query({});
      const existingUrls = new Set(existingTabs.map((tab) => tab.url));

      for (const url of newUrls[domain]) {
        if (!existingUrls.has(url)) {
          const newTab = await chrome.tabs.create({ url, active: false });
          if (!tabGroups[domain]) {
            tabGroups[domain] = [];
          }
          tabGroups[domain].push(newTab.id);
        }
      }
    }

    await saveState();
  } catch (error) {
    console.error("Error handling synced changes:", error);
  }
}
