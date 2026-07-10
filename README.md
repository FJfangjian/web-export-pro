# Table Snapper

> 网页内容一键导出 — Chrome 浏览器插件

📊 捕获网页中的表格或任意可见元素，一键导出为 **Excel / Word / PDF / CSV / JSON**。

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 功能

- **表格捕获** — 进入捕获模式，页面上的 `<table>` 会高亮，点击即可预览并导出
- **可见内容捕获** — 拖选网页任意区域，提取区域内所有可见元素
- **多格式导出** — 支持 Excel (.xlsx)、Word (.doc)、PDF、CSV、JSON
- **预览确认** — 导出前可预览前 8 行数据，确认后再下载
- **零依赖** — 纯原生 JS，除 SheetJS 外无第三方库

## 支持的导出格式

| | Excel | CSV | Word | PDF | JSON |
|---|:---:|:---:|:---:|:---:|:---:|
| 表格导出 | ✅ | ✅ | ✅ | ✅ | — |
| 可见内容导出 | ✅ | ✅ | ✅ | ✅ | ✅ |

- **Excel** — 使用 SheetJS 生成标准 .xlsx
- **Word** — 生成带样式的 HTML 文档，以 .doc 格式保存，Word/WPS 可直接打开
- **PDF** — 通过浏览器原生打印功能生成
- **CSV / JSON** — 纯文本格式，轻量通用

## 安装

### Chrome 应用商店 *(待上架)*

### 开发者模式加载

1. 下载本项目，解压
2. 打开 Chrome → `chrome://extensions/`
3. 右上角开启 **开发者模式**
4. 点击 **加载已解压的扩展程序** → 选择项目目录
5. 插件图标出现在工具栏，即可使用

## 使用

| 操作 | 说明 |
|------|------|
| 点击图标 → **进入捕获模式** | 页面表格出现虚线高亮，点击表格弹出预览 |
| 预览面板 → 选择格式后 **导出** | 格式下拉框可选 xlsx/csv/word/pdf |
| 点击图标 → **可见内容导出** | 拖选页面区域，预览可见元素后导出 |
| 按 `ESC` | 退出捕获或拖选模式 |

## 项目结构

```
├── manifest.json          # 插件配置 (Manifest V3)
├── background/
│   └── service-worker.js  # 后台 Service Worker
├── content/
│   ├── content.js         # 核心逻辑：捕获、提取、导出
│   └── content.css        # 注入样式：高亮、面板、Toast
├── popup/
│   ├── popup.html         # 弹出窗口 UI
│   ├── popup.css          # 弹出窗口样式
│   └── popup.js           # 弹出窗口交互
├── libs/
│   └── xlsx.full.min.js   # SheetJS 0.20.3
└── icons/                 # 插件图标 (16/48/128)
```

## 技术栈

- Chrome Extension **Manifest V3**
- **SheetJS** 0.20.3 — Excel 生成
- 纯原生 JavaScript，无框架
- Word 导出：HTML + `application/msword` MIME
- PDF 导出：浏览器 `window.print()` 原生通道

## License

MIT © 阿布
