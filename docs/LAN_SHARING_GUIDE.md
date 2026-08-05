# 局域网视频共享使用指南

> 让平板（手机/电脑）浏览器直接观看另一台电脑上已下载好的视频，无需安装任何 App。
> 专为家庭场景设计，给孩子用平板看学习视频。

## 一、适用场景

- 家里有一台电脑（**服务器A**），存放了大量已下载的学习视频
- 想用平板（**设备B**）通过浏览器观看这些视频
- 不想给平板装 VLC / Infuse 等播放器
- 希望有友好的 UI（缩略图、倍速、断点续播、上一集/下一集）
- 平板与电脑在**同一 WiFi/局域网**下

## 二、方案对比

| 方案 | 浏览器直接播放 | 复用 UI | 部署成本 | 小孩易用性 |
|---|---|---|---|---|
| **本方案：Next.js 流代理** | ✅ | ✅ 完整 UI | 低 | ★★★★★ |
| Samba + VLC | ❌ 需装 App | ❌ | 低 | ★★ |
| DLNA | ❌ 需装 App | ❌ | 低 | ★★ |
| Plex / Jellyfin | ✅ | ❌ 独立 App | 高 | ★★★★ |
| python http.server | ✅ | ❌ 极简 | 极低 | ★★ |

**结论**：本方案最适合儿童场景——平板只需打开浏览器访问 `http://电脑IP:3000`，零安装、统一书签、UI 友好。

## 三、原理

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────┐
│   平板浏览器 │ ←─────→ │  服务器A 上的     │ ←─────→ │ 服务器A 本地  │
│  (设备B)    │  HTTP   │  Next.js Web App  │  fs     │  视频文件     │
└─────────────┘         └──────────────────┘         └──────────────┘
   <video>                ① 扫描 VIDEO_ROOT 目录
   文件浏览器 UI          ② 用 fs 读取视频文件流
                          ③ 透传 Range 头支持拖动进度条
                          ④ 补充 CORS 头让浏览器能跨域加载
```

**关键点**：
- 浏览器不能直接读 `file://` 协议，所以必须有 HTTP 服务器
- 视频文件可能很大，必须用流式传输（不缓冲整个文件到内存）
- 必须支持 Range 请求，否则进度条无法拖动
- 必须补 CORS 头，否则浏览器跨域加载会被拦截

## 四、快速开始

### 步骤 1：配置视频根目录

在服务器 A 上编辑 `.env` 文件（项目根目录）：

```bash
# 单个目录
VIDEO_ROOT=/path/to/your/videos

# 多个目录（用逗号分隔）
VIDEO_ROOT=/path/to/videos1,/path/to/videos2

# Windows 路径（注意用正斜杠或双反斜杠）
VIDEO_ROOT=D:/Videos
VIDEO_ROOT=D:\\Videos
```

如果不配置，默认使用项目下的 `videos/` 目录。

### 步骤 2：启动服务

```bash
# 开发模式（带热重载，调试用）
bun run dev

# 生产模式（性能更好）
bun run build
bun run start
```

启动后控制台会显示：
```
▲ Next.js 16.1.3
- Local:        http://localhost:3000
- Network:      http://192.168.1.100:3000   ← 这个 IP 就是平板要访问的
```

记下 `Network` 那行的 IP 地址（如 `192.168.1.100`）。

### 步骤 3：在平板上访问

1. 确保平板和服务器 A 连同一个 WiFi
2. 打开平板浏览器（Safari / Chrome / Edge 任一）
3. 地址栏输入：`http://192.168.1.100:3000`
4. 进入应用后，右侧切换到「**服务器**」Tab
5. 即可看到服务器 A 上 `VIDEO_ROOT` 目录下的视频

**建议**：把网址添加到平板主屏书签，下次直接点开。

## 五、网络配置（重要）

### 1. 服务器 A 防火墙放行 3000 端口

