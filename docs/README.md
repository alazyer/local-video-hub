# 文档索引

本目录包含家庭视频播放器的所有详细文档。

## 📖 文档列表

### [LAN_SHARING_GUIDE.md](./LAN_SHARING_GUIDE.md) — 局域网共享使用指南

让平板浏览器直接观看另一台电脑上已下载好的视频，无需安装任何 App。

- 适用场景与方案对比
- 快速开始三步（配置 VIDEO_ROOT、启动服务、平板访问）
- 网络配置（防火墙、固定 IP、mDNS）
- 视频格式兼容性表 + 转码命令
- 安全说明与故障排查

### [BAIDU_PAN_SOLUTION.md](./BAIDU_PAN_SOLUTION.md) — 百度网盘视频接入方案

让播放器支持浏览并播放百度网盘中的视频文件。

- 技术难点说明（UA 校验、CORS、防盗链）
- 流代理架构图与核心代码
- 前端 UI 设计（Tab、配置对话框、文件浏览器）
- 使用前提与申请步骤

### [ANDROID_PACKAGING.md](./ANDROID_PACKAGING.md) — Android 打包指南

把网页应用打包为 Android APK，安装到平板/手机。

- Capacitor 安装与配置
- Next.js 静态导出设置
- APK / AAB 构建流程
- 原生能力扩展（FilePicker、后台播放、媒体通知）

## 🔗 其他

- 项目根目录的 [README.md](../README.md) 是项目总文档
- 配置参考：[`.env.example`](../.env.example)
