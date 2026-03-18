// ==========================================
// 核心注册逻辑
// ==========================================

import {
    generatePassword,
    decodeJwtSegment,
} from './utils.js';
import {
    createInbox,
    getOaiCode,
} from './tempmail.js';
import {
    generateOAuthUrl,
    submitCallbackUrl,
} from './oauth.js';

/**
 * 从 Set-Cookie 中提取首个键值对
 */
function parseSetCookie(cookieStr) {
    const firstPair = String(cookieStr || '').split(';', 1)[0].trim();
    if (!firstPair) {
        return null;
    }

    const separator = firstPair.indexOf('=');
    if (separator <= 0) {
        return null;
    }

    return {
        key: firstPair.slice(0, separator).trim(),
        value: firstPair.slice(separator + 1).trim(),
    };
}

/**
 * 将响应中的 Cookie 合并到本地 CookieJar
 */
function mergeResponseCookies(cookieJar, response) {
    let setCookies = [];

    if (typeof response.headers.getSetCookie === 'function') {
        setCookies = response.headers.getSetCookie();
    } else {
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            setCookies = [setCookie];
        }
    }

    for (const cookieStr of setCookies) {
        const parsed = parseSetCookie(cookieStr);
        if (parsed?.key) {
            cookieJar[parsed.key] = parsed.value;
        }
    }
}

/**
 * 构建带 Cookie 的请求头
 */
function buildCookieHeader(cookieJar) {
    return Object.entries(cookieJar)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
}

/**
 * 仅在 auth.openai.com 域名上复用会话 Cookie
 */
async function fetchWithCookies(url, init, cookieJar) {
    const headers = new Headers(init?.headers || {});
    const target = new URL(url);

    if (target.hostname === 'auth.openai.com') {
        const cookieHeader = buildCookieHeader(cookieJar);
        if (cookieHeader) {
            headers.set('cookie', cookieHeader);
        }
    }

    const response = await fetch(url, {
        ...init,
        headers,
    });

    mergeResponseCookies(cookieJar, response);
    return response;
}

/**
 * 对关键请求进行统一状态检查
 */
async function ensureOk(response, action) {
    if (response.ok) {
        return response;
    }

    const text = await response.text();
    const suffix = text ? ` - ${text}` : '';
    throw new Error(`${action}失败: ${response.status}${suffix}`);
}

/**
 * auth session 可能是 JWT，也可能是签名分段，逐段尝试解析
 */
function parseAuthSession(cookieValue) {
    const parts = String(cookieValue || '').split('.');

    for (const segment of [parts[1], parts[0]]) {
        const parsed = decodeJwtSegment(segment);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            return parsed;
        }
    }

    return {};
}

/**
 * 检查 IP 所在地
 */
async function checkLocation() {
    try {
        const response = await fetch('https://cloudflare.com/cdn-cgi/trace');
        const trace = await response.text();
        const match = trace.match(/^loc=(.+)$/m);
        const loc = match ? match[1].trim() : null;
        return loc;
    } catch {
        return null;
    }
}

/**
 * 执行一次完整的注册流程
 */
