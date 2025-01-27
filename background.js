let tabGroups = {};
let inactiveTabs = new Set();
let suspensionTimeouts = new Map();

// Configuration
const IDLE_TIMEOUT = 30; // minutes
const MAX_SUSPENDED_TABS = 20;
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Tab grouping functionality
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    analyzeAndGroupTab(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabFromGroups(tabId);
  inactiveTabs.delete(tabId);
  suspensionTimeouts.delete(tabId);
});

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
    await syncToCloud();
    setInterval(syncToCloud, SYNC_INTERVAL);
  } catch (error) {
    console.error("Error starting sync:", error);
  }
}

async function syncToCloud() {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings?.syncEnabled) return;

    const syncData = {
      tabGroups,
      lastSyncTime: Date.now(),
    };

    await chrome.storage.sync.set(syncData);
  } catch (error) {
    console.error("Error syncing to cloud:", error);
  }
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
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.tabGroups) {
    handleSyncedChanges(changes.tabGroups.newValue);
  }
});

async function handleSyncedChanges(newTabGroups) {
  try {
    // Merge with local groups
    for (const domain in newTabGroups) {
      if (!tabGroups[domain]) {
        tabGroups[domain] = [];
      }
      tabGroups[domain] = [
        ...new Set([...tabGroups[domain], ...newTabGroups[domain]]),
      ];
    }
    await saveTabGroups();
  } catch (error) {
    console.error("Error handling synced changes:", error);
  }
}