**Linux (ufw)**：
```bash
# 仅允许局域网（推荐，更安全）
sudo ufw allow from 192.168.1.0/24 to any port 3000

# 或允许所有（不推荐，公网也能访问）
sudo ufw allow 3000
```

**Windows**：
1. 控制面板 → Windows Defender 防火墙 → 高级设置
2. 入站规则 → 新建规则 → 端口 → TCP 3000
3. 作用域 → 远程 IP → "下列 IP 地址" → 添加 `192.168.1.0/24`（你的局域网段）
4. 操作 → 允许连接

**macOS**：
- 系统偏好设置 → 安全性与隐私 → 防火墙 → 防火墙选项
- 添加 Node.js（或 bun）允许传入连接

### 2. 固定服务器 A 的 IP（强烈建议）

否则路由器重启后 IP 可能变化，平板书签会失效：

**方法 1：路由器 DHCP 静态绑定（推荐）**
- 登录路由器管理页（通常是 192.168.1.1 或 192.168.0.1）
- 找到「DHCP 客户端列表」或「静态地址分配」
- 把服务器 A 的 MAC 地址绑定到固定 IP（如 192.168.1.100）

**方法 2：服务器 A 设置静态 IP**
- Linux：编辑 `/etc/netplan/*.yaml` 或 NetworkManager
- Windows：网络适配器属性 → IPv4 → 使用静态 IP
- macOS：系统偏好 → 网络 → 高级 → TCP/IP → 手动配置

**方法 3：用 mDNS 主机名（最简单）**
- Linux：`sudo apt install avahi-daemon`
- macOS：默认开启
- Windows 10+：默认开启
- 然后平板访问：`http://服务器A的主机名.local:3000`（如 `http://my-pc.local:3000`）
- iPad / Android 平板都支持 mDNS

### 3. 网段隔离注意

- 服务器 A 和平板必须在**同一网段**（如都在 192.168.1.x）
- 路由器开启了「客户端隔离」或「AP 隔离」时无法互访，需要关闭
- 访客 WiFi 通常与主人 WiFi 隔离，不要用访客 WiFi

## 六、视频格式兼容性

| 格式 | 浏览器支持 | 备注 |
|------|-----------|------|
| MP4 (H.264 + AAC) | ✅ 完美 | **强烈推荐**，所有浏览器都支持 |
| WebM (VP8/VP9) | ✅ 良好 | |
| MOV | ✅ 多数支持 | |
| M4V | ✅ 多数支持 | |
| MKV (H.264 + AAC) | ⚠️ 部分 | 容器支持，但 AC3/DTS 音轨会无声 |
| MKV (HEVC) | ❌ 不支持 | 需转码 |
| AVI | ❌ 不支持 | 需转码 |
| FLV | ❌ 不支持 | 已淘汰 |
| WMV | ❌ 不支持 | 需转码 |
| RMVB | ❌ 不支持 | 需转码 |

**应用 UI 提示**：不原生支持的格式会显示 `?` 黄色标记，点击可能无法播放。

### 转码建议

如果视频是 MKv/avi 等不兼容格式，用 ffmpeg 转换：

```bash
# 视频已经是 H.264 编码：只重封装为 MP4（秒级完成，不损画质）
ffmpeg -i input.mkv -c:v copy -c:a aac output.mp4

# 视频是 HEVC/H.265：转码为 H.264（耗时，但兼容性好）
ffmpeg -i input.mkv -c:v libx264 -crf 23 -c:a aac output.mp4

# 批量转换目录下所有 mkv
for f in *.mkv; do
  ffmpeg -i "$f" -c:v copy -c:a aac "${f%.mkv}.mp4"
done
```

## 七、安全说明

### 路径穿越防护
应用通过 `resolveSafePath()` 函数严格检查路径，确保只能访问 `VIDEO_ROOT` 配置的目录下的文件：
- 拒绝 `../../../etc/passwd` 等路径穿越攻击
- 拒绝包含空字节的输入（绕过检查的常见手法）
- 解析后的绝对路径必须以 `root + path.sep` 开头

