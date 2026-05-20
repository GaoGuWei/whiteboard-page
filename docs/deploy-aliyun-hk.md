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
IMAGE_DIR=/srv/whiteboard/images

AI_BASE_URL=https://api.apiyi.com/v1
YI_API_KEY=你的真实密钥
OPENAI_MODEL=gpt-4.1-mini

BASIC_AUTH_USER=whiteboard
BASIC_AUTH_PASSWORD=换成一个足够长的访问密码
```

创建图片目录：

```bash
mkdir -p /srv/whiteboard/images
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

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
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

以后服务器更新代码：

```bash
cd /srv/whiteboard/app
git pull
pnpm install
pnpm run build
pm2 restart whiteboard-page
```

## 9. 常见问题

- 访问页面 401：Basic Auth 正常工作，输入 `.env` 中的用户名和密码。
- 页面打开但没有图片：确认图片已经上传到 `IMAGE_DIR`，并且扩展名是 `.png`、`.jpg` 或 `.jpeg`。
- AI 不生成真实内容：检查 `.env` 中 `YI_API_KEY` 是否正确，使用 `pm2 logs whiteboard-page` 查看后端日志。
- 朋友无法访问：检查阿里云防火墙/安全组是否开放 80 和 443，Nginx 是否正在运行。
- 想移除访问密码：删除 `.env` 中 `BASIC_AUTH_USER` 和 `BASIC_AUTH_PASSWORD` 后重启 PM2；不建议公开分享时这样做。
