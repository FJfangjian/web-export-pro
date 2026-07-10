/**
 * content.js - 内容脚本
 * 核心功能：表格捕获、数据提取、Excel导出
 */
(function () {
  'use strict';

  // 防止重复注入
  if (window.__hteInjected) return;
  window.__hteInjected = true;

  // ==================== 状态管理 ====================
  let captureMode = false;
  let selectedTable = null;
  let tableHighlights = []; // { table, badge }
  let imageCaptureMode = false;
  let imageCropOverlay = null;
  let imageCropBox = null;
  let imageCropStart = null;

  // ==================== 消息监听 ====================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'startCapture':
        enterCaptureMode();
        sendResponse({ success: true });
        break;
      case 'stopCapture':
        exitCaptureMode();
        sendResponse({ success: true });
        break;
      case 'startImageCapture':
        startImageCapture();
        sendResponse({ success: true });
        break;
    }
    return true; // 保持通道开启
  });

  // ==================== 捕获模式 ====================
  function enterCaptureMode() {
    if (captureMode) return;
    captureMode = true;

    const elements = getCapturableElements();
    if (elements.length === 0) {
      showToast('当前页面没有可捕获的内容');
      captureMode = false;
      return;
    }

    elements.forEach((element, idx) => {
      element.classList.add('hte-capturable');
      element.setAttribute('data-hte-info', getElementCaptureInfo(element));
      element.setAttribute('data-hte-index', idx);
    });

    document.body.classList.add('hte-capture-mode');

    // 全局事件监听（捕获阶段，优先处理）
    document.addEventListener('click', onTableClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', updateHighlightsOnScroll, true);

    showToast(`发现 ${elements.length} 个可捕获内容，点击表格导出数据，点击其他内容导出可见内容`);
  }

  function exitCaptureMode() {
    if (!captureMode) return;
    captureMode = false;

    // 恢复所有可捕获元素
    document.querySelectorAll('.hte-capturable').forEach(element => {
      element.classList.remove('hte-capturable');
      element.removeAttribute('data-hte-info');
      element.removeAttribute('data-hte-index');
    });

    document.body.classList.remove('hte-capture-mode');

    document.removeEventListener('click', onTableClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', updateHighlightsOnScroll, true);

    hideExportPanel();
    selectedTable = null;
  }

  function onTableClick(e) {
    if (!captureMode) return;
    const element = e.target.closest('.hte-capturable');
    if (!element) return;

    e.preventDefault();
    e.stopPropagation();

    if (element.tagName.toLowerCase() === 'table') {
      showExportPanel(element);
      return;
    }

    exportElementAsData(element);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      exitCaptureMode();
    }
  }

  function updateHighlightsOnScroll() {
    // 滚动时badge需要重新定位（它们使用absolute定位相对于table）
    // CSS已经处理了：badge使用position: absolute，相对于table定位
    // 不需要额外处理
  }

  function getCapturableElements() {
    const selector = [
      'table',
      'img',
      'canvas',
      'svg',
      'article',
      'section',
      'main',
      '[role="table"]',
      '[role="grid"]',
      '[role="list"]',
      'ul',
      'ol',
      '.table',
      '.grid',
      '.list',
      '.card',
      '.panel',
      '.content',
      '.container',
      'div[class]',
    ].join(',');

    return Array.from(document.querySelectorAll(selector))
      .filter(isUsefulCapturableElement)
      .sort((a, b) => {
        const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
        const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
        return areaA - areaB;
      })
      .slice(0, 800);
  }

  function isUsefulCapturableElement(element) {
    if (!element || element === document.body || element === document.documentElement) return false;
    if (element.closest('#hte-panel, #hte-overlay, #hte-toast, .hte-image-crop-overlay')) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 24) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;

    const tagName = element.tagName.toLowerCase();
    if (['script', 'style', 'link', 'meta', 'noscript', 'br'].includes(tagName)) return false;
    if (['table', 'img', 'canvas', 'svg', 'article', 'section', 'main', 'ul', 'ol'].includes(tagName)) return true;

    const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length >= 8 || element.querySelector('img, canvas, svg, table');
  }

  function getElementCaptureInfo(element) {
    if (element.tagName.toLowerCase() === 'table') {
      const rows = element.rows.length;
      const cols = element.rows[0] ? element.rows[0].cells.length : 0;
      return `${rows}行 × ${cols}列`;
    }

    const rect = element.getBoundingClientRect();
    return `${Math.round(rect.width)} × ${Math.round(rect.height)} 结构`;
  }

  function getElementExportName(element) {
    const title = element.getAttribute('aria-label')
      || element.getAttribute('alt')
      || element.getAttribute('title')
      || (element.id ? element.id : '')
      || ((element.querySelector('h1, h2, h3, h4, h5, h6') || {}).textContent || '')
      || document.title
      || '网页内容';

    return sanitizeFileName(title.replace(/\s+/g, ' ').trim()).substring(0, 80) || '网页内容';
  }

  function exportElementAsData(element) {
    const name = getElementExportName(element);
    const rows = extractElementStructure(element, { rootName: name });

    if (rows.length === 0) {
      showToast('该元素没有可导出的结构化信息');
      return;
    }

    exitCaptureMode();
    showVisibleContentPreview(`${name}-可见内容`, rows, [buildElementSummary(element, name)]);
  }

  function exportRegionAsData(rect) {
    const elements = getElementsInRect(rect);
    if (elements.length === 0) {
      showToast('选区内没有可导出的可见内容');
      return;
    }

    const pageName = sanitizeFileName(document.title || '网页区域').substring(0, 80) || '网页区域';
    const rows = extractElementStructure(elements, { rootName: '选区', rootIndex: 1 });
    if (rows.length === 0) {
      showToast('选区内没有可导出的可见内容');
      return;
    }

    const summary = [[
      '选区',
      'region',
      '',
      '',
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height),
      `可见内容 ${rows.length} 条`,
    ]];

    showVisibleContentPreview(`${pageName}-可见内容`, rows, summary);
  }

  function getElementsInRect(rect) {
    const all = Array.from(document.querySelectorAll('body *'));
    return all.filter(element => {
      if (!isVisibleForExport(element)) return false;
      const elementRect = element.getBoundingClientRect();
      return isRectIntersecting(rect, elementRect) && getRectOverlapRatio(rect, elementRect) > 0.15;
    }).slice(0, 2000);
  }

  function isRectIntersecting(a, b) {
    return a.left < b.right && a.left + a.width > b.left && a.top < b.bottom && a.top + a.height > b.top;
  }

  function getRectOverlapRatio(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.left + a.width, b.right);
    const bottom = Math.min(a.top + a.height, b.bottom);
    const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
    const area = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
    return overlap / area;
  }

  function extractElementStructure(root, options = {}) {
    const rootName = options.rootName || getElementExportName(root);
    const rootIndex = options.rootIndex || 1;
    const elements = root instanceof Element
      ? [root, ...Array.from(root.querySelectorAll('*'))]
      : Array.from(root || []);

    const rows = elements
      .filter(isVisibleForExport)
      .map(element => buildVisibleContentRow(element, rootName, rootIndex))
      .filter(Boolean);

    return dedupeVisibleRows(rows)
      .sort((a, b) => (a[11] - b[11]) || (a[10] - b[10]) || (a[0] - b[0]))
      .slice(0, 2000)
      .map((row, index) => {
        row[0] = index + 1;
        return row;
      });
  }

  function buildVisibleContentRow(element, rootName, rootIndex) {
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'link', 'meta', 'noscript', 'br', 'path', 'defs', 'use'].includes(tag)) return null;
    if (tag === 'svg' && !getVisibleText(element)) return null;
    if (element.closest('a, button') && !['a', 'button', 'img', 'input'].includes(tag)) return null;

    const type = getVisibleContentType(element);
    const text = getVisibleText(element);
    const href = tag === 'a' ? element.href : '';
    const src = ['img', 'video', 'audio', 'source', 'iframe'].includes(tag) ? (element.currentSrc || element.src || '') : '';
    const value = getElementValue(element);
    const alt = element.getAttribute('alt') || '';
    const title = element.getAttribute('title') || '';

    if (!type || (!text && !href && !src && !value && !alt && !title)) return null;
    if (isPureContainer(element, text, href, src, value)) return null;

    const rect = element.getBoundingClientRect();
    return [
      0,
      getVisualGroup(element),
      type,
      tag,
      text,
      href,
      src,
      value,
      alt,
      title,
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height),
      element.id || '',
      getClassName(element),
      getElementStep(element),
    ];
  }

  function getVisualGroup(element) {
    const nav = element.closest('nav, header, [role="navigation"], .nav, .navbar, .menu, .bili-header');
    if (nav) return '导航菜单';

    const listItem = element.closest('li, [role="listitem"]');
    if (listItem) {
      const text = truncateCell((listItem.innerText || listItem.textContent || '').replace(/\s+/g, ' ').trim(), 30);
      return text ? `列表项：${text}` : '列表项';
    }

    const card = element.closest('article, .card, .item, .panel, .feed-card, .video-card, .bili-video-card, [class*="card"], [class*="item"]');
    if (card) {
      const heading = card.querySelector('h1, h2, h3, h4, h5, h6, a');
      const text = heading ? truncateCell((heading.innerText || heading.textContent || '').replace(/\s+/g, ' ').trim(), 30) : '';
      return text ? `卡片：${text}` : '卡片';
    }

    const media = element.closest('figure, picture, .media, [class*="image"], [class*="cover"]');
    if (media) return '图片内容';

    const section = element.closest('section, main, aside, footer');
    if (section) return section.tagName.toLowerCase() === 'footer' ? '页脚' : '内容区块';

    return '页面内容';
  }
  function getVisibleContentType(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') return '链接';
    if (tag === 'button') return '按钮';
    if (tag === 'img') return '图片';
    if (['input', 'textarea', 'select'].includes(tag)) return '表单';
    if (/^h[1-6]$/.test(tag)) return '标题';
    if (['li', 'dt', 'dd'].includes(tag)) return '列表项';
    if (['p', 'span', 'strong', 'em', 'label', 'td', 'th'].includes(tag)) return '文本';
    if (['canvas', 'video', 'audio', 'iframe'].includes(tag)) return '媒体';
    if (getDirectVisibleText(element)) return '文本';
    return '';
  }

  function isPureContainer(element, text, href, src, value) {
    const tag = element.tagName.toLowerCase();
    if (href || src || value || ['img', 'input', 'textarea', 'select', 'canvas', 'video', 'audio', 'iframe'].includes(tag)) return false;
    if (getDirectVisibleText(element)) return false;
    if (/^h[1-6]$/.test(tag)) return false;
    return element.children.length > 0 && !!text;
  }

  function getVisibleText(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'input') return element.placeholder || element.value || element.getAttribute('value') || '';
    if (tag === 'textarea' || tag === 'select') return element.value || '';
    if (tag === 'img') return element.getAttribute('alt') || element.getAttribute('title') || '';
    if (['a', 'button', 'li', 'td', 'th'].includes(tag) || /^h[1-6]$/.test(tag)) {
      return truncateCell((element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(), 1000);
    }
    return truncateCell(getDirectVisibleText(element), 1000);
  }

  function getDirectVisibleText(element) {
    return Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
  }

  function dedupeVisibleRows(rows) {
    const seen = new Set();
    const sorted = rows.sort((a, b) => getRowPriority(a) - getRowPriority(b));
    return sorted.filter(row => {
      const key = [row[2], row[4], row[5], row[6], row[7], row[10], row[11]].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function getRowPriority(row) {
    const type = row[2];
    if (type === '链接' || type === '按钮') return 1;
    if (type === '表单') return 2;
    if (type === '图片' || type === '媒体') return 3;
    return 4;
  }

  function isVisibleForExport(element) {
    if (!element || element.closest('#hte-panel, #hte-overlay, #hte-toast, .hte-image-crop-overlay')) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (style.pointerEvents === 'none' && !(element.innerText || element.textContent || '').trim()) return false;
    return true;
  }

  function getElementStep(element) {
    const tag = element.tagName.toLowerCase();
    if (element.id) return `${tag}#${element.id}`;
    const className = getClassName(element).split(' ').filter(Boolean).slice(0, 2).join('.');
    const classPart = className ? `.${className}` : '';
    const sameTagIndex = Array.from(element.parentElement ? element.parentElement.children : [])
      .filter(child => child.tagName === element.tagName)
      .indexOf(element) + 1;
    return `${tag}${classPart}:nth-of-type(${sameTagIndex || 1})`;
  }

  function getClassName(element) {
    return typeof element.className === 'string' ? element.className.trim().replace(/\s+/g, ' ') : '';
  }

  function getElementValue(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'input') {
      if (['checkbox', 'radio'].includes(element.type)) return element.checked ? 'checked' : 'unchecked';
      return element.value || element.getAttribute('value') || '';
    }
    if (tag === 'textarea' || tag === 'select') return element.value || '';
    return '';
  }

  function buildElementSummary(element, name) {
    const rect = element.getBoundingClientRect();
    return [
      name,
      element.tagName.toLowerCase(),
      element.id || '',
      getClassName(element),
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height),
      truncateCell((element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(), 500),
    ];
  }

  const VISIBLE_CONTENT_COLUMNS = [
    { key: 'index', label: '序号', tech: false, width: 8 },
    { key: 'group', label: '分组', tech: false, width: 24 },
    { key: 'type', label: '类型', tech: false, width: 10 },
    { key: 'tag', label: '标签', tech: true, width: 10 },
    { key: 'text', label: '可见文本', tech: false, width: 42 },
    { key: 'href', label: '链接', tech: false, width: 44 },
    { key: 'src', label: '资源地址', tech: false, width: 44 },
    { key: 'value', label: '表单值', tech: false, width: 20 },
    { key: 'alt', label: 'Alt', tech: true, width: 24 },
    { key: 'title', label: 'Title', tech: true, width: 24 },
    { key: 'x', label: 'X', tech: true, width: 8 },
    { key: 'y', label: 'Y', tech: true, width: 8 },
    { key: 'width', label: '宽', tech: true, width: 8 },
    { key: 'height', label: '高', tech: true, width: 8 },
    { key: 'id', label: 'ID', tech: true, width: 18 },
    { key: 'className', label: 'Class', tech: true, width: 24 },
    { key: 'path', label: '定位路径', tech: true, width: 42 },
  ];

  function showVisibleContentPreview(name, rows, summaryRows) {
    hideExportPanel();

    const overlay = document.createElement('div');
    overlay.className = 'hte-overlay';
    overlay.id = 'hte-overlay';
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.className = 'hte-panel hte-data-preview-panel';
    panel.id = 'hte-panel';

    const visualTable = buildVisualTable(rows);
    const previewRows = rows.slice(0, 20);
    const previewHtml = hasVisualTable(visualTable) ? buildVisualTablePreview(visualTable) : buildVisiblePreviewTable(previewRows);
    panel.innerHTML = `
      <div class="hte-panel-header">
        <h3>预览：${escHtml(name)}</h3>
        <button class="hte-panel-close" title="关闭">✕</button>
      </div>
      <div class="hte-panel-body">
        <div class="hte-panel-stats">
          <span class="hte-stat"><strong>${rows.length}</strong> 条可见内容</span>
          <span class="hte-stat"><strong>${hasVisualTable(visualTable) ? visualTable.length - 1 : Math.min(rows.length, 20)}</strong> 行预览</span>
        </div>
        <div class="hte-export-options">
          <label class="hte-option-check"><input type="checkbox" id="hte-include-tech"> 包含技术字段</label>
          <label class="hte-option-select">导出格式
            <select id="hte-export-format">
              <option value="xlsx">.xlsx Excel</option>
              <option value="csv">.csv 文本</option>
              <option value="doc">.doc Word</option>
              <option value="pdf">PDF 文档</option>
              <option value="json">.json 数据</option>
            </select>
          </label>
        </div>
        <div class="hte-preview-wrap hte-visible-preview-wrap">${previewHtml}</div>
        ${hasVisualTable(visualTable) ? `<p class="hte-preview-note">已按页面视觉位置重建表格；导出会同时保留可见内容明细。</p>` : (rows.length > 20 ? `<p class="hte-preview-note">仅预览前 20 条，导出会包含全部 ${rows.length} 条。</p>` : '')}
      </div>
      <div class="hte-panel-footer">
        <button class="hte-btn hte-btn-cancel">取消</button>
        <button class="hte-btn hte-btn-export">导出</button>
      </div>
    `;
    document.body.appendChild(panel);

    const closePanel = () => hideExportPanel();
    panel.querySelector('.hte-btn-export').addEventListener('click', () => {
      const includeTech = panel.querySelector('#hte-include-tech').checked;
      const format = panel.querySelector('#hte-export-format').value;
      exportVisibleContent(name, rows, summaryRows, { includeTech, format });
      hideExportPanel();
      showToast(`已导出 ${rows.length} 条可见内容`);
    });
    panel.querySelector('.hte-btn-cancel').addEventListener('click', closePanel);
    panel.querySelector('.hte-panel-close').addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);

    requestAnimationFrame(() => {
      overlay.classList.add('hte-visible');
      panel.classList.add('hte-visible');
    });
  }

  function buildVisiblePreviewTable(rows) {
    const previewColumns = [
      { index: 0, label: '序号' },
      { index: 1, label: '分组' },
      { index: 2, label: '类型' },
      { index: 4, label: '文本' },
      { index: 5, label: '链接' },
      { index: 6, label: '资源地址' },
    ];
    const head = previewColumns.map(col => `<th>${escHtml(col.label)}</th>`).join('');
    const body = rows.map(row => {
      return `<tr>${previewColumns.map(col => `<td>${escHtml(truncateCell(row[col.index] || '', 120))}</td>`).join('')}</tr>`;
    }).join('');
    return `<table class="hte-preview-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function buildVisualTablePreview(table) {
    const preview = table.slice(0, 21);
    const head = (preview[0] || []).map(cell => `<th>${escHtml(truncateCell(cell, 80))}</th>`).join('');
    const body = preview.slice(1).map(row => {
      return `<tr>${row.map(cell => `<td>${escHtml(truncateCell(cell, 120))}</td>`).join('')}</tr>`;
    }).join('');
    return `<table class="hte-preview-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function buildVisualTable(rows) {
    const items = rows
      .map(row => ({
        row,
        value: getVisualCellValue(row),
        type: row[2],
        tag: row[3],
        x: Number(row[10]) || 0,
        y: Number(row[11]) || 0,
        width: Number(row[12]) || 0,
        height: Number(row[13]) || 0,
      }))
      .filter(item => item.value && item.width > 0 && item.height > 0)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));

    if (items.length < 3) return [];

    const columns = clusterVisualColumns(items);
    if (columns.length < 2) return [];

    const imageAnchors = items
      .filter(item => item.type === '图片' && item.row[6])
      .sort((a, b) => a.y - b.y);
    const headerItems = imageAnchors.length ? items.filter(item => item.y + item.height <= imageAnchors[0].y + 8) : [];
    const rowBands = imageAnchors.length >= 2 ? buildImageRowBands(imageAnchors, items) : buildTextRowBands(items);
    const hasHeader = headerItems.filter(item => getNearestColumnIndex(columns, item) >= 0).length >= 2;

    const table = [];
    const header = columns.map((column, index) => hasHeader ? collectBandColumnValue(headerItems, columns, index) || `列${index + 1}` : `列${index + 1}`);
    table.push(header);

    rowBands.forEach(band => {
      const rowItems = items.filter(item => {
        if (hasHeader && headerItems.includes(item)) return false;
        const centerY = item.y + item.height / 2;
        return centerY >= band.top && centerY < band.bottom;
      });
      const line = columns.map((column, index) => collectBandColumnValue(rowItems, columns, index));
      if (line.some(Boolean)) table.push(line);
    });

    return table.length > 1 ? table : [];
  }

  function hasVisualTable(table) {
    return Array.isArray(table) && table.length > 1 && table[0] && table[0].length > 1;
  }

  function getVisualCellValue(row) {
    if (row[2] === '图片' && row[6]) return row[6];
    return row[4] || row[7] || row[5] || row[6] || row[8] || row[9] || '';
  }

  function clusterVisualColumns(items) {
    const sorted = items.slice().sort((a, b) => getCenterX(a) - getCenterX(b));
    const groups = [];
    sorted.forEach(item => {
      const center = getCenterX(item);
      let group = groups.find(candidate => Math.abs(candidate.center - center) <= Math.max(48, Math.min(120, item.width * 0.65)));
      if (!group) {
        group = { center, items: [] };
        groups.push(group);
      }
      group.items.push(item);
      group.center = group.items.reduce((sum, current) => sum + getCenterX(current), 0) / group.items.length;
    });

    return groups
      .filter(group => group.items.length >= 1)
      .sort((a, b) => a.center - b.center)
      .slice(0, 12);
  }

  function buildImageRowBands(imageAnchors, items) {
    const anchors = imageAnchors.map(item => ({ top: item.y, center: item.y + item.height / 2, bottom: item.y + item.height })).sort((a, b) => a.center - b.center);
    return anchors.map((anchor, index) => {
      const prev = anchors[index - 1];
      const next = anchors[index + 1];
      return {
        top: prev ? (prev.center + anchor.center) / 2 : Math.max(0, Math.min(anchor.top, ...items.map(item => item.y)) - 8),
        bottom: next ? (anchor.center + next.center) / 2 : Math.max(anchor.bottom + 8, Math.max(...items.map(item => item.y + item.height)) + 8),
      };
    });
  }

  function buildTextRowBands(items) {
    const sorted = items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const bands = [];
    sorted.forEach(item => {
      const center = item.y + item.height / 2;
      let band = bands.find(candidate => center >= candidate.top - 12 && center <= candidate.bottom + 12);
      if (!band) {
        band = { top: item.y, bottom: item.y + Math.max(item.height, 24), centers: [] };
        bands.push(band);
      }
      band.centers.push(center);
      band.top = Math.min(band.top, item.y);
      band.bottom = Math.max(band.bottom, item.y + item.height);
    });
    return bands.sort((a, b) => a.top - b.top);
  }

  function collectBandColumnValue(items, columns, columnIndex) {
    const values = [];
    items
      .filter(item => getNearestColumnIndex(columns, item) === columnIndex)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .forEach(item => {
        const value = truncateCell(getVisualCellValue(item.row), 300);
        if (value && !values.includes(value)) values.push(value);
      });
    return values.join('\n');
  }

  function getNearestColumnIndex(columns, item) {
    const center = getCenterX(item);
    let bestIndex = -1;
    let bestDistance = Infinity;
    columns.forEach((column, index) => {
      const distance = Math.abs(column.center - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestDistance <= 180 ? bestIndex : -1;
  }

  function getCenterX(item) {
    return item.x + item.width / 2;
  }

  function exportVisibleContent(name, rows, summaryRows, options) {
    const includeTech = !!options.includeTech;
    const format = options.format || 'xlsx';
    const columns = VISIBLE_CONTENT_COLUMNS.filter(column => includeTech || !column.tech);
    const header = columns.map(column => column.label);
    const data = rows.map(row => columns.map(column => row[getVisibleColumnIndex(column.key)] || ''));
    const visualTable = buildVisualTable(rows);
    const filename = sanitizeFileName(name);

    if (format === 'csv') {
      const csvRows = hasVisualTable(visualTable) ? visualTable : [header, ...data];
      downloadTextFile(`${filename}.csv`, toCsv(csvRows), 'text/csv;charset=utf-8');
      return;
    }

    if (format === 'json') {
      const payload = {
        name,
        exportedAt: new Date().toISOString(),
        includeTech,
        count: rows.length,
        visualTable: hasVisualTable(visualTable) ? visualTable : [],
        rows: rows.map(row => rowToObject(row, includeTech)),
      };
      downloadTextFile(`${filename}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
      return;
    }

    if (format === 'doc') {
      const docData = hasVisualTable(visualTable) ? visualTable : [header, ...data];
      exportTableAsWord(filename, docData);
      return;
    }

    if (format === 'pdf') {
      const pdfData = hasVisualTable(visualTable) ? visualTable : [header, ...data];
      exportTableAsPDF(filename, pdfData);
      return;
    }

    // xlsx 默认
    const wb = XLSX.utils.book_new();
    if (hasVisualTable(visualTable)) {
      const visualSheet = XLSX.utils.aoa_to_sheet(visualTable);
      visualSheet['!cols'] = visualTable[0].map(() => ({ wch: 28 }));
      XLSX.utils.book_append_sheet(wb, visualSheet, '视觉表格');
    }

    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws['!cols'] = columns.map(column => ({ wch: column.width }));
    XLSX.utils.book_append_sheet(wb, ws, hasVisualTable(visualTable) ? '可见明细' : '可见内容');

    const summaryHeader = ['名称', '标签', 'ID', 'Class', 'X', 'Y', '宽', '高', '文本预览'];
    const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
    summarySheet['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 18 }, { wch: 24 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, '摘要');
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }

  function getVisibleColumnIndex(key) {
    return {
      index: 0,
      group: 1,
      type: 2,
      tag: 3,
      text: 4,
      href: 5,
      src: 6,
      value: 7,
      alt: 8,
      title: 9,
      x: 10,
      y: 11,
      width: 12,
      height: 13,
      id: 14,
      className: 15,
      path: 16,
    }[key];
  }

  function rowToObject(row, includeTech) {
    const columns = VISIBLE_CONTENT_COLUMNS.filter(column => includeTech || !column.tech);
    return columns.reduce((result, column) => {
      result[column.key] = row[getVisibleColumnIndex(column.key)] || '';
      return result;
    }, {});
  }

  function toCsv(rows) {
    return rows.map(row => row.map(value => {
      const text = String(value == null ? '' : value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',')).join('\r\n');
  }

  function downloadTextFile(filename, content, type) {
    const blob = new Blob(['\ufeff', content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ==================== Word 导出 ====================
  function exportTableAsWord(name, tableData) {
    const html = buildHtmlDoc(name, tableData);
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    downloadBlob(`${name}.doc`, blob);
  }

  function buildHtmlDoc(name, tableData) {
    const rows = tableData.map((row, idx) => {
      const tag = idx === 0 ? 'th' : 'td';
      return `<tr>${row.map(cell => `<${tag}>${escHtml(String(cell || ''))}</${tag}>`).join('')}</tr>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escHtml(name)}</title>
  <style>
    body { font-family: "Microsoft YaHei","PingFang SC",sans-serif; padding: 20px; color: #333; }
    h1 { font-size: 18px; margin-bottom: 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #666; padding: 8px 12px; text-align: left; font-size: 13px; }
    th { background: #e8ecf1; font-weight: 600; }
    tr:nth-child(even) td { background: #f7f8fa; }
  </style>
</head>
<body>
  <h1>${escHtml(name)}</h1>
  <table>${rows}</table>
</body>
</html>`;
  }

  // ==================== PDF 导出（通过浏览器打印） ====================
  function printAsPDF(name, htmlContent) {
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      showToast('弹窗被拦截，请允许此网站弹出窗口后重试');
      return;
    }
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    // 等文档渲染完成后触发打印
    printWindow.onload = () => printWindow.print();
    // 兼容：如果 onload 不触发，延迟调用
    setTimeout(() => {
      try { printWindow.print(); } catch (_) {}
    }, 500);
  }

  function exportTableAsPDF(name, tableData) {
    const html = buildHtmlDoc(name, tableData);
    printAsPDF(name, html);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function truncateCell(value, maxLength) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  }

  // ==================== 数据提取 ====================
  function extractTableData(table) {
    const data = [];
    const rows = table.rows;

    for (let i = 0; i < rows.length; i++) {
      const row = [];
      const cells = rows[i].cells;

      for (let j = 0; j < cells.length; j++) {
        const cell = cells[j];

        // 处理合并单元格：rowSpan和colSpan
        let text = '';
        if (cell.textContent) {
          text = cell.textContent.replace(/\s+/g, ' ').trim();
        }

        row.push(text);
      }
      data.push(row);
    }

    return data;
  }

  // ==================== 导出面板 ====================
  function showExportPanel(table) {
    hideExportPanel();
    selectedTable = table;

    const data = extractTableData(table);
    const rowCount = data.length;
    const colCount = data[0] ? data[0].length : 0;
    const previewRows = data.slice(0, 8);

    // 获取表格名称
    let tableName = '';
    if (table.caption) {
      tableName = table.caption.textContent.trim();
    } else if (table.id) {
      tableName = table.id;
    } else if (table.closest('section, article, div[class], div[id]')) {
      const parent = table.closest('section, article, div[class], div[id]');
      const heading = parent.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading) tableName = heading.textContent.trim();
    }
    if (!tableName) tableName = '表格数据';
    if (tableName.length > 50) tableName = tableName.substring(0, 50);

    // 遮罩层
    const overlay = document.createElement('div');
    overlay.className = 'hte-overlay';
    overlay.id = 'hte-overlay';
    document.body.appendChild(overlay);

    // 预览表格HTML
    let previewHtml = '<table class="hte-preview-table"><thead><tr>';
    if (previewRows[0]) {
      for (let c = 0; c < Math.min(colCount, 8); c++) {
        previewHtml += `<th>${escHtml(previewRows[0][c] || '')}</th>`;
      }
    }
    previewHtml += '</tr></thead><tbody>';
    for (let r = 1; r < previewRows.length; r++) {
      previewHtml += '<tr>';
      for (let c = 0; c < Math.min(colCount, 8); c++) {
        previewHtml += `<td>${escHtml(previewRows[r][c] || '')}</td>`;
      }
      previewHtml += '</tr>';
    }
    previewHtml += '</tbody></table>';

    if (colCount > 8) {
      previewHtml += `<p class="hte-preview-note">... 还有 ${colCount - 8} 列未显示</p>`;
    }
    if (rowCount > 8) {
      previewHtml += `<p class="hte-preview-note">... 还有 ${rowCount - 8} 行未显示</p>`;
    }

    // 面板HTML
    const panel = document.createElement('div');
    panel.className = 'hte-panel';
    panel.id = 'hte-panel';
    panel.innerHTML = `
      <div class="hte-panel-header">
        <h3>📊 ${escHtml(tableName)}</h3>
        <button class="hte-panel-close" title="关闭">✕</button>
      </div>
      <div class="hte-panel-body">
        <div class="hte-panel-stats">
          <span class="hte-stat"><strong>${rowCount}</strong> 行</span>
          <span class="hte-stat"><strong>${colCount}</strong> 列</span>
          <span class="hte-stat"><strong>${rowCount * colCount}</strong> 单元格</span>
        </div>
        <div class="hte-preview-wrap">${previewHtml}</div>
      </div>
      <div class="hte-panel-footer">
        <button class="hte-btn hte-btn-cancel">取消</button>
        <div class="hte-table-format-bar">
          <select id="hte-table-export-format" class="hte-format-select">
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV (.csv)</option>
            <option value="doc">Word (.doc)</option>
            <option value="pdf">PDF</option>
          </select>
        </div>
        <button class="hte-btn hte-btn-export">⬇ 导出</button>
      </div>
    `;
    document.body.appendChild(panel);

    // 事件绑定
    const btnExport = panel.querySelector('.hte-btn-export');
    const btnCancel = panel.querySelector('.hte-btn-cancel');
    const btnClose = panel.querySelector('.hte-panel-close');

    btnExport.addEventListener('click', () => {
      const format = panel.querySelector('#hte-table-export-format').value;
      exportSingleTable(table, tableName, format);
      hideExportPanel();
      exitCaptureMode();
    });

    const closePanel = () => {
      hideExportPanel();
      // 不退出捕获模式，用户可能还想选其他表
    };

    btnCancel.addEventListener('click', closePanel);
    btnClose.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);

    // 面板动画
    requestAnimationFrame(() => {
      overlay.classList.add('hte-visible');
      panel.classList.add('hte-visible');
    });
  }

  function hideExportPanel() {
    const panel = document.getElementById('hte-panel');
    const overlay = document.getElementById('hte-overlay');
    if (panel) panel.remove();
    if (overlay) overlay.remove();
    selectedTable = null;
  }

  // ==================== 导出功能 ====================
  function exportSingleTable(table, name, format) {
    const data = extractTableData(table);
    format = format || 'xlsx';

    if (format === 'csv') {
      downloadTextFile(`${name}.csv`, toCsv(data), 'text/csv;charset=utf-8');
      showToast(`已导出: ${name}.csv`);
      return;
    }

    if (format === 'doc') {
      exportTableAsWord(name, data);
      showToast(`已导出: ${name}.doc`);
      return;
    }

    if (format === 'pdf') {
      exportTableAsPDF(name, data);
      showToast(`正在生成 PDF...`);
      return;
    }

    // xlsx 默认
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `${name}.xlsx`);
    showToast(`已导出: ${name}.xlsx`);
  }

  // ==================== 网页可见内容导出 ====================
  function startImageCapture() {
    if (imageCaptureMode) return;
    imageCaptureMode = true;
    exitCaptureMode();
    hideExportPanel();

    imageCropOverlay = document.createElement('div');
    imageCropOverlay.className = 'hte-image-crop-overlay';

    const tip = document.createElement('div');
    tip.className = 'hte-image-crop-tip';
    tip.textContent = '拖选网页区域，导出用户可见内容；按 ESC 取消';
    imageCropOverlay.appendChild(tip);

    imageCropBox = document.createElement('div');
    imageCropBox.className = 'hte-image-crop-box';
    imageCropBox.style.display = 'none';
    imageCropOverlay.appendChild(imageCropBox);

    document.body.appendChild(imageCropOverlay);
    imageCropOverlay.addEventListener('mousedown', onImageCropMouseDown, true);
    document.addEventListener('keydown', onImageCropKeyDown, true);
  }

  function stopImageCapture() {
    imageCaptureMode = false;
    imageCropStart = null;
    document.removeEventListener('mousemove', onImageCropMouseMove, true);
    document.removeEventListener('mouseup', onImageCropMouseUp, true);
    document.removeEventListener('keydown', onImageCropKeyDown, true);
    if (imageCropOverlay) imageCropOverlay.remove();
    imageCropOverlay = null;
    imageCropBox = null;
  }

  function onImageCropKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopImageCapture();
      showToast('已取消可见内容导出');
    }
  }

  function onImageCropMouseDown(e) {
    if (!imageCaptureMode || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    imageCropStart = { x: e.clientX, y: e.clientY };
    updateImageCropBox(e.clientX, e.clientY);
    imageCropBox.style.display = 'block';

    document.addEventListener('mousemove', onImageCropMouseMove, true);
    document.addEventListener('mouseup', onImageCropMouseUp, true);
  }

  function onImageCropMouseMove(e) {
    if (!imageCropStart) return;
    e.preventDefault();
    e.stopPropagation();
    updateImageCropBox(e.clientX, e.clientY);
  }

  function onImageCropMouseUp(e) {
    if (!imageCropStart) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = normalizeCropRect(imageCropStart.x, imageCropStart.y, e.clientX, e.clientY);
    stopImageCapture();

    if (rect.width < 8 || rect.height < 8) {
      showToast('选择区域太小，请重新拖选');
      return;
    }

    try {
      exportRegionAsData(rect);
    } catch (err) {
      console.error('可见内容导出失败', err);
      showToast('可见内容导出失败，请刷新页面后重试');
    }
  }

  function updateImageCropBox(currentX, currentY) {
    const rect = normalizeCropRect(imageCropStart.x, imageCropStart.y, currentX, currentY);
    imageCropBox.style.left = `${rect.left}px`;
    imageCropBox.style.top = `${rect.top}px`;
    imageCropBox.style.width = `${rect.width}px`;
    imageCropBox.style.height = `${rect.height}px`;
  }

  function normalizeCropRect(x1, y1, x2, y2) {
    const left = Math.max(0, Math.min(x1, x2));
    const top = Math.max(0, Math.min(y1, y2));
    const right = Math.min(window.innerWidth, Math.max(x1, x2));
    const bottom = Math.min(window.innerHeight, Math.max(y1, y2));
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function waitFrame() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function sanitizeFileName(name) {
    return String(name).replace(/[\\/\*\?\[\]:"<>\|]/g, '-').trim();
  }
  // ==================== Toast提示 ====================
  function showToast(message) {
    // 移除已有的toast
    const existing = document.getElementById('hte-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'hte-toast';
    toast.className = 'hte-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // 入场动画
    requestAnimationFrame(() => {
      toast.classList.add('hte-toast-visible');
    });

    // 3秒后自动消失
    setTimeout(() => {
      toast.classList.remove('hte-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ==================== 工具函数 ====================
  function escHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
