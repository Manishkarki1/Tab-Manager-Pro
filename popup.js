document.addEventListener("DOMContentLoaded", async () => {
  // Load and display tab groups - with null checking
  const { tabGroups = {} } = await chrome.storage.local.get("tabGroups");
  await displayTabGroups(tabGroups);

  // Add event delegation for tab switching
  document.getElementById("tab-groups").addEventListener("click", (e) => {
    const switchButton = e.target.closest(".switch-tab-btn");
    if (switchButton) {
      const tabId = parseInt(switchButton.dataset.tabId);
      const windowId = parseInt(switchButton.dataset.windowId);
      switchToTab(tabId, windowId);
    }
  });

  // Search functionality
  const searchBox = document.querySelector(".search-box");
  searchBox.addEventListener("input", async (e) => {
    const query = e.target.value.toLowerCase();
    const tabs = await chrome.tabs.query({});
    const filteredTabs = tabs.filter(
      (tab) =>
        tab.title.toLowerCase().includes(query) ||
        tab.url.toLowerCase().includes(query)
    );
    displaySearchResults(filteredTabs);
  });

  // Session management buttons
  document.getElementById("save-session").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "saveSession" });
  });

  document.getElementById("restore-session").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "restoreSession" });
  });
});

async function displayTabGroups(groups = {}) {
  const container = document.getElementById("tab-groups");
  container.innerHTML = "";

  // If no groups exist yet, show all tabs in an "Ungrouped" section
  if (Object.keys(groups).length === 0) {
    const allTabs = await chrome.tabs.query({});
    const tabElements = await Promise.all(allTabs.map(createTabElement));

    const groupElement = document.createElement("div");
    groupElement.className = "tab-group";
    groupElement.innerHTML = `
        <h3>All Tabs</h3>
        <div class="tab-list">
          ${tabElements.filter((el) => el !== "").join("")}
        </div>
      `;
    container.appendChild(groupElement);
    return;
  }

  // Display existing groups
  for (const [domain, tabIds] of Object.entries(groups)) {
    const groupElement = document.createElement("div");
    groupElement.className = "tab-group";

    const tabElements = await Promise.all(tabIds.map(createTabElement));
    const validTabElements = tabElements.filter((element) => element !== "");

    if (validTabElements.length > 0) {
      groupElement.innerHTML = `
          <h3>${domain}</h3>
          <div class="tab-list">
            ${validTabElements.join("")}
          </div>
        `;
      container.appendChild(groupElement);
    }
  }
}

async function createTabElement(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return `
        <div class="tab-item" data-tab-id="${tabId}">
          <img src="chrome://favicon/size/16@2x/${tab.url}" width="16" height="16">
          <span>${tab.title}</span>
          <button class="switch-tab-btn" 
                  data-tab-id="${tabId}" 
                  data-window-id="${tab.windowId}">
            Switch
          </button>
        </div>
      `;
  } catch (error) {
    console.error(`Error getting tab ${tabId}:`, error);
    return ""; // Return empty string if tab not found
  }
}

async function displaySearchResults(tabs) {
  const container = document.getElementById("tab-groups");
  const tabElements = await Promise.all(
    tabs.map((tab) => createTabElement(tab.id))
  );

  const groupElement = document.createElement("div");
  groupElement.className = "tab-group";
  groupElement.innerHTML = `
      <h3>Search Results</h3>
      <div class="tab-list">
        ${tabElements.filter((element) => element !== "").join("")}
      </div>
    `;
  container.innerHTML = "";
  container.appendChild(groupElement);
}

function switchToTab(tabId, windowId) {
  chrome.tabs.update(tabId, { active: true });
  chrome.windows.update(windowId, { focused: true });
}
