# Scripts

这个目录存放仓库级辅助脚本，主要用于本地开发、构建部署产物，以及处理可选的 mini-services / Python runtime。

## 主要脚本

- `dev.sh`：本地开发入口。安装依赖、启动 Next.js 开发服务器，并在存在 `mini-services/` 时尝试一并启动。
- `build.sh`：构建部署产物。执行 `bun run build`，收集 `standalone` 输出、静态资源、可选 mini-services 与 Python runtime。
- `start.sh`：部署环境启动入口。启动打包后的 Next.js 服务、可选 mini-services，以及前置的 Caddy。
- `python-runtime-build.sh`：当仓库含 Python 源码或依赖清单时，把 Python 运行时依赖固化到部署产物中。
- `mini-services-install.sh`：为 `mini-services/` 下的子项目批量安装依赖。
- `mini-services-build.sh`：批量构建 `mini-services/` 子项目到部署目录。
- `mini-services-start.sh`：启动构建后的 mini-services，并负责进程清理。

## 常见用法

```bash
# 本地开发
./scripts/dev.sh

# 快速本地检查（lint + typecheck）
bun run check

# 提交/推送前完整验证（lint + typecheck + test + build）
./scripts/verify.sh

# 仅构建 Web 应用
bun run build

# 构建完整部署包（含脚本编排）
BUILD_ID=local ./scripts/build.sh
```

## 约定

- 脚本默认以仓库根目录作为 `PROJECT_DIR`，也支持通过环境变量覆盖。
- 运行时生成的 `*.pid` 和 `mini-service-*.log` 文件会写入 `scripts/`，并已加入 `.gitignore`。
- 如果项目没有 `mini-services/` 或 Python 代码，相关步骤会自动跳过。