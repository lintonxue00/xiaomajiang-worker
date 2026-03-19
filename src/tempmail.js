// ==========================================
// Tempmail.lol API (v2)
// ==========================================

const TEMPMAIL_BASE = "https://api.tempmail.lol/v2";

/**
 * 创建 Tempmail.lol 邮箱并获取 token
 */
async function createInbox() {
    try {
        const response = await fetch(`${TEMPMAIL_BASE}/inbox/create`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });

        if (response.status !== 200 && response.status !== 201) {
            const errorText = await response.text();
            console.error(`[Error] Tempmail.lol 请求失败，状态码: ${response.status}，响应: ${errorText}`);
            return { email: '', token: '' };
        }

        const data = await response.json();
        const email = String(data.address || '').trim();
        const token = String(data.token || '').trim();

        if (!email || !token) {
            console.error('[Error] Tempmail.lol 返回数据不完整');
            return { email: '', token: '' };
        }

        return { email, token };
    } catch (e) {
        console.error(`[Error] 创建 Tempmail.lol 邮箱出错: ${e.message}`);
        return { email: '', token: '' };
    }
}

/**
 * 获取收件箱邮件
 */
async function getInbox(token) {
    try {
        const response = await fetch(`${TEMPMAIL_BASE}/inbox?token=${encodeURIComponent(token)}`, {
            headers: { 'Accept': 'application/json' },
        });

        if (response.status !== 200) {
            return null;
        }

        return await response.json();
    } catch {
        return null;
    }
}

/**
 * 轮询获取 OpenAI 验证码
 */
async function getOaiCode(token, email, logger) {
    const seenIds = new Set();

    logger(`[*] 正在等待邮箱 ${email} 的验证码...`);

    for (let i = 0; i < 40; i++) {
        logger('.', true);

        const data = await getInbox(token);

        if (data === null || (typeof data === 'object' && Object.keys(data).length === 0)) {
            await sleep(3000);
            continue;
        }

        const emailList = Array.isArray(data.emails) ? data.emails : [];

        for (const msg of emailList) {
            if (!msg || typeof msg !== 'object') continue;

            const msgDate = msg.date;
            if (!msgDate || seenIds.has(msgDate)) continue;
            seenIds.add(msgDate);

            const sender = String(msg.from || '').toLowerCase();
            const subject = String(msg.subject || '');
            const body = String(msg.body || '');
            const html = String(msg.html || '');

            const content = `${sender}\n${subject}\n${body}\n${html}`;

            if (!sender.includes('openai') && !content.toLowerCase().includes('openai')) {
                continue;
            }

            // 检查各种可能的验证码格式
            const codeMatch = content.match(/(?<!\d)(\d{6})(?!\d)/);
            if (codeMatch) {
                logger(`\n[*] 抓到验证码: ${codeMatch[1]}`);
                return codeMatch[1];
            }
        }

        await sleep(3000);
    }

    logger('\n[Error] 超时，未收到验证码');
    return '';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export { createInbox, getOaiCode };
