# 阿里云香港轻量服务器部署指南

这份指南适合第一版小范围分享使用：朋友通过公网链接访问白板网页，你自己的 AI API key 保存在服务器环境变量中，不进入前端和 GitHub。

## 1. 购买服务器

推荐：

- 地域：香港
- 产品：阿里云轻量应用服务器
- 系统：Ubuntu 22.04 LTS 或 Ubuntu 24.04 LTS
- 配置：2 核 2GB 起步
- 开放端口：22、80、443

香港节点通常不需要 ICP 备案即可用域名访问，适合先快速上线。若后续迁到中国大陆服务器并绑定域名，通常需要先完成 ICP 备案。

## 2. 登录并安装依赖

```bash
ssh root@你的服务器IP

apt update
apt install -y git nginx curl

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

corepack enable
corepack prepare pnpm@latest --activate
npm install -g pm2
```

确认版本：

```bash
node -v
pnpm -v
pm2 -v
nginx -v
```

## 3. 拉取项目

```bash
mkdir -p /srv/whiteboard
cd /srv/whiteboard

git clone https://github.com/GaoGuWei/whiteboard-page.git app
cd app
git switch main
```

如果要部署开发分支：

```bash
git switch feature/new-whiteboard-page
```

## 4. 配置环境变量

```bash
cp .env.example .env
nano .env
```

建议服务器 `.env` 内容：

```bash
PORT=3000
VITE_APP_MODE=cloud
IMAGE_DIR=/srv/whiteboard/images
UPLOAD_DIR=/srv/whiteboard/uploads
UPLOAD_TTL_HOURS=24

AI_BASE_URL=https://api.apiyi.com/v1
YI_API_KEY=你的真实密钥
OPENAI_MODEL=gpt-4.1-mini
GEOMETRY_MODEL=gpt-4.1-mini
AI_REQUEST_TIMEOUT_MS=240000

BASIC_AUTH_USER=whiteboard
BASIC_AUTH_PASSWORD=换成一个足够长的访问密码
```

创建图片目录：

```bash
mkdir -p /srv/whiteboard/images
mkdir -p /srv/whiteboard/uploads
```

把需要给朋友使用的题目截图上传到 `/srv/whiteboard/images`。例如从本机上传：

```bash
scp /path/to/images/*.png root@你的服务器IP:/srv/whiteboard/images/
```

## 5. 构建并启动

```bash
pnpm install
pnpm run check
pnpm run build

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` 会输出一行需要复制执行的命令，按提示执行一次即可让服务随服务器重启自动启动。

检查服务：

```bash
pm2 status
curl -I http://127.0.0.1:3000
```

## 6. 配置 Nginx 反向代理

新建配置：

```bash
nano /etc/nginx/sites-available/whiteboard-page
```

如果暂时只用服务器 IP：

```nginx
server {
    listen 80;
    server_name _;

    client_max_body_size 120m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用：

```bash
ln -s /etc/nginx/sites-available/whiteboard-page /etc/nginx/sites-enabled/whiteboard-page
nginx -t
systemctl reload nginx
```

访问：

```text
http://你的服务器IP
```

浏览器会弹出用户名和密码，填写 `.env` 中的 `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`。

## 7. 绑定域名和 HTTPS

如果你有域名，把域名 A 记录解析到服务器 IP。然后把 Nginx `server_name _;` 改成你的域名：

```nginx
server_name your-domain.com;
```

安装 HTTPS 证书：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

按提示选择自动跳转 HTTPS。

## 8. 更新部署

以后服务器更新代码，建议按下面顺序做。先在本地确认代码，再推送 GitHub，最后到服务器拉取和重启。

### 8.1 本地提交并推送 GitHub

确认当前分支：

```bash
cd /Users/gao/VSCodeSpace/white_board
git branch --show-current
git status --short
```

当前云端试用版部署的是 `feature/new-whiteboard-page` 时，提交并推送：

```bash
pnpm run check
VITE_APP_MODE=cloud pnpm run build

