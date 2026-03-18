# 小马姜 Worker + D1 账号管理系统

将 Python 自动注册脚本迁移到 Cloudflare Workers，配合 D1 数据库存储账号信息，支持网页管理和一键导出。

## 项目结构

```
worker/
├── src/
│   ├── index.js          # 主入口
│   ├── utils.js          # 工具函数
│   ├── tempmail.js       # Tempmail.lol API
│   ├── oauth.js          # OAuth 授权
│   ├── registrar.js      # 核心注册逻辑
│   └── database.js       # D1 数据库操作
├── db/
│   └── schema.sql        # 数据库表结构
├── public/
│   └── index.html        # 网页界面
├── wrangler.toml         # Cloudflare 配置
└── package.json
```

## 功能特性

- 自动注册 OpenAI 账号
- D1 数据库持久化存储
- 网页表格展示账号信息
- 一键导出 ZIP 压缩包（每个账单独立 JSON 文件）
- 实时注册日志输出
- 账号管理（删除、状态查询）

## 部署步骤

### 1. 安装依赖

```bash
cd worker
npm install
```

### 2. 配置 wrangler.toml

编辑 `wrangler.toml`，填入你的 Cloudflare 账户信息：

```toml
account_id = "你的账户ID"
zone_id = "你的ZoneID（如果绑定域名）"

[[d1_databases]]
binding = "DB"
database_name = "accounts_db"
database_id = "数据库ID"
```

### 3. 创建 D1 数据库

```bash
# 创建数据库
npx wrangler d1 create accounts_db

# 复制返回的 database_id 到 wrangler.toml
```

### 4. 初始化数据库表结构

```bash
npx wrangler d1 execute accounts_db --file=./db/schema.sql --remote
```

### 5. 部署 Worker

```bash
npx wrangler deploy
```

### 6. 插入模拟数据（可选）

```bash
npx wrangler d1 execute accounts_db --remote --command="INSERT INTO accounts (email, account_id, token_data, status) VALUES ('test@example.com', 'acc123', '{\"type\":\"codex\",\"email\":\"test@example.com\"}', 'active')"
```

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 网页首页 |
| `/api/accounts` | GET | 获取所有账号列表 |
| `/api/register` | POST | 注册新账号 |
| `/api/accounts/:id` | DELETE | 删除指定账号 |
| `/api/export/zip` | GET | 导出所有账号 ZIP 包 |

## 数据库结构

```sql
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    account_id TEXT,
    token_data TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    status TEXT DEFAULT 'active'
);
```

## 本地开发

```bash
npm run dev
```

访问 `http://localhost:8787` 查看网页界面。

## 注意事项

1. Worker 需要配置代理支持（推荐使用可用的代理服务）
2. 注册过程可能需要较长时间，请耐心等待
3. 请确保遵守 OpenAI 使用条款
4. D1 数据库有免费额度限制
