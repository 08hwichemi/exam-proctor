/* =====================================================================
 * 접속 설정 — Supabase(스마트보드 프로젝트)로 접속 암호를 확인합니다.
 * anonKey 는 공개용 키입니다(브라우저에 들어가는 것이 정상). 암호는 서버에만 있습니다.
 * url 을 비우면 암호 확인 없이 바로 열립니다(로컬 테스트용).
 * ===================================================================== */
window.PROCTOR_AUTH = {
  url: 'https://pqreeimkjnphupqqwiqo.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxcmVlaW1ram5waHVwcXF3aXFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMjkxNjMsImV4cCI6MjEwNTkwNTE2M30.WipN_7_dmyd7jfPKBL2o-bzJ5vkOV-DOetu5ts9AreY',
  // 스마트보드 관리자 로그인 이메일 규칙 (스마트보드의 teacher_login_email 과 같아야 함)
  adminEmailDomain: '@smartboard.local',
};