async function runRegistration(logger) {
    // 检查 IP 所在地
    const loc = await checkLocation();
    logger(`[*] 当前 IP 所在地: ${loc || 'Unknown'}`);

    if (loc === 'CN' || loc === 'HK') {
        throw new Error('检查代理哦w - 所在地不支持');
    }

    // 创建临时邮箱
    const { email, token: devToken } = await createInbox();
    if (!email || !devToken) {
        throw new Error('创建临时邮箱失败');
    }
    logger(`[*] 成功获取 Tempmail.lol 邮箱与授权: ${email}`);

    // 生成 OAuth URL
    const oauth = await generateOAuthUrl();

    // 模拟浏览器访问授权页面
    let cookieJar = {};

    const authResp = await fetchWithCookies(oauth.authUrl, {
        redirect: 'manual',
    }, cookieJar);

    if (authResp.status < 200 || authResp.status >= 400) {
        throw new Error(`初始化授权页失败: ${authResp.status}`);
    }

    const did = cookieJar['oai-did'];
    if (!did) {
        throw new Error('未能获取到 Device ID');
    }
    logger(`[*] Device ID: ${did}`);

    // Sentinel 请求
    const senResp = await fetch('https://sentinel.openai.com/backend-api/sentinel/req', {
        method: 'POST',
        headers: {
            'origin': 'https://sentinel.openai.com',
            'referer': 'https://sentinel.openai.com/backend-api/sentinel/frame.html?sv=20260219f9f6',
            'content-type': 'text/plain;charset=UTF-8',
        },
        body: JSON.stringify({
            p: '',
            id: did,
            flow: 'authorize_continue'
        }),
    });

    if (!senResp.ok) {
        throw new Error(`Sentinel 异常拦截，状态码: ${senResp.status}`);
    }

    const senData = await senResp.json();
    const senToken = senData.token;
    const sentinel = JSON.stringify({
        p: '',
        t: '',
        c: senToken,
        id: did,
        flow: 'authorize_continue'
    });

    // 提交注册表单
    const signupResp = await fetchWithCookies('https://auth.openai.com/api/accounts/authorize/continue', {
        method: 'POST',
        headers: {
            'referer': 'https://auth.openai.com/create-account',
            'accept': 'application/json',
            'content-type': 'application/json',
            'openai-sentinel-token': sentinel,
        },
        body: JSON.stringify({
            username: {
                value: email,
                kind: 'email'
            },
            screen_hint: 'signup'
        }),
    }, cookieJar);
    await ensureOk(signupResp, '提交注册表单');

    logger(`[*] 提交注册表单状态: ${signupResp.status}`);

    // 生成密码
    const password = generatePassword();
    logger(`[*] 生成密码: ${password}`);

    // 提交密码和邮箱
    const registerResp = await fetchWithCookies('https://auth.openai.com/api/accounts/user/register', {
        method: 'POST',
        headers: {
            'referer': 'https://auth.openai.com/create-account/password',
            'accept': 'application/json',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            password,
            username: email,
        }),
    }, cookieJar);
    await ensureOk(registerResp, '提交密码');
    logger(`[*] 提交密码状态: ${registerResp.status}`);

    // 发送邮箱验证码
    const otpResp = await fetchWithCookies('https://auth.openai.com/api/accounts/email-otp/send', {
        method: 'GET',
        headers: {
            'referer': 'https://auth.openai.com/create-account/password',
            'accept': 'application/json',
        },
    }, cookieJar);
    await ensureOk(otpResp, '发送邮箱验证码');
    logger(`[*] 验证码发送状态: ${otpResp.status}`);

    // 获取验证码
    const code = await getOaiCode(devToken, email, logger);
    if (!code) {
        throw new Error('未能获取到验证码');
    }

    // 验证验证码
    const codeResp = await fetchWithCookies('https://auth.openai.com/api/accounts/email-otp/validate', {
        method: 'POST',
        headers: {
            'referer': 'https://auth.openai.com/email-verification',
            'accept': 'application/json',
            'content-type': 'application/json',
        },
        body: JSON.stringify({ code }),
    }, cookieJar);
    await ensureOk(codeResp, '校验邮箱验证码');
    logger(`[*] 验证码校验状态: ${codeResp.status}`);

    // 创建账户
    const createAccountResp = await fetchWithCookies('https://auth.openai.com/api/accounts/create_account', {
        method: 'POST',
        headers: {
            'referer': 'https://auth.openai.com/about-you',
            'accept': 'application/json',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            name: 'Neo',
            birthdate: '2000-02-20'
        }),
    }, cookieJar);
    logger(`[*] 账户创建状态: ${createAccountResp.status}`);
    await ensureOk(createAccountResp, '创建账户');

    const authCookie = cookieJar['oai-client-auth-session'];
    if (!authCookie) {
        throw new Error('未能获取到授权 Cookie');
    }

    const authJson = parseAuthSession(authCookie);
    const workspaces = Array.isArray(authJson.workspaces) ? authJson.workspaces : [];

    if (!workspaces || workspaces.length === 0) {
        throw new Error('授权 Cookie 里没有 workspace 信息');
    }

    const workspaceId = String(workspaces[0]?.id || '').trim();
    if (!workspaceId) {
        throw new Error('无法解析 workspace_id');
    }

    // 选择 workspace
    const selectResp = await fetchWithCookies('https://auth.openai.com/api/accounts/workspace/select', {
        method: 'POST',
        headers: {
            'referer': 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent',
            'content-type': 'application/json',
        },
        body: JSON.stringify({ workspace_id: workspaceId }),
    }, cookieJar);
    await ensureOk(selectResp, '选择 workspace');

    const selectData = await selectResp.json();
    const continueUrl = String(selectData.continue_url || '').trim();
    if (!continueUrl) {
        throw new Error('workspace/select 响应里缺少 continue_url');
    }

    // 跟踪重定向链
    let currentUrl = continueUrl;
    for (let i = 0; i < 6; i++) {
        const finalResp = await fetchWithCookies(currentUrl, {
            redirect: 'manual',
        }, cookieJar);
        const location = finalResp.headers.get('Location') || '';

        if (finalResp.status < 300 || finalResp.status > 399) {
            break;
        }

        if (!location) break;

        const nextUrl = new URL(location, currentUrl).toString();
        if (nextUrl.includes('code=') && nextUrl.includes('state=')) {
            return await submitCallbackUrl({
                callbackUrl: nextUrl,
                codeVerifier: oauth.codeVerifier,
                redirectUri: oauth.redirectUri,
                expectedState: oauth.state,
            });
        }

        currentUrl = nextUrl;
    }

    throw new Error('未能在重定向链中捕获到最终 Callback URL');
}

export { runRegistration };
