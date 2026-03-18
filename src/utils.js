// ==========================================
// 基础工具函数
// ==========================================

/**
 * Base64 URL 安全编码（无填充）
 */
function b64urlNoPad(raw) {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * SHA256 并转换为 Base64 URL 安全编码
 */
async function sha256B64urlNoPad(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return b64urlNoPad(Array.from(new Uint8Array(hash)));
}

/**
 * 生成随机状态值
 */
function randomState(nbytes = 16) {
    const bytes = new Uint8Array(nbytes);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * 生成 PKCE verifier
 */
function pkceVerifier() {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * 解析 JWT payload（无需验证）
 */
function decodeJwtSegment(seg) {
    const raw = (seg || '').trim();
    if (!raw) return {};

    // 添加填充
    const pad = '='.repeat((4 - (raw.length % 4)) % 4);
    try {
        const decoded = atob(raw + pad);
        const arr = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
            arr[i] = decoded.charCodeAt(i);
        }
        return JSON.parse(new TextDecoder().decode(arr));
    } catch {
        return {};
    }
}

/**
 * 解析 JWT claims（无需验证）
 */
function jwtClaimsNoVerify(idToken) {
    if (!idToken || idToken.split('.').length < 2) return {};
    const parts = idToken.split('.');
    return decodeJwtSegment(parts[1]);
}

/**
 * 生成随机密码
 */
function generatePassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * 提取 6 位验证码
 */
function extractOtpCode(text) {
    const regex = /(?<!\d)(\d{6})(?!\d)/;
    const match = text.match(regex);
    return match ? match[1] : '';
}

/**
 * URL encode
 */
function urlEncode(dict) {
    return Object.entries(dict)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

export {
    b64urlNoPad,
    sha256B64urlNoPad,
    randomState,
    pkceVerifier,
    decodeJwtSegment,
    jwtClaimsNoVerify,
    generatePassword,
    extractOtpCode,
    urlEncode
};
