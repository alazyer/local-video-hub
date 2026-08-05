# 百度网盘视频接入方案

> 让网页版播放器能够浏览并播放存储在百度网盘中的视频文件。

## 一、为什么需要这个方案

百度网盘存储了大量用户视频（学习资料、影视、备份等），但官方 Web 端体验有限：
- 没有倍速播放、断点续播、上一曲/下一曲等增强功能
- 非会员有播放时长限制
- 无法与本地视频统一管理

本方案让网页播放器能够直接浏览网盘目录、选择视频并通过流式代理播放，提供与本地视频一致的体验。

## 二、技术难点：为什么不能纯前端

百度网盘 CDN 有三个限制，决定了**必须有后端流代理**：

### 1. User-Agent 强校验
对 >20MB 的文件，百度 CDN 强制要求请求头 `User-Agent: pan.baidu.com`。
但浏览器出于安全原因，**不允许通过 JS 修改 User-Agent**，所以浏览器直接请求会被拒绝。

### 2. 无 CORS 头
百度 CDN 不返回 `Access-Control-Allow-Origin` 头，浏览器的 `<video>` 标签跨域加载会被拦截。

### 3. Referer 防盗链
直链请求时若 Referer 不正确，会返回 403。

## 三、整体架构

```
┌────────────┐       ┌──────────────────────┐       ┌──────────────┐
│   浏览器    │ ←──→ │  Next.js API Route   │ ←──→ │  百度网盘 CDN  │
│  (前端)     │       │   (流代理)            │       │              │
└────────────┘       └──────────────────────┘       └──────────────┘
   <video>              ① 保管 AppKey/Secret
   文件列表 UI          ② 调网盘 API 获取直链
                        ③ 用 UA=pan.baidu.com 请求 CDN
                        ④ 流式转发给浏览器 + 补 CORS 头
```

## 四、关键 API 路由

### 1. `/api/baidu-pan/auth` — 授权管理
- `GET ?action=status` — 查询当前配置状态
- `GET ?action=authorize&appKey=xxx` — 获取 OAuth 授权 URL
- `POST { accessToken }` — 手动填 token 保存（推荐开发调试）
- `POST { code, redirectUri }` — 用 OAuth code 换 token
- `DELETE` — 清除配置

### 2. `/api/baidu-pan/list?dir=/path` — 文件列表
调用百度网盘 `xpan/multimedia?method=list` 接口，返回目录下的文件，前端按 `category=6` 过滤视频。

### 3. `/api/baidu-pan/stream?fsId=xxx` — 视频流代理（核心）
**这是整个方案的灵魂**，处理逻辑：

```typescript
// 1. 获取直链（带 7 小时缓存，避免每次拖进度都重新获取）
const dlink = await getCachedDlink(fsId);

// 2. 构造转发请求头（核心：必须带 pan.baidu.com UA）
const upstreamHeaders = {
  "User-Agent": "pan.baidu.com",
};
// 透传 Range 头，支持视频拖动进度条
if (req.headers.get("range")) {
  upstreamHeaders["Range"] = req.headers.get("range")!;
}

// 3. 请求百度 CDN
const upstreamRes = await fetch(dlink, { headers: upstreamHeaders });

// 4. 构造响应头：透传视频相关头 + 补充 CORS
const respHeaders = new Headers();
// 透传：content-type / content-length / content-range / accept-ranges
// 补充：access-control-allow-origin: *
//       access-control-expose-headers: Content-Range, Content-Length
//       accept-ranges: bytes（兜底）

// 5. 流式转发 body（不缓冲整个文件到内存）
return new Response(upstreamRes.body, { status, headers: respHeaders });
```

## 五、前端 UI

### 1. 侧边栏 Tab 切换
右侧播放列表区新增「本地视频 / 百度网盘」两个 Tab：
- **本地视频**：保留原有所有功能（添加/扫描/播放/管理）
- **百度网盘**：显示网盘文件浏览器

### 2. 网盘配置对话框
入口：网盘 Tab 顶部的"未配置/已绑定"按钮。

支持两种授权方式：

**方式 1：手动填 Token（推荐开发调试）**
- 直接粘贴 access_token
- 可选填 AppKey / SecretKey（仅 OAuth 刷新时需要）

