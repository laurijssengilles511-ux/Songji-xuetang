# 诵记学堂真实部署方案（兼顾中国大陆访问）

## 推荐架构

当前项目是静态前端 + Supabase 后端：

- 前端：HTML / CSS / JS / 图片 / 本地 vendor 依赖。
- 后端：Supabase Auth、Postgres、RLS、Edge Function `smart-create-cards`。

为了让中国大陆用户访问顺畅，推荐分两步走：

1. 近期上线：前端部署到国内 OSS/COS + 国内 CDN，后端继续使用 Supabase。
2. 稳定运营：如果大陆访问必须高可用，把 Auth、数据库、函数逐步迁到国内云（阿里云或腾讯云）。

原因：前端静态资源体积占大头，放国内 CDN 后首屏会明显稳定；但 Supabase 域名和 Edge Function 仍在境外网络上，国内链路无法完全保证。

## 上线前准备

### 1. 域名和备案

如果使用中国大陆 CDN 或大陆对象存储绑定自定义域名，域名通常需要先完成 ICP 备案。没有备案时，可以先用云厂商默认测试域名或境外托管做内部测试，但不建议作为面向大陆用户的正式入口。

### 2. Supabase 数据库

项目已包含正式 migration：

```text
supabase/migrations/20260708000000_initial_schema.sql
```

推送数据库：

```powershell
supabase db push
```

### 3. Supabase Edge Function

本地已经 link 到 Supabase 项目 `Songji-xuetang`。部署前需要登录 Supabase CLI：

```powershell
supabase login
supabase functions deploy smart-create-cards
```

部署后验证：

```powershell
Invoke-RestMethod `
  -Uri "https://ihvluwdbwqyhvgkzqbfw.supabase.co/functions/v1/smart-create-cards" `
  -Headers @{ apikey = "sb_publishable_k3-WCVKevyc4WgxPvFuRxg_8YO6QZOh"; Authorization = "Bearer sb_publishable_k3-WCVKevyc4WgxPvFuRxg_8YO6QZOh" }
```

可选：如果不想让用户在浏览器保存模型 Key，可以配置服务端兜底密钥：

```powershell
supabase secrets set DEEPSEEK_API_KEY=你的DeepSeek密钥
supabase secrets set OPENAI_API_KEY=你的OpenAI密钥
supabase secrets set ANTHROPIC_API_KEY=你的Anthropic密钥
```

面向大陆用户时，智慧创建默认建议优先使用 DeepSeek，OpenAI / Anthropic 从大陆网络通常不稳定。

## 打包静态前端

运行：

```powershell
.\scripts\package-static.ps1
```

脚本会生成 `dist/`，其中包含：

- 所有页面 `*.html`
- `app.js`、`srs.js`、`styles.css`
- `supabase-client.js`、`supabase-config.js`
- `assets/`、`data/`、`vendor/`

把 `dist/` 内容上传到对象存储桶根目录。

## 阿里云 OSS + CDN 发布要点

1. 创建 OSS Bucket，地域选中国大陆目标用户附近，例如华东 2（上海）或华南 1（深圳）。
2. 开启静态网站托管，默认首页设为 `index.html`。
3. 上传 `dist/` 中的全部内容。
4. 绑定已备案域名。
5. 接入阿里云 CDN，加速区域选择中国内地或全球。
6. CDN 回源指向 OSS 静态网站域名。
7. 配置 HTTPS 证书。
8. 缓存建议：
   - `*.html`：不缓存或 5 分钟。
   - `app.js`、`srs.js`、`styles.css`、`supabase-config.js`：5 分钟到 1 小时。
   - `assets/*`、`data/*`、`vendor/*`：7 天到 30 天。

发布新版本后，刷新 CDN：

- 刷新 `/*.html`
- 刷新 `/app.js`、`/styles.css`、`/srs.js`、`/supabase-client.js`、`/supabase-config.js`
- 数据或头像有变更时刷新对应目录。

## 腾讯云 COS + CDN 发布要点

1. 创建 COS Bucket，地域选中国大陆目标用户附近。
2. 开启静态网站功能，索引文档设为 `index.html`。
3. 上传 `dist/` 内容。
4. 绑定已备案域名。
5. 开启 CDN 加速并配置 HTTPS。
6. 缓存策略同上。

## 验收清单

发布后用大陆网络或云拨测检查：

- 首页、牌组、创建、我的页面可以打开。
- 浏览器控制台没有 404。
- 注册 / 登录成功。
- 创建自建牌组后 Supabase 表中有数据。
- 智慧创建健康检查通过。
- 使用 DeepSeek Key 生成卡片成功。
- 移动端页面没有明显遮挡或横向滚动。

## 当前状态

已完成：

- Supabase 数据库 migration 已推送。
- Supabase Edge Function `smart-create-cards` 已部署。
- 静态前端发布包可通过 `.\scripts\package-static.ps1` 生成到 `dist/`。

仍需在云厂商控制台完成：

- 上传 `dist/` 到阿里云 OSS 或腾讯云 COS。
- 绑定已备案域名。
- 开启 CDN 和 HTTPS。
