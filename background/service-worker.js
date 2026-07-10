/**
 * service-worker.js - 后台服务工作线程
 * 主要负责消息中转和插件生命周期管理
 */

// 插件安装/更新时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[HTML-to-Excel] 插件已安装/更新', details.reason);

  // 设置默认存储
  chrome.storage.local.get(['settings'], (result) => {
    if (!result.settings) {
      chrome.storage.local.set({
        settings: {
          autoDetect: true,
          includeNested: true,
          maxRows: 10000,
        },
      });
    }
  });
});

// 处理来自popup或其他地方的长时间运行操作
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 目前主要功能都在content script中完成
  return false;
});

// 点击插件图标时的默认行为
chrome.action.onClicked.addListener((tab) => {
  // popup.html已配置在manifest中，会自动弹出
  // 这里无需额外处理
  console.log('[HTML-to-Excel] 用户点击了插件图标');
});