**方式 2：OAuth 跳转授权**
1. 填 AppKey / SecretKey / 回调地址
2. 点击「打开百度授权页」→ 浏览器跳转到百度
3. 用户在百度页面授权
4. 百度跳转回回调地址，URL 中带 `?code=xxxx`
5. 复制 code 粘贴到对话框
6. 点击「用授权码换取 Token」

### 3. 文件浏览器
- 顶部面包屑导航（支持返回上级/回到根目录）
- 目录优先显示，视频文件带缩略图（如网盘返回）
- 隐藏非视频文件（提示数量）
- 当前播放视频高亮
- 错误时显示重试按钮

### 4. 视频统一播放模型
统一 `CurrentPlayback` 模型：
- 本地视频：URL 是 `blob:` 协议（IndexedDB File）
- 网盘视频：URL 是 `/api/baidu-pan/stream?fsId=...`（流代理）

播放器底部的当前播放信息条会显示来源图标（绿色硬盘=本地 / 蓝色云=网盘）。

## 六、使用前提

由于百度网盘 CDN 限制，纯前端无法播放网盘视频。本方案需要：

### 步骤 1：申请百度网盘开放平台开发者
1. 访问 https://pan.baidu.com/union/apply
2. 个人/企业认证（个人最多 1 个应用）
3. 创建应用，勾选「网盘基础能力」和「网盘影音能力」

### 步骤 2：配置回调地址
在应用详情页填：`{你的域名}/api/baidu-pan/auth/callback`

### 步骤 3：获取凭据
- 在应用详情页获取 AppKey / SecretKey / App ID

### 步骤 4：填入应用
1. 在应用右侧切换到「百度网盘」Tab
2. 点击顶部「未配置」按钮
3. 选「手动填 Token」或「OAuth 跳转授权」
4. 保存后即可浏览网盘视频

## 七、文件结构

```
src/
├── lib/
│   ├── baidu-pan.ts                  # 网盘 API 客户端
│   └── pan-config-store.ts           # 服务端配置存储（内存）
├── app/api/baidu-pan/
│   ├── auth/route.ts                 # OAuth 授权 API
│   ├── list/route.ts                 # 文件列表 API
│   └── stream/route.ts              # 流代理 API（核心）
└── components/video-player/
    ├── baidu-pan-settings.tsx        # 配置对话框
    └── pan-browser.tsx               # 文件浏览器
```

## 八、限制说明

1. **需要用户自备百度网盘开放平台 AppKey**（无法替用户申请）
2. **后端流代理会消耗服务器带宽**：
   - 大文件建议未来扩展使用网盘官方转码 m3u8 分片流
   - 流式转发不缓冲整个文件到内存，但仍走服务器带宽
3. **当前是单用户内存存储**：
   - 重启服务会丢失配置（生产环境建议改用数据库持久化）
   - 多用户场景需要改造为按用户隔离
4. **网盘视频暂不支持断点续播**：
   - `lastPosition` 无法持久化到 IndexedDB（因为网盘视频不走本地存储）
   - 未来可考虑用 localStorage 按 fs_id 缓存位置

## 九、性能与安全

### 性能优化
- **dlink 缓存 7 小时**：百度直链 8 小时过期，留 1h 余量，避免每次拖进度都重新获取
- **流式转发**：使用 `Response(upstreamRes.body)` 直接转发可读流，不缓冲整个文件
- **Range 透传**：支持分段请求，拖动进度条时只请求需要的部分

### 安全注意
- AppKey / SecretKey 必须保管在后端，**绝不能暴露给前端**
- 当前实现用内存存储配置，生产环境应改用数据库加密存储
- access_token 应设置过期监控，过期前自动刷新（需 refreshToken）

## 十、参考链接

- 百度网盘开放平台申请：https://pan.baidu.com/union/apply
- 百度网盘开放平台文档：https://pan.baidu.com/union/doc
- OAuth 授权流程文档：https://pan.baidu.com/union/doc/fl1ka3mqf
- 文件列表 API 文档：https://pan.baidu.com/union/doc/al0rwqzzr
- HTTP Range Requests 规范：https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Range_requests
