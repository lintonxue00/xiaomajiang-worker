// ==========================================
// OAuth 授权模块
// ==========================================

import { b64urlNoPad, sha256B64urlNoPad, randomState, pkceVerifier, decodeJwtSegment, jwtClaimsNoVerify, urlEncode } from './utils.js';

const AUTH_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_REDIRECT_URI = `http://localhost:1455/auth/callback`;
const DEFAULT_SCOPE = "openid email profile offline_access";

/**
 * 生成 OAuth 授权 URL
 */
async function generateOAuthUrl(
    redirectUri = DEFAULT_REDIRECT_URI,
    scope = DEFAULT_SCOPE
) {
    const state = randomState();
    const codeVerifier = pkceVerifier();
    const codeChallenge = await sha256B64urlNoPad(codeVerifier);

    const params = {
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'login',
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
    };

    const authUrl = `${AUTH_URL}?${urlEncode(params)}`;

    return {
        authUrl,
        state,
        codeVerifier,
        redirectUri,
    };
}

/**
 * 解析回调 URL
 */
function parseCallbackUrl(callbackUrl) {
    let candidate = callbackUrl.trim();
    if (!candidate) {
        return { code: '', state: '', error: '', errorDescription: '' };
    }

    // 处理各种 URL 格式
    if (!candidate.includes('://')) {
        if (candidate.startsWith('?')) {
            candidate = `http://localhost${candidate}`;
        } else if (/[\/\?#]/.test(candidate) || candidate.includes(':')) {
            candidate = `http://${candidate}`;
        } else if (candidate.includes('=')) {
            candidate = `http://localhost/?${candidate}`;
        }
    }

    const url = new URL(candidate);
    const queryParams = new URLSearchParams(url.search);
    const fragmentParams = new URLSearchParams(url.hash.slice(1));

    // 合并 fragment 和 query 参数
    for (const [key, value] of fragmentParams) {
        if (!queryParams.has(key) || !queryParams.get(key)) {
            queryParams.set(key, value);
        }
    }

    let code = queryParams.get('code') || '';
    let state = queryParams.get('state') || '';
    let error = queryParams.get('error') || '';
    let errorDescription = queryParams.get('error_description') || '';

    // 处理 hash 中的 code
    if (code && !state && code.includes('#')) {
        [code, state] = code.split('#', 2);
    }

    return {
        code: code.trim(),
        state: state.trim(),
        error: error.trim(),
        errorDescription: errorDescription.trim(),
    };
}

/**
 * 提交回调 URL 并交换 token
 */
async function submitCallbackUrl({
    callbackUrl,
    expectedState,
    codeVerifier,
    redirectUri = DEFAULT_REDIRECT_URI,
}) {
    const cb = parseCallbackUrl(callbackUrl);

    if (cb.error) {
        const desc = cb.errorDescription;
        throw new Error(`oauth error: ${cb.error}: ${desc}`.trim());
    }

    if (!cb.code) {
        throw new Error('callback url missing ?code=');
    }
    if (!cb.state) {
        throw new Error('callback url missing ?state=');
    }
    if (cb.state !== expectedState) {
        throw new Error('state mismatch');
    }

    const tokenResp = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
        },
        body: urlEncode({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code: cb.code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
        }),
    });

    if (!tokenResp.ok) {
        const text = await tokenResp.text();
        throw new Error(`token exchange failed: ${tokenResp.status}: ${text}`);
    }

    const tokenData = await tokenResp.json();

    const accessToken = String(tokenData.access_token || '').trim();
    const refreshToken = String(tokenData.refresh_token || '').trim();
    const idToken = String(tokenData.id_token || '').trim();
    const expiresIn = parseInt(tokenData.expires_in) || 0;

    const claims = jwtClaimsNoVerify(idToken);
    const email = String(claims.email || '').trim();
    const authClaims = claims['https://api.openai.com/auth'] || {};
    const accountId = String(authClaims.chatgpt_account_id || '').trim();

    const now = Math.floor(Date.now() / 1000);
    const expiredRfc3339 = new Date((now + expiresIn) * 1000).toISOString();
    const nowRfc3339 = new Date(now * 1000).toISOString();

    const config = {
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: accountId,
        last_refresh: nowRfc3339,
        email,
        type: 'codex',
        expired: expiredRfc3339,
    };

    return JSON.stringify(config);
}

export { generateOAuthUrl, submitCallbackUrl };
