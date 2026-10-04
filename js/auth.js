/* =====================================================================
 * 접속 암호 확인 — Supabase REST 만 사용 (라이브러리 없음)
 *   check(pw)                    : 서버에서 비교, 맞음/틀림만 받음
 *   status()                     : 암호가 설정되어 있는지
 *   adminSetPassword(name, pw, n): 스마트보드 관리자 계정으로 로그인해 접속 암호를 바꿈
 * 암호와 해시는 브라우저로 내려오지 않습니다. (docs/supabase-access.sql 참고)
 * ===================================================================== */
(function (root) {
  'use strict';
  const cfg = root.PROCTOR_AUTH || {};
  const configured = !!(cfg.url && cfg.anonKey);

  class AuthError extends Error {
    constructor(message, kind) { super(message); this.kind = kind || 'server'; }
  }

  async function call(path, body, token, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 15000);
    let res;
    try {
      res = await fetch(cfg.url + path, {
        method: 'POST',
        headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + (token || cfg.anonKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new AuthError(e.name === 'AbortError' ? '서버 응답이 없습니다. 잠시 뒤 다시 해 주세요.' : '서버에 연결할 수 없습니다. 인터넷 연결이나 학교망 차단 여부를 확인해 주세요.', 'network');
    }
    clearTimeout(timer);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error_description || data.msg || data.error)) || `서버 오류 (${res.status})`;
      // Supabase 가 멈춰 있을 때(무료 요금제 7일 미사용) 흔한 상태
      throw new AuthError(res.status === 540 || res.status === 503 ? '서버가 일시정지 상태입니다. Supabase 대시보드에서 프로젝트를 다시 켜 주세요.' : String(msg), res.status === 400 || res.status === 401 || res.status === 403 ? 'rejected' : 'server');
    }
    return data;
  }

  const rpc = (name, args, token) => call('/rest/v1/rpc/' + name, args, token);

  async function status() { return rpc('proctor_status', {}); }

  async function check(password) {
    const ok = await rpc('proctor_check', { p_password: String(password == null ? '' : password) });
    return ok === true;
  }

  // 스마트보드 관리자 이름 + 비밀번호로 로그인 → 접속 암호 변경 → 로그아웃
  async function adminSetPassword(name, password, newPassword) {
    const email = String(name || '').trim().toLowerCase() + (cfg.adminEmailDomain || '@smartboard.local');
    let session;
    try {
      session = await call('/auth/v1/token?grant_type=password', { email, password: String(password || '') });
    } catch (e) {
      if (e.kind === 'rejected') throw new AuthError('스마트보드 이름 또는 비밀번호가 맞지 않습니다.', 'rejected');
      throw e;
    }
    const token = session && session.access_token;
    if (!token) throw new AuthError('로그인 응답이 올바르지 않습니다.', 'server');
    try {
      await rpc('proctor_set_password', { p_new: String(newPassword || '') }, token);
    } finally {
      try { await call('/auth/v1/logout', {}, token, 5000); } catch (e) { /* 무시 */ }
    }
  }

  root.ProctorAuth = { configured, status, check, adminSetPassword, AuthError };
})(window);
