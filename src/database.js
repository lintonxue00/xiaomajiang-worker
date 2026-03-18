// ==========================================
// D1 数据库操作模块
// ==========================================

/**
 * 保存账号信息到 D1 数据库
 */
async function saveAccount(db, email, tokenData, accountId = '') {
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
    const sql = `DELETE FROM accounts WHERE id = ?`;
    await db.prepare(sql).bind(id).run();
}

/**
 * 更新账号状态
 */
async function updateAccountStatus(db, id, status) {
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
    saveAccount,
    getAllAccounts,
    getAccountDetail,
    getAllTokenData,
    deleteAccount,
    updateAccountStatus,
    getStats,
};
