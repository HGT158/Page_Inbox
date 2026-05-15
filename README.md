# 网页稍后处理

一个无需构建的 Chrome / Microsoft Edge 轻量扩展，用来把网页链接保存到本地收集箱，之后再分类、标记、导出或清理。

## 功能

- 一键保存当前网页
- 抓取页面标题和描述
- 右键菜单保存当前页面或链接
- 手动粘贴链接
- 给链接添加标签和备注
- 待处理 / 已处理队列
- 搜索标题、描述、链接、备注和标签
- 一键复制 Markdown 链接
- 导出 JSON 或 Markdown
- 清理已处理条目
- 支持扩展界面与元数据本地化

## 技术说明

- 基于 Manifest V3
- 数据仅保存在浏览器本地的 `chrome.storage.local`
- 不加载或执行远程代码
- 不向服务器传输保存的数据
- 当前声明权限：`activeTab`、`contextMenus`、`scripting`、`storage`

## 安装

1. 打开 Chrome 或 Microsoft Edge 的扩展管理页。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展”。
4. 选择这个文件夹：`C:\Page_Inbox`

## Microsoft Edge 发布

- 扩展清单已使用 `__MSG_...__` 本地化占位符。
- 已配置 `default_locale` 和 `_locales` 目录，便于 Microsoft Edge Add-ons 识别多语言。
- 发布时可参考 [EDGE_SUBMISSION.md](/C:/Page_Inbox/EDGE_SUBMISSION.md) 中整理的单一用途、权限说明、远程代码声明和测试说明。