### 网络访问控制
- 默认监听 `0.0.0.0`，允许局域网访问
- 防火墙规则应限定来源 IP 为局域网段（如 `192.168.1.0/24`）
- **不要把端口暴露到公网**，否则任何人都能访问你的视频

### 数据隐私
- 视频文件直接从服务器 A 流式传输到平板，**不经过任何第三方**
- 不上传到云服务
- 不记录访问日志（除非自行配置）

## 八、性能优化

### 大文件流式播放
- 后端用 `fs.createReadStream` 流式读取，不缓冲整个文件到内存
- 支持 Range 请求，拖动进度条时只请求需要的部分
- 千兆局域网足以承载 4K 视频码率（约 25-50 Mbps）

### 多用户并发
- Node.js 单进程能处理数百并发流
- 如果家中多人同时观看，考虑用 PM2 启动多实例：
  ```bash
  npm install -g pm2
  pm2 start "bun run start" --name video-player -i 2
  ```

## 九、故障排查

### 平板打不开网页

1. **检查服务器 A 服务是否运行**：在服务器 A 上访问 `http://localhost:3000`
2. **检查 IP 是否正确**：在服务器 A 上运行 `ifconfig` (Linux/Mac) 或 `ipconfig` (Windows)
3. **检查防火墙**：临时关闭防火墙测试，能访问说明是防火墙问题
4. **检查网段**：平板和服务器 A 必须在同一网段，用 `ping 服务器A的IP` 测试连通性

### 视频加载失败

1. **检查 VIDEO_ROOT 配置**：服务器 A 上访问 `http://localhost:3000/api/server-file/list`，应返回 JSON
2. **检查文件权限**：服务器 A 上的 Node 进程对视频目录有读权限
3. **检查视频格式**：浏览器控制台（F12）查看具体错误
4. **检查路径中文编码**：URL 中的中文会被自动编码，应用已处理

### 视频卡顿

1. **检查 WiFi 信号**：弱信号会限速
2. **检查服务器 A 负载**：CPU/磁盘 IO 是否满载
3. **降低视频码率**：用 ffmpeg 转码降低分辨率

### 进度条无法拖动

- 应用已支持 Range 请求，正常情况下可拖动
- 如果不能拖，可能是浏览器对某些格式不支持 seeking
- 尝试用 MP4 格式（最佳兼容性）

## 十、进阶配置

### 1. 使用 HTTPS（可选）

HTTPS 仅在以下情况需要：
- 想用 PWA 把应用"安装"到平板主屏（更 App 感）
- 浏览器要求 HTTPS 才能使用某些 API

局域网内可用 mkcert 自签证书：
```bash
# 安装 mkcert
sudo apt install mkcert
mkcert -install

# 生成证书
cd /path/to/project
mkcert 192.168.1.100 localhost

# 配置 Caddyfile 反代（项目已自带 Caddyfile）
# 编辑 Caddyfile 添加你的域名/IP
```

### 2. 用 Nginx 反向代理（生产环境）

如果想用 80 端口（不带 :3000 后缀）：
```nginx
server {
    listen 80;
    server_name 192.168.1.100;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 大文件流式传输优化
    proxy_buffering off;
    proxy_request_buffering off;
}
```

### 3. 开机自启

**Linux (systemd)**：
```bash
sudo tee /etc/systemd/system/video-player.service <<EOF
[Unit]
Description=Family Video Player
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/project
Environment=NODE_ENV=production
ExecStart=/usr/bin/bun run start
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable video-player
sudo systemctl start video-player
```

**Windows**：用 nssm 或 任务计划程序
**macOS**：用 launchd

## 十一、相关文档

- [百度网盘视频接入方案](./BAIDU_PAN_SOLUTION.md) — 让播放器支持百度网盘视频
- [Android 打包指南](./ANDROID_PACKAGING.md) — 把网页打包成 Android APK
