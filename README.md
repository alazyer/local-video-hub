# Local Video Hub

一个纯前端的网页版视频播放器，支持四种视频源：本地文件、URL 地址、服务器目录、百度网盘。所有数据本地存储，可离线使用，可通过 Capacitor 打包为 Android 应用。

**Local Video Hub** 专为家庭场景设计 —— 让平板浏览器直接观看电脑上已下载的视频，无需安装任何 App。

## ✨ 核心功能

### 四种视频源（侧边栏 Tab 切换）

| Tab | 来源 | 适用场景 | 持久化 |
|-----|------|---------|--------|
| 📁 **本地** | 浏览器 IndexedDB | 手动上传 / 扫描文件夹导入的视频 | ✅ 文件 + 元数据 |
| 🔗 **URL** | 任意 HTTP/HTTPS 地址 | `python -m http.server`、NAS、公网 CDN | ✅ URL 列表（localStorage） |
| 🖥️ **服务器** | 服务器指定目录（`VIDEO_ROOT`） | 局域网共享电脑上的视频给平板 | ❌ 实时读取 |
| ☁️ **网盘** | 百度网盘 | 网盘中的视频文件 | ❌ 实时读取 |

### 完整播放控制

- **基础**：播放 / 暂停（点击视频或按钮）
- **快进/快退**：±10 秒按钮 + 键盘 ←/→
- **进度条**：可拖拽 seek，显示缓冲进度
- **倍速**：0.5x / 0.75x / 1x / 1.25x / 1.5x / 2x / 3x
- **音量**：可拖拽音量条 + 静音切换
- **全屏**：原生 Fullscreen API
- **上一曲/下一曲**：本地列表自动连续播放
- **断点续播**：本地和 URL 视频每 5 秒持久化播放位置
- **键盘快捷键**：空格/K、←/→、↑/↓、M、F、`,`、`.`

### 安全性

- 服务器视频：路径穿越防护（拒绝 `../` 攻击）
- URL 代理：SSRF 防护（默认拒绝私网地址，可配置 `ALLOW_PRIVATE_NETWORK=true` 开启）
- 网盘：AppKey/Secret 仅存后端，不暴露给前端

## 🚀 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并按需修改：

```bash
# 视频根目录（服务器视频 Tab 使用）
VIDEO_ROOT=/path/to/your/videos

# 允许局域网访问（平板访问需要）
HOST=0.0.0.0

# 允许 URL 代理访问私网地址（python http.server 场景需要）
ALLOW_PRIVATE_NETWORK=true
```

### 3. 启动开发服务器

```bash
bun run dev
```

启动后控制台会显示：
```
- Local:        http://localhost:3000
- Network:      http://192.168.1.100:3000   ← 平板访问这个
```

### 4. 生产构建

```bash
bun run build
bun run start
```

## 📖 使用场景

### 场景 1：平板看电脑里的学习视频（推荐）

适合给孩子用平板看下载好的视频：

1. 在电脑上设置 `VIDEO_ROOT=/path/to/videos`
2. 启动 `bun run dev`
3. 平板浏览器访问 `http://电脑IP:3000`
4. 切换到「服务器」Tab，浏览视频并播放
5. 把网址添加到平板主屏书签，孩子下次点图标就能用

详见 [`docs/LAN_SHARING_GUIDE.md`](./docs/LAN_SHARING_GUIDE.md)

### 场景 2：用 python http.server 提供视频

```bash
cd /path/to/your/videos
python -m http.server 8000
```

在应用中切换到「URL」Tab → 点 `+` 添加 URL：
- 输入 `http://电脑IP:8000/视频.mp4`
- 默认直连播放（性能最佳）
- 若跨域导致进度条无法拖动，右键选「通过代理播放」

### 场景 3：手动导入视频到浏览器

切换到「本地」Tab → 点「添加视频」：
- **手动选择文件**：选一个或多个视频文件
- **扫描文件夹**：自动发现文件夹内所有视频（需 Chrome/Edge）

视频存储在浏览器 IndexedDB，关闭服务器也能继续播放。

### 场景 4：播放百度网盘视频

