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

const registrationStages = Object.freeze([
    { id: 'boot', label: '环境检查', progress: 8 },
    { id: 'mailbox', label: '临时邮箱', progress: 24 },
    { id: 'authorize', label: '授权注册', progress: 46 },
    { id: 'verify', label: '邮箱验证', progress: 68 },
    { id: 'workspace', label: '工作区配置', progress: 86 },
    { id: 'token', label: '令牌回收', progress: 96 },
]);

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
            return streamRegistration(env, ctx);
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

function streamRegistration(env, ctx) {
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    let currentStage = 'boot';
    let heartbeatCount = 0;
    let streamQueue = Promise.resolve();
    let closed = false;

    const writeChunk = async (payload) => {
        const event = {
            ...payload,
            ts: new Date().toISOString(),
        };
        await writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
    };

    const queueEvent = (payload) => {
        streamQueue = streamQueue
            .then(() => {
                if (!closed) {
                    return writeChunk(payload);
                }
            })
            .catch((error) => {
                console.error('Stream write error:', error);
            });

        return streamQueue;
    };

    const closeStream = async () => {
        if (closed) {
            return;
        }

        closed = true;
        await writer.close();
    };

    const job = (async () => {
        const logs = [];

        try {
            const db = requireDb(env);

            queueEvent({
                type: 'start',
                stage: currentStage,
                progress: getStageProgress(currentStage),
                message: '启动注册流程，正在建立服务端任务。',
            });

            const logger = (rawMessage, noNewline = false) => {
                if (noNewline && rawMessage === '.') {
                    heartbeatCount += 1;
                    queueEvent({
                        type: 'heartbeat',
                        stage: currentStage,
                        progress: getStageProgress(currentStage),
                        count: heartbeatCount,
                        message: `验证码轮询中，第 ${heartbeatCount} 次检查邮箱。`,
                    });
                    return;
                }

                const message = String(rawMessage || '').trim();
                if (!message) {
                    return;
                }

                logs.push(message);

                const nextStage = inferStageFromLog(message);
                if (nextStage && nextStage !== currentStage) {
                    currentStage = nextStage;
                    heartbeatCount = 0;
                    queueEvent({
                        type: 'stage',
                        stage: currentStage,
                        progress: getStageProgress(currentStage),
                        message: getStageLabel(currentStage),
                    });
                }

                queueEvent({
                    type: 'log',
                    stage: currentStage,
                    progress: getStageProgress(currentStage),
                    message,
                });
            };

            const result = await runRegistration(logger);
            await streamQueue;

            currentStage = 'token';
            queueEvent({
                type: 'stage',
                stage: currentStage,
                progress: getStageProgress(currentStage),
                message: '回调完成，准备落库保存账号。',
            });

            const tokenData = JSON.parse(result);
            const email = tokenData.email;
            const accountId = tokenData.account_id;
            await saveAccount(db, email, result, accountId);

            queueEvent({
                type: 'success',
                stage: currentStage,
                progress: 100,
                message: `注册完成，账号 ${email} 已写入数据库。`,
                email,
                accountId,
                logs,
            });

            await streamQueue;
        } catch (error) {
            await streamQueue;
            await writeChunk({
                type: 'error',
                stage: currentStage,
                progress: getStageProgress(currentStage),
                message: error instanceof Error ? error.message : '注册任务失败',
            });
        } finally {
            await closeStream();
        }
    })();

    ctx.waitUntil(job);

    return new Response(stream.readable, {
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
        },
    });
}

function inferStageFromLog(message) {
    const text = String(message || '').toLowerCase();

    if (text.includes('当前 ip')) {
        return 'boot';
    }
    if (text.includes('tempmail') || text.includes('邮箱与授权')) {
        return 'mailbox';
    }
    if (
        text.includes('device id') ||
        text.includes('sentinel') ||
        text.includes('提交注册表单') ||
        text.includes('生成密码') ||
        text.includes('提交密码')
    ) {
        return 'authorize';
    }
    if (text.includes('验证码') || text.includes('邮箱验证')) {
        return 'verify';
    }
    if (text.includes('账户创建') || text.includes('workspace') || text.includes('授权 cookie')) {
        return 'workspace';
    }
    if (text.includes('callback') || text.includes('redirect')) {
        return 'token';
    }

    return null;
}

function getStageProgress(stageId) {
    return registrationStages.find((stage) => stage.id === stageId)?.progress ?? 0;
}

function getStageLabel(stageId) {
    return registrationStages.find((stage) => stage.id === stageId)?.label ?? '处理中';
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
