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

  const exportTabs = () => {
    const data = {
      tabs,
      groups,
      timestamp: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tab-manager-export.json";
    a.click();
    URL.revokeObjectURL(url);
    showNotification("Tabs exported successfully");
  };
  const importTabs = async (event) => {
    try {
      const file = event.target.files[0];
      const text = await file.text();
      const data = JSON.parse(text);
      setGroups(data.groups);
      await chrome.storage.local.set({ tabGroups: data.groups });
      showNotification("Tabs imported successfully");
    } catch (error) {
      showNotification("Error importing tabs", "error");
    }
  };
  const loadTabs = async () => {
    try {
      setLoading(true);
      const allTabs = await chrome.tabs.query({});
      const { tabGroups = {} } = await chrome.storage.local.get("tabGroups");
      setTabs(allTabs);
      setGroups(tabGroups);
    } catch (error) {
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
    <div className="flex items-center p-2 hover:bg-gray-100 rounded-lg group">
      <img
        src={`chrome://favicon/size/16@2x/${tab.url}`}
        className="w-4 h-4 mr-2"
        alt=""
      />
      <span className="flex-1 truncate text-sm">{tab.title}</span>
      <div className="opacity-0 group-hover:opacity-100 flex gap-2">
        <button
          onClick={() => switchToTab(tab.id, tab.windowId)}
          className="p-1 hover:bg-blue-100 rounded"
        >
          <Bookmark className="w-4 h-4 text-blue-600" />
        </button>
      </div>
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
          <div className="space-y-1">
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
      <div className="space-y-1">
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
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
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
            className="flex items-center px-3 py-1 rounded hover:bg-gray-100"
          >
            <Download className="w-4 h-4 mr-1" />
            Export
          </button>
          <label className="flex items-center px-3 py-1 rounded hover:bg-gray-100 cursor-pointer">
            <Share2 className="w-4 h-4 mr-1" />
            Import
            <input
              type="file"
              accept=".json"
              onChange={importTabs}
              className="hidden"
            />
          </label>
        </div>
        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView("groups")}
            className={`flex items-center px-3 py-1 rounded ${
              activeView === "groups"
                ? "bg-blue-100 text-blue-600"
                : "hover:bg-gray-100"
            }`}
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
            }`}
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
            {activeView === "recent" && (
              <div className="text-center text-gray-500 py-8">
                Recent tabs feature coming soon!
              </div>
            )}
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
