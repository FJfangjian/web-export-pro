# 网页内容导出工具 - Chrome插件

## 项目概述
Chrome Manifest V3插件，截取网页表格/元素数据，导出为 Excel(.xlsx) / Word(.doc) / PDF / CSV / JSON。

## 技术栈
- Manifest V3
- SheetJS 0.20.3 (xlsx.full.min.js) — xlsx 导出
- 纯原生JS，无框架依赖
- Python + Pillow 生成图标
- Word 导出: HTML + application/msword MIME (.doc)
- PDF 导出: 浏览器原生 window.print() 打印

## 关键架构
- Content script (content/content.js): 注入页面，处理表格捕获、数据提取、多格式导出
- Popup (popup/*): 用户交互入口，通过chrome.tabs.sendMessage与content script通信
- Background (service-worker.js): 生命周期管理
- CSS (content/content.css): 高亮、面板、Toast全部在注入样式表中

## 交互流程
1. 用户点击插件图标 → popup显示
2. "进入捕获模式" → 页面table被虚线高亮
3. 点击table → 弹出预览面板（8行预览+行列统计）
4. 选择导出格式（xlsx/csv/doc/pdf）→ 点击导出
5. 可见内容导出支持拖选区域，预览后导出

## 支持的导出格式
| 格式 | 实现方式 | 表格导出 | 可见内容导出 |
|------|---------|---------|------------|
| .xlsx | SheetJS | ✅ | ✅ |
| .csv  | 文本拼接 | ✅ | ✅ |
| .doc  | HTML+MIME | ✅ | ✅ |
| PDF   | window.print | ✅ | ✅ |
| .json | JSON.stringify | ❌ | ✅ |

## 注意事项
- 使用CSS outline高亮，不修改页面DOM
- badge用::before伪元素+attr()实现，性能最优
- sheet名称截断到31字符（Excel限制）
- PDF导出依赖浏览器打印对话框，部分浏览器可能拦截弹窗
