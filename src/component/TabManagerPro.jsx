import React, { useState, useEffect } from "react";
import {
  Search,
  X,
  Bookmark,
  Clock,
  Save,
  RotateCcw,
  Layers,
  AlertCircle,
  Settings,
  Cloud,
  Download,
  Share2,
} from "lucide-react";

const TabManagerPro = () => {
  const [tabs, setTabs] = useState([]);
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeView, setActiveView] = useState("groups");
  const [notification, setNotification] = useState(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [settings, setSettings] = useState({
    darkMode: false,
    autoGroup: true,
    syncEnabled: false,
  });
  const [recentTabs, setRecentTabs] = useState([]);

  useEffect(() => {
    loadTabs();
    loadSettings();
    trackRecentTabs();
    loadRecentTabs();
    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (changes.savedTabGroups) {
        loadTabs(); // Reload tabs when storage changes
      }
      if (changes.settings) {
        loadSettings(); // Reload settings when they change
      }
    });

    return () => {
      chrome.storage.onChanged.removeListener(loadTabs);
      chrome.tabs.onActivated.removeListener(trackRecentTabs);
    };
  }, []);
  const loadSettings = async () => {
    const stored = await chrome.storage.local.get("settings");
    if (stored.settings) {
      setSettings(stored.settings);
      setSyncEnabled(stored.settings.syncEnabled);
    }
  };
  const saveSettings = async (newSettings) => {
    await chrome.storage.local.set({ settings: newSettings });
    setSettings(newSettings);
  };
  const trackRecentTabs = () => {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      setRecentTabs((prev) => {
        const updated = [tab, ...prev.filter((t) => t.id !== tab.id)].slice(
          0,
          10
        );
        chrome.storage.local.set({ recentTabs: updated });
        return updated;
      });
    });
  };
  const loadRecentTabs = async () => {
    const { recentTabs: savedRecentTabs } = await chrome.storage.local.get(
      "recentTabs"
    );
    if (savedRecentTabs) {
      setRecentTabs(savedRecentTabs);
    }
  };
  const exportTabs = async () => {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "EXPORT_TABS" }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (!response.success) {
        throw new Error(response.error || "Export failed");
      }

      // Create and download the export file
      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tab-manager-export-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      showNotification("Tabs exported successfully");
    } catch (error) {
      console.error("Error exporting tabs:", error);
      showNotification("Error exporting tabs", "error");
    }
  };

  const importTabs = async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) {
        showNotification("No file selected", "error");
        return;
      }

      const text = await file.text();
      const importedData = JSON.parse(text);

      // Validate the imported data
      if (!importedData || !importedData.urls || !importedData.tabGroups) {
        showNotification("Invalid import file format", "error");
        return;
      }

      // Send to background script for processing
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: "IMPORT_TABS",
            data: importedData,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          }
        );
      });

      if (response.success) {
        showNotification("Tabs imported successfully");
        await loadTabs(); // Reload the tab list
      } else {
        throw new Error(response.error || "Import failed");
      }
    } catch (error) {
      console.error("Error importing tabs:", error);
      showNotification(`Error importing tabs: ${error.message}`, "error");
    } finally {
      // Reset the file input
      event.target.value = "";
    }
  };

  const loadTabs = async () => {
    try {
      setLoading(true);
      const { savedTabGroups } = await chrome.storage.local.get(
        "savedTabGroups"
      );
      if (savedTabGroups) {
        setGroups(savedTabGroups);
      }

      // Get current tabs
      const allTabs = await chrome.tabs.query({});
      setTabs(allTabs);
    } catch (error) {
      console.error("Error loading tabs:", error);
      showNotification("Error loading tabs", "error");
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (message, type = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const switchToTab = async (tabId, windowId) => {
    try {
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(windowId, { focused: true });
      showNotification("Tab activated");
    } catch (error) {
      showNotification("Error switching tab", "error");
    }
  };

  const TabItem = ({ tab }) => (
    <div
      className="flex items-center p-2 hover:bg-gray-100 rounded-lg group cursor-pointer"
      onClick={() => switchToTab(tab.id, tab.windowId)}
    >
      <img
        src={`chrome://favicon/size/16@2x/${tab.url}`}
        className="w-4 h-4 mr-2"
        alt=""
      />
      <span className="flex-1 truncate text-sm">{tab.title}</span>
      {/* <div className="opacity-0 group-hover:opacity-100 flex gap-2">
        <button className="p-1 hover:bg-blue-100 rounded">
          <Bookmark className="w-4 h-4 text-blue-600" />
        </button>
      </div> */}
    </div>
  );
  const RecentView = () => (
    <div className={`space-y-2 ${settings.darkMode ? "hover:text-black" : ""}`}>
      {recentTabs.length === 0 ? (
        <div className="text-center text-gray-500 py-4">
          No recent tabs available
        </div>
      ) : (
        recentTabs.map((tab) => <TabItem key={tab.id} tab={tab} />)
      )}
    </div>
  );
  const GroupView = () => (
    <div className="space-y-4">
      {Object.entries(groups).map(([domain, tabIds]) => (
        <div key={domain} className="border rounded-lg p-2">
          <h3 className="font-medium mb-2 flex items-center">
            <Layers className="w-4 h-4 mr-2" />
            {domain}
          </h3>
          <div
            className={`space-y-1 ${
              settings.darkMode ? "hover:text-black" : ""
            }`}
          >
            {tabs
              .filter((tab) => tabIds.includes(tab.id))
              .map((tab) => (
                <TabItem key={tab.id} tab={tab} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
  const clearRecentTabs = async () => {
    await chrome.storage.local.set({ recentTabs: [] });
    setRecentTabs([]);
    showNotification("Recent tabs cleared", "info");
  };
  const SettingsPanel = () => (
    <div className="border rounded-lg p-4 mb-4">
      <h3 className="font-medium mb-3 flex items-center">
        <Settings className="w-4 h-4 mr-2" />
        Settings
      </h3>
      <div className="space-y-3">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={settings.darkMode}
            onChange={(e) =>
              saveSettings({ ...settings, darkMode: e.target.checked })
            }
            className="mr-2"
          />
          Dark Mode
        </label>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={settings.autoGroup}
            onChange={(e) =>
              saveSettings({ ...settings, autoGroup: e.target.checked })
            }
            className="mr-2"
          />
          Auto-group by domain
        </label>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={settings.syncEnabled}
            onChange={(e) =>
              saveSettings({ ...settings, syncEnabled: e.target.checked })
            }
            className="mr-2"
          />
          Enable cross-device sync
        </label>
      </div>
    </div>
  );

  const SearchView = () => {
    const filteredTabs = tabs.filter(
      (tab) =>
        tab.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tab.url.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div
        className={`space-y-1 ${settings.darkMode ? "hover:text-black" : ""}`}
      >
        {filteredTabs.map((tab) => (
          <TabItem key={tab.id} tab={tab} />
        ))}
      </div>
    );
  };

  return (
    <div
      className={`w-96 p-4 max-h-[600px] overflow-hidden flex flex-col ${
        settings.darkMode ? "dark bg-gray-800 text-white" : ""
      }`}
    >
      <SettingsPanel />
      {/* Header */}
      <div className="mb-4">
        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
          <input
            type="text"
            placeholder="Search tabs..."
            className={`w-full pl-10 pr-4 py-2 border rounded-lg ${
              settings.darkMode ? "text-black" : ""
            }`}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setActiveView("search");
            }}
          />
        </div>
        <div className="flex gap-2 mb-4">
          <button
            onClick={exportTabs}
            className={`flex items-center px-3 py-1 rounded hover:bg-gray-100 ${
              settings.darkMode ? "hover:text-black" : ""
            }`}
          >
            <Download className="w-4 h-4 mr-1" />
            Export
          </button>
          <label
            className={`flex items-center px-3 py-1 rounded hover:bg-gray-100 cursor-pointer ${
              settings.darkMode ? "hover:text-black" : ""
            }`}
          >
            <Share2 className="w-4 h-4 mr-1" />
            Import
            <input
              type="file"
              accept=".json"
              onChange={importTabs}
              className="hidden"
              disabled={loading}
            />
          </label>
          {loading && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
          )}
          <button
            onClick={clearRecentTabs}
            className={`flex items-center px-3 py-1 rounded hover:bg-gray-100 ${
              settings.darkMode ? "hover:text-black" : ""
            }`}
          >
            Clear Recent Tabs
          </button>
        </div>
        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView("groups")}
            className={`flex items-center px-3 py-1 rounded ${
              activeView === "groups"
                ? "bg-blue-100 text-blue-600"
                : "hover:bg-gray-100"
            } ${settings.darkMode ? "hover:text-black" : ""} `}
          >
            <Layers className="w-4 h-4 mr-1" />
            Groups
          </button>
          <button
            onClick={() => setActiveView("recent")}
            className={`flex items-center px-3 py-1 rounded ${
              activeView === "recent"
                ? "bg-blue-100 text-blue-600"
                : "hover:bg-gray-100"
            } ${settings.darkMode ? "hover:text-black" : ""}`}
          >
            <Clock className="w-4 h-4 mr-1" />
            Recent
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            {activeView === "groups" && <GroupView />}
            {activeView === "search" && <SearchView />}
            {activeView === "recent" && <RecentView />}{" "}
            {/* Use the RecentView */}
          </>
        )}
      </div>
      {/* Notification */}
      {notification && (
        <div
          className={`fixed bottom-4 right-4 p-3 rounded-lg shadow-lg flex items-center ${
            notification.type === "error"
              ? "bg-red-100 text-red-600"
              : "bg-blue-100 text-blue-600"
          }`}
        >
          {notification.type === "error" ? (
            <AlertCircle className="w-4 h-4 mr-2" />
          ) : (
            <Bookmark className="w-4 h-4 mr-2" />
          )}
          {notification.message}
        </div>
      )}
      {/* Sync status indicator */}
      {settings.syncEnabled && (
        <div className="fixed bottom-4 left-4 flex items-center text-sm text-gray-500">
          <Cloud className="w-4 h-4 mr-1" />
          Synced
        </div>
      )}
    </div>
  );
};

export default TabManagerPro;