git add .
git commit -m "Update cloud image source workflow"
git push origin feature/new-whiteboard-page
```

注意：不要提交 `.env`、`.env.local`、`.whiteboard-uploads/`、`dist/`、`node_modules/`。这些文件和目录已在 `.gitignore` 中排除。

### 8.2 服务器拉取代码并检查配置

登录服务器：

```bash
ssh root@你的服务器IP
cd /srv/whiteboard/app
git branch --show-current
git status --short
```

如果服务器部署的是功能分支：

```bash
git switch feature/new-whiteboard-page
git pull origin feature/new-whiteboard-page
```

检查服务器 `.env`：

```bash
grep -E '^(PORT|VITE_APP_MODE|IMAGE_DIR|UPLOAD_DIR|UPLOAD_TTL_HOURS|AI_BASE_URL|OPENAI_MODEL|GEOMETRY_MODEL|AI_REQUEST_TIMEOUT_MS|BASIC_AUTH_USER)=' .env
test -n "$(grep '^YI_API_KEY=' .env | cut -d= -f2-)" && echo "YI_API_KEY is set"
```

云端建议值：

```bash
PORT=3000
VITE_APP_MODE=cloud
IMAGE_DIR=/srv/whiteboard/images
UPLOAD_DIR=/srv/whiteboard/uploads
UPLOAD_TTL_HOURS=24
AI_BASE_URL=https://api.apiyi.com/v1
OPENAI_MODEL=gpt-4.1-mini
GEOMETRY_MODEL=gpt-4.1-mini
AI_REQUEST_TIMEOUT_MS=240000
BASIC_AUTH_USER=whiteboard
```

确认目录存在：

```bash
mkdir -p /srv/whiteboard/images /srv/whiteboard/uploads
ls -lh /srv/whiteboard/images
ls -ld /srv/whiteboard/uploads
```

### 8.3 构建并重启

```bash
cd /srv/whiteboard/app
pnpm install
pnpm run check
pnpm run build
pm2 restart whiteboard-page --update-env
```

`VITE_APP_MODE` 是前端构建时变量，修改后需要重新执行 `pnpm run build`。`IMAGE_DIR`、`UPLOAD_DIR` 和 API key 是后端运行时变量，修改后需要 `pm2 restart whiteboard-page --update-env`。

如果是第一次用 PM2 启动：

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### 8.4 云端验证

在服务器上验证：

```bash
pm2 status
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1:3000/api/assets
```

如果启用了 Basic Auth，公网访问时浏览器会要求输入用户名和密码；服务器本机 `curl` 也可能返回 `401 Authentication required`，这代表访问保护生效，不是服务故障。

在浏览器验证：

```text
http://你的服务器IP
```

重点测试：

- 页面能打开并触发 Basic Auth。
- 图片素材页能看到服务器示例素材，或显示空目录提示。
- 点击“图片 / 文件夹”选择用户电脑图片后能上传。
- 上传图片可拖入白板，能进入风险校验和逐字稿生成。
- 生成失败时查看 `pm2 logs whiteboard-page --lines 100`。

## 9. 常见问题

- 访问页面 401：Basic Auth 正常工作，输入 `.env` 中的用户名和密码。
- 页面打开但没有图片：确认图片已经上传到 `IMAGE_DIR`，并且扩展名是 `.png`、`.jpg` 或 `.jpeg`。
- 用户选择自己电脑图片：页面会把图片上传到服务器 `UPLOAD_DIR` 下的临时目录；如果上传失败，检查 Nginx `client_max_body_size` 和服务器磁盘空间。
- 多次重新生成后出现 502：通常是 Nginx 代理超时、AI 路由长时间未返回，或 Node 进程在生成时重启。先确认 Nginx 配置包含 `proxy_read_timeout 300s;`，然后执行 `nginx -t && systemctl reload nginx`，再检查 `pm2 logs whiteboard-page --lines 200` 和 `/var/log/nginx/error.log`。
- 页面报 `/api/select-folder` 400：请更新到包含 Linux 兼容修复的最新代码并重新构建；云端不会弹出本机文件夹选择窗口，会使用服务器 `.env` 中的 `IMAGE_DIR`。
- AI 不生成真实内容：检查 `.env` 中 `YI_API_KEY` 是否正确，使用 `pm2 logs whiteboard-page` 查看后端日志。
- 朋友无法访问：检查阿里云防火墙/安全组是否开放 80 和 443，Nginx 是否正在运行。
- 想移除访问密码：删除 `.env` 中 `BASIC_AUTH_USER` 和 `BASIC_AUTH_PASSWORD` 后重启 PM2；不建议公开分享时这样做。
