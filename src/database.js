// ==========================================
// D1 数据库操作模块
// ==========================================

const schemaStatements = [
    `
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            account_id TEXT,
            token_data TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            status TEXT DEFAULT 'active'
        )
    `,
    `CREATE INDEX IF NOT EXISTS idx_email ON accounts(email)`,
    `CREATE INDEX IF NOT EXISTS idx_created_at ON accounts(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_status ON accounts(status)`,
];

let schemaInitPromise = null;

async function ensureSchema(db) {
    if (!schemaInitPromise) {
        schemaInitPromise = (async () => {
            for (const statement of schemaStatements) {
                await db.prepare(statement).run();
            }
        })().catch((error) => {
            schemaInitPromise = null;
            throw error;
        });
    }

    await schemaInitPromise;
}

/**
 * 保存账号信息到 D1 数据库
 */
async function saveAccount(db, email, tokenData, accountId = '') {
    await ensureSchema(db);

    const tokenJson = typeof tokenData === 'string' ? tokenData : JSON.stringify(tokenData);
    const createdAt = new Date().toISOString();

    const sql = `
        INSERT INTO accounts (email, account_id, token_data, created_at, updated_at, status)
        VALUES (?, ?, ?, ?, ?, 'active')
    `;

    try {
        await db.prepare(sql)
            .bind(email, accountId, tokenJson, createdAt, createdAt)
            .run();

        const results = await db.prepare(
            'SELECT last_insert_rowid() as id'
        ).first();

        return results?.id;
    } catch (e) {
        console.error('保存账号失败:', e);
        throw e;
    }
}

/**
 * 获取所有账号信息
 */
async function getAllAccounts(db) {
    await ensureSchema(db);

    const sql = `
        SELECT id, email, account_id, created_at, updated_at, status
        FROM accounts
        ORDER BY created_at DESC
    `;

    const results = await db.prepare(sql).all();
    return results.results || [];
}

/**
 * 获取账号详细信息（包含 token_data）
 */
async function getAccountDetail(db, id) {
    await ensureSchema(db);

    const sql = `
        SELECT *
        FROM accounts
        WHERE id = ?
    `;

    const result = await db.prepare(sql).bind(id).first();
    return result;
}

/**
 * 获取所有账号的 token 数据（用于导出）
 */
async function getAllTokenData(db) {
    await ensureSchema(db);

    const sql = `
        SELECT id, email, token_data
        FROM accounts
        WHERE status = 'active'
        ORDER BY created_at DESC
    `;

    const results = await db.prepare(sql).all();
    return results.results || [];
}

/**
 * 删除账号
 */
async function deleteAccount(db, id) {
    await ensureSchema(db);

    const sql = `DELETE FROM accounts WHERE id = ?`;
    await db.prepare(sql).bind(id).run();
}

/**
 * 更新账号状态
 */
async function updateAccountStatus(db, id, status) {
    await ensureSchema(db);

    const sql = `
        UPDATE accounts
        SET status = ?, updated_at = ?
        WHERE id = ?
    `;
    const now = new Date().toISOString();
    await db.prepare(sql).bind(status, now, id).run();
}

/**
 * 获取账号统计信息
 */
async function getStats(db) {
    await ensureSchema(db);

    const totalSql = `SELECT COUNT(*) as total FROM accounts`;
    const activeSql = `SELECT COUNT(*) as active FROM accounts WHERE status = 'active'`;

    const [totalResult, activeResult] = await Promise.all([
        db.prepare(totalSql).first(),
        db.prepare(activeSql).first(),
    ]);

    return {
        total: totalResult?.total || 0,
        active: activeResult?.active || 0,
    };
}

export {
    ensureSchema,
    saveAccount,
    getAllAccounts,
    getAccountDetail,
    getAllTokenData,
    deleteAccount,
    updateAccountStatus,
    getStats,
};
