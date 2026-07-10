/**
 * popup.js - 弹出窗口逻辑
 * 负责与content script通信，触发捕获模式和可见内容导出。
 */

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const btnCapture = document.getElementById('btn-capture');
const btnImageCapture = document.getElementById('btn-image-capture');

function setStatus(message, type) {
  statusText.textContent = message;
  statusEl.className = 'status';
  if (type) {
    statusEl.classList.add(type);
  }
}

async function sendToContentScript(action) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      setStatus('无法获取当前标签页', 'error');
      return null;
    }

    if (!isInjectablePage(tab.url)) {
      setStatus('此页面不支持插件操作', 'error');
      return null;
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, { action });
    } catch (err) {
      if (!isMissingContentScriptError(err)) {
        throw err;
      }

      await injectContentScript(tab.id);
      return await chrome.tabs.sendMessage(tab.id, { action });
    }
  } catch (err) {
    console.error('发送消息失败', err);
    setStatus('操作失败，请刷新页面后重试', 'error');
    return null;
  }
}

function isInjectablePage(url) {
  if (!url) return false;
  return !/^(chrome|chrome-extension|edge|about|devtools):\/\//i.test(url);
}

function isMissingContentScriptError(err) {
  const message = err && err.message ? err.message : String(err || '');
  return message.includes('Receiving end does not exist')
    || message.includes('Could not establish connection')
    || message.includes('The message port closed before a response was received');
}

async function injectContentScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content/content.css'],
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['libs/xlsx.full.min.js'],
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/content.js'],
  });
}

btnCapture.addEventListener('click', async () => {
  setStatus('正在进入捕获模式...', '');
  btnCapture.disabled = true;

  const response = await sendToContentScript('startCapture');

  if (response && response.success) {
    setStatus('捕获模式已开启，点击表格或页面元素', 'success');
  } else {
    setStatus('开启失败，请刷新页面后重试', 'error');
  }

  setTimeout(() => {
    btnCapture.disabled = false;
  }, 1500);
});

btnImageCapture.addEventListener('click', async () => {
  setStatus('请在页面上拖选要导出的可见区域...', '');
  btnImageCapture.disabled = true;

  const response = await sendToContentScript('startImageCapture');

  if (response && response.success) {
    setStatus('拖选区域后会显示预览，确认后导出', 'success');
  } else {
    setStatus('可见内容导出失败，请刷新页面后重试', 'error');
  }

  setTimeout(() => {
    btnImageCapture.disabled = false;
  }, 1500);
});