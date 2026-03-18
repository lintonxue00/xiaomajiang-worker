-- ==========================================
-- D1 数据库初始化 SQL
-- ==========================================

-- 创建 accounts 表，存储已注册的账号信息
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    account_id TEXT,
    token_data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'active'
);

-- 创建索引以加速查询
CREATE INDEX IF NOT EXISTS idx_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_created_at ON accounts(created_at);
CREATE INDEX IF NOT EXISTS idx_status ON accounts(status);

-- 插入模拟数据（可选）
-- INSERT INTO accounts (email, account_id, token_data, status) VALUES
--     ('test@example.com', 'acc123', '{"type":"codex","email":"test@example.com"}', 'active');
