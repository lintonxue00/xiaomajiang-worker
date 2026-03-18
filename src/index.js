// ==========================================
// Cloudflare Worker 主入口
// ==========================================

import { runRegistration } from './registrar.js';
import {
    saveAccount,
    getAllAccounts,
    getAllTokenData,
    deleteAccount,
    getStats,
} from './database.js';

const corsHeaders = Object.freeze({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
});

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (path.startsWith('/api/')) {
            if (request.method === 'OPTIONS') {
                return new Response(null, { headers: corsHeaders });
            }
            return handleApi(request, env, ctx);
        }

        if (env.ASSETS) {
            return env.ASSETS.fetch(request);
        }

        return new Response('Static assets binding "ASSETS" is not configured.', {
            status: 500,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
            },
        });
    },
};

async function handleApi(request, env, ctx) {
    const path = new URL(request.url).pathname;

    try {
        if (path === '/api/accounts' && request.method === 'GET') {
            const db = requireDb(env);
            const [accounts, stats] = await Promise.all([
                getAllAccounts(db),
                getStats(db),
            ]);

            return jsonResponse({ accounts, stats });
        }

        if (path === '/api/register' && request.method === 'POST') {
            const db = requireDb(env);
            const logs = [];
            const logger = (message) => {
                logs.push(message);
            };

            const result = await runRegistration(logger);
            const tokenData = JSON.parse(result);
            const email = tokenData.email;
            const accountId = tokenData.account_id;

            await saveAccount(db, email, result, accountId);

            return jsonResponse({
                success: true,
                email,
                accountId,
                logs,
            });
        }

        if (/^\/api\/accounts\/\d+$/.test(path) && request.method === 'DELETE') {
            const db = requireDb(env);
            const id = Number.parseInt(path.split('/').pop(), 10);
            await deleteAccount(db, id);
            return jsonResponse({ success: true });
        }

        if (path === '/api/export/zip' && request.method === 'GET') {
            return exportZip(env);
        }

        return jsonResponse({ error: 'Not Found' }, { status: 404 });
    } catch (error) {
        console.error('API Error:', error);

        return jsonResponse(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}

function requireDb(env) {
    if (!env.DB) {
        throw new Error('D1 绑定 DB 未配置，请先在 wrangler.toml 中绑定数据库。');
    }

    return env.DB;
}

async function exportZip(env) {
    const db = requireDb(env);
    const tokenDataList = await getAllTokenData(db);

    if (tokenDataList.length === 0) {
        return jsonResponse({ error: '没有可导出的账号数据' }, { status: 400 });
    }

    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const exportedAt = Date.now();

    for (const item of tokenDataList) {
        const email = String(item.email || 'unknown').trim();
        const safeEmail = email.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filename = `token_${safeEmail}_${exportedAt}.json`;
        zip.file(filename, item.token_data);
    }

    const zipBuffer = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });

    return new Response(zipBuffer, {
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="accounts_${exportedAt}.zip"`,
            'Cache-Control': 'no-cache',
        },
    });
}

function jsonResponse(data, init = {}) {
    const { status = 200, headers = {}, ...responseInit } = init;

    return new Response(JSON.stringify(data, null, 2), {
        status,
        ...responseInit,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...corsHeaders,
            ...headers,
        },
    });
}
