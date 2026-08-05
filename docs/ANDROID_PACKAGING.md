# 本地视频播放器 · Android 打包指南

本项目是一个纯前端的网页版本地视频播放器，基于 Next.js 16 + TypeScript + Tailwind CSS 构建。所有视频文件存储在浏览器 IndexedDB 中，**不会上传到服务器**，因此非常适合通过 Capacitor 打包为 Android 应用，实现"安装即用"的本地视频播放体验。

---

## 一、为什么选择 Capacitor？

| 方案 | 优势 | 劣势 |
|------|------|------|
| **Capacitor**（推荐） | 原生 WebView 包装、生态成熟、支持 File System Access API 的替代方案、可直接调用 Android 文件系统 | 需要 Android Studio 环境 |
| Cordova | 老牌方案、插件多 | 维护趋于停滞 |
| TWA (Trusted Web Activity) | 最简单，只需 PWA | 受 Chrome 限制，部分 API 不可用 |

**结论**：对于本地视频播放器场景，**Capacitor** 是最合适的选择，因为它能：
- 复用 100% 的 Web 代码
- 通过 `@capacitor/filesystem` 插件补充 WebView 不支持的本地文件访问能力
- 支持全屏、媒体控制、后台播放等原生特性

---

## 二、打包步骤

### 1. 安装 Capacitor

在项目根目录执行：

```bash
# 安装核心包
bun add @capacitor/core @capacitor/cli

# 安装 Android 平台
bun add @capacitor/android

# 初始化 Capacitor 配置
bunx cap init "本地视频播放器" "com.localplayer.app" --web-dir=out
```

这会生成 `capacitor.config.ts`，内容类似：

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.localplayer.app',
  appName: '本地视频播放器',
  webDir: 'out', // Next.js 静态导出目录
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: '#0a0a0a',
    },
  },
};

export default config;
```

### 2. 配置 Next.js 静态导出

修改 `next.config.ts`，添加 `output: 'export'`：

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',  // 静态导出
  images: { unoptimized: true }, // 静态导出不支持图片优化
  // 其他配置...
};

export default nextConfig;
```

> 注意：静态导出后所有路由必须是纯静态的，不能使用服务端渲染。本项目已使用 `'use client'` 指令，符合要求。

### 3. 构建并同步

```bash
# 构建静态文件到 out/ 目录
bun run build

# 添加 Android 平台（首次执行）
bunx cap add android

# 同步 Web 资源到 Android 项目
bunx cap sync android

# 在 Android Studio 中打开项目
bunx cap open android
```

### 4. 在 Android Studio 中打包 APK / AAB

1. 打开 Android Studio 后等待 Gradle 同步完成
2. 菜单栏：`Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`
3. 生成的 APK 在 `android/app/build/outputs/apk/debug/app-debug.apk`

如需发布到应用商店，需生成签名 APK：
1. `Build` → `Generate Signed Bundle / APK`
2. 选择 `Android App Bundle` 或 `APK`
3. 创建或选择 keystore 文件
4. 选择 `release` 构建类型

---

## 三、原生能力扩展（可选）

### 1. 访问设备视频文件

WebView 中 `File System Access API` 在 Android 上支持有限，建议安装 `@capacitor/filesystem` 和 `@capacitor-community/file-picker`：

```bash
bun add @capacitor/filesystem @capacitor-community/file-picker
```

然后在 `add-videos.tsx` 中添加原生选择逻辑：

```ts
import { FilePicker } from '@capacitor-community/file-picker';

const isNative = typeof (window as any).capacitor !== 'undefined';

if (isNative) {
  // 在原生环境调用 FilePicker
  const result = await FilePicker.pickFiles({
    types: ['video/*'],
    multiple: true,
  });
  // ... 处理文件
}
```

### 2. 后台播放（音频）

如需在锁屏后继续播放音频，安装 `@capacitor-community/background-mode`：

```bash
bun add @capacitor-community/background-mode
```

### 3. 媒体通知栏控制

安装 `@capacitor-community/media-session` 可在锁屏界面显示播放控制：

```bash
bun add @capacitor-community/media-session
```

---

## 四、常见问题

### Q1：IndexedDB 数据会被清理吗？

- **WebView 默认**：用户清除应用数据时会被清除
- **持久化建议**：调用 `navigator.storage.persist()` 申请持久化存储：

```ts
if (navigator.storage && navigator.storage.persist) {
  const isPersisted = await navigator.storage.persisted();
  if (!isPersisted) {
    await navigator.storage.persist();
  }
}
```

### Q2：视频文件多大能存？

- IndexedDB 通常可使用设备可用存储空间的 **80%** 以上
- 在 Android WebView 中，建议单个文件不超过 2GB
- 大文件建议使用 `@capacitor/filesystem` 直接读取设备文件路径，而非复制到 IndexedDB

### Q3：哪些视频格式在 Android 上能播放？

| 格式 | Android WebView 支持 | 备注 |
|------|---------------------|------|
| MP4 (H.264) | ✅ 完美 | 推荐格式 |
| WebM (VP9) | ✅ 良好 | |
| MOV | ⚠️ 部分 | 部分编码不支持 |
| MKV | ⚠️ 部分 | 容器支持，编码可能不支持 |
| AVI | ❌ 不支持 | 需转码 |
| FLV | ❌ 不支持 | 已淘汰 |

### Q4：如何处理权限申请？

在 `android/app/src/main/AndroidManifest.xml` 中添加：

```xml
<!-- 读取外部存储（Android 12 及以下） -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
                 android:maxSdkVersion="32" />

<!-- 读取媒体文件（Android 13+） -->
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />

<!-- 后台播放 -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

---

## 五、参考链接

- Capacitor 官方文档：https://capacitorjs.com/docs
- Next.js 静态导出：https://nextjs.org/docs/app/building-your-application/deploying/static-exports
- IndexedDB 持久化存储：https://developer.mozilla.org/en-US/docs/Web/API/Storage_API
