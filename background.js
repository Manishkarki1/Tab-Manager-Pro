let tabGroups = {};
let inactiveTabs = new Set();

// Tab grouping functionality
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    analyzeAndGroupTab(tab);
  }
});

async function analyzeAndGroupTab(tab) {
  const url = new URL(tab.url);
  const domain = url.hostname;

  if (!tabGroups[domain]) {
    tabGroups[domain] = [];
  }
  tabGroups[domain].push(tab.id);

  await chrome.storage.local.set({ tabGroups });
}

// Tab suspension
chrome.idle.onStateChanged.addListener((newState) => {
  if (newState === "idle") {
    suspendInactiveTabs();
  }
});

async function suspendInactiveTabs() {
  const tabs = await chrome.tabs.query({ active: false });
  for (const tab of tabs) {
    if (!inactiveTabs.has(tab.id)) {
      inactiveTabs.add(tab.id);
      chrome.tabs.discard(tab.id);
    }
  }
}

// Session management
chrome.runtime.onStartup.addListener(async () => {
  const { savedSession } = await chrome.storage.local.get("savedSession");
  if (savedSession) {
    restoreSession(savedSession);
  }
});

async function saveCurrentSession() {
  const tabs = await chrome.tabs.query({});
  const session = tabs.map((tab) => ({
    url: tab.url,
    title: tab.title,
    pinned: tab.pinned,
  }));
  await chrome.storage.local.set({ savedSession: session });
}