1. 在 [百度网盘开放平台](https://pan.baidu.com/union/apply) 申请开发者
2. 切换到「网盘」Tab → 点「未配置」按钮
3. 填入 AppKey / SecretKey / Access Token
4. 浏览网盘目录并播放

详见 [`docs/BAIDU_PAN_SOLUTION.md`](./docs/BAIDU_PAN_SOLUTION.md)

## 🏗️ 技术架构

### 技术栈

- **框架**：Next.js 16 (App Router) + TypeScript 5
- **样式**：Tailwind CSS 4 + shadcn/ui (New York)
- **图标**：lucide-react
- **状态**：React hooks + localStorage
- **存储**：IndexedDB（本地视频）+ localStorage（URL 视频）+ 内存（网盘配置）

### 项目结构

```
.
├── src/
│   ├── app/
│   │   ├── page.tsx                    # 主页面（4 Tab 切换）
│   │   ├── layout.tsx                  # 全局布局
│   │   └── api/
│   │       ├── server-file/
│   │       │   ├── list/route.ts       # 服务器目录列表
│   │       │   └── stream/route.ts     # 服务器视频流代理（Range 支持）
│   │       ├── http-proxy/route.ts     # URL 视频代理（解决跨域 seek）
│   │       └── baidu-pan/
│   │           ├── auth/route.ts       # 百度网盘 OAuth
│   │           ├── list/route.ts       # 网盘文件列表
│   │           └── stream/route.ts     # 网盘视频流代理
│   ├── lib/
│   │   ├── video-db.ts                 # IndexedDB 封装（本地视频）
│   │   ├── url-videos.ts               # localStorage 封装（URL 视频）
│   │   ├── server-videos.ts            # 服务器 fs 操作（服务端）
│   │   ├── server-videos-shared.ts     # 共享常量（MIME、Range 解析）
│   │   ├── baidu-pan.ts                # 百度网盘 API 客户端
│   │   └── pan-config-store.ts         # 网盘配置存储
│   └── components/
│       └── video-player/
│           ├── video-player.tsx        # 核心播放器（含完整控制条）
│           ├── playlist.tsx            # 本地视频列表
│           ├── url-videos.tsx          # URL 视频管理
│           ├── server-browser.tsx      # 服务器文件浏览器
│           ├── pan-browser.tsx         # 网盘文件浏览器
│           ├── add-videos.tsx          # 本地视频添加（上传/扫描）
│           ├── baidu-pan-settings.tsx  # 网盘配置对话框
│           └── error-boundary.tsx      # 错误边界（防崩溃）
├── docs/                               # 使用文档与部署说明
├── scripts/                            # 开发 / 构建 / 部署辅助脚本
├── tests/                              # 脚本与运行时验证用例
└── README.md
```

`scripts/` 目录说明见 [`scripts/README.md`](./scripts/README.md)。

### 流代理设计

三种视频源（服务器/URL/网盘）都通过后端流代理转发，解决：

| 问题 | 解决方案 |
|------|---------|
| User-Agent 校验（网盘 >20MB） | 后端用 `pan.baidu.com` UA 请求 |
| CORS 跨域 | 后端补充 `Access-Control-Allow-Origin: *` |
| 进度条无法拖动 | 透传 Range 头，返回 206 + Content-Range |
| 内存爆炸 | `fs.createReadStream` 流式转发，不缓冲整个文件 |
| 流取消导致页面崩溃 | `closed` 标记防御 controller 已 close 后再触发事件 |

## ⚙️ 配置参考

### 环境变量（`.env`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VIDEO_ROOT` | `{project}/videos` | 服务器视频根目录，逗号分隔支持多目录 |
| `HOST` | `localhost` | 监听地址，`0.0.0.0` 允许局域网访问 |
| `ALLOW_PRIVATE_NETWORK` | `false` | URL 代理是否允许访问私网（localhost/192.168.x） |

### 视频格式兼容性

| 格式 | 浏览器原生支持 | 备注 |
|------|--------------|------|
| MP4 (H.264 + AAC) | ✅ 完美 | **强烈推荐** |
| WebM (VP8/VP9) | ✅ 良好 | |
| MOV / M4V | ✅ 多数支持 | |
| MKV (H.264 + AAC) | ⚠️ 部分 | AC3/DTS 音轨会无声 |
| MKV (HEVC) / AVI / FLV / WMV / RMVB | ❌ 不支持 | 需 ffmpeg 转码 |

转码命令：
```bash
# 已是 H.264：只重封装为 MP4（秒级完成）
ffmpeg -i input.mkv -c:v copy -c:a aac output.mp4

# HEVC：转码为 H.264
ffmpeg -i input.mkv -c:v libx264 -crf 23 -c:a aac output.mp4
```

## 📚 详细文档

- [局域网共享使用指南](./docs/LAN_SHARING_GUIDE.md) — 平板看电脑视频的完整配置
- [百度网盘接入方案](./docs/BAIDU_PAN_SOLUTION.md) — 网盘视频播放技术细节
- [Android 打包指南](./docs/ANDROID_PACKAGING.md) — Capacitor 打包为 APK
- [脚本说明](./scripts/README.md) — `scripts/` 目录中的开发、构建与部署辅助脚本

## 🔧 故障排查

### 平板打不开网页

1. 服务器上访问 `http://localhost:3000` 确认服务正常
2. 检查防火墙放行 3000 端口（限定局域网段更安全）
3. 确认平板和服务器在同一 WiFi
4. 路由器绑定服务器静态 IP（避免重启后 IP 变化）

### 视频播放卡顿

1. 检查 WiFi 信号
2. 服务器 CPU/磁盘 IO 是否满载
3. 大文件考虑降低码率（ffmpeg 转码）

### 进度条无法拖动

- 服务器/网盘视频：已支持 Range，正常可拖
- URL 视频：跨域且目标服务器无 CORS 头时受限，右键选「通过代理播放」

### 页面意外刷新

已通过 `ErrorBoundary` + 流代理 `closed` 标记防御，若仍遇到请检查浏览器控制台错误。

## 📦 打包为 Android 应用

详见 [`docs/ANDROID_PACKAGING.md`](./docs/ANDROID_PACKAGING.md)。核心步骤：

```bash
# 安装 Capacitor
bun add @capacitor/core @capacitor/cli @capacitor/android

# 配置 next.config.ts: output = 'export'
# 构建静态文件
bun run build

# 添加 Android 平台
bunx cap add android
bunx cap sync android
bunx cap open android
```

## 📝 许可证

私有项目，未开源。
