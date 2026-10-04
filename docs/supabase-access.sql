-- =====================================================================
-- 시험 감독 배정 앱 접속 암호 (Supabase, 스마트보드 프로젝트 pqreeimkjnphupqqwiqo 에 적용됨)
--   - proctor_config   : 암호 해시(bcrypt)와 버전. API로는 어느 역할도 읽거나 쓸 수 없음
--   - proctor_attempts : 시도 기록(틀린 시도 10분 30회 제한용)
--   - proctor_check(p)         : 맞음/틀림만 돌려줌 (anon 호출 가능)
--   - proctor_set_password(p)  : 대시보드 SQL Editor 에서, 또는 스마트보드 관리자로 로그인한 호출로만
--   - proctor_status()         : 암호가 설정되어 있는지 (첫 화면 안내용)
-- 암호 바꾸기: Supabase 대시보드 → SQL Editor →  select proctor_set_password('새 암호');
-- =====================================================================
create table if not exists public.proctor_config (
  id int primary key default 1 check (id = 1),
  password_hash text,
  version int not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.proctor_attempts (
  at timestamptz not null default now(),
  ok boolean not null
);
alter table public.proctor_config enable row level security;
alter table public.proctor_attempts enable row level security;
revoke all on public.proctor_config from anon, authenticated;
revoke all on public.proctor_attempts from anon, authenticated;
insert into public.proctor_config (id) values (1) on conflict (id) do nothing;

create or replace function public.proctor_check(p_password text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  h text;
  fails int;
  v_ok boolean;
begin
  select count(*) into fails from public.proctor_attempts where not ok and at > now() - interval '10 minutes';
  if fails >= 30 then
    raise exception '틀린 시도가 너무 많습니다. 10분 뒤 다시 해 주세요.';
  end if;
  select password_hash into h from public.proctor_config where id = 1;
  v_ok := h is not null and p_password is not null and extensions.crypt(p_password, h) = h;
  insert into public.proctor_attempts (ok) values (v_ok);
  delete from public.proctor_attempts where at < now() - interval '1 day';
  return v_ok;
end;
$$;
revoke all on function public.proctor_check(text) from public;
grant execute on function public.proctor_check(text) to anon, authenticated;

create or replace function public.proctor_set_password(p_new text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  -- API(PostgREST)를 통한 호출이면 스마트보드 관리자여야 함. 대시보드 SQL Editor(postgres 역할)는 통과
  if session_user = 'authenticator' then
    perform public.assert_admin();
  end if;
  if p_new is null or length(btrim(p_new)) < 8 then
    raise exception '접속 암호는 8자 이상이어야 합니다';
  end if;
  update public.proctor_config
     set password_hash = extensions.crypt(btrim(p_new), extensions.gen_salt('bf', 10)),
         version = version + 1,
         updated_at = now()
   where id = 1;
end;
$$;
revoke all on function public.proctor_set_password(text) from public;
grant execute on function public.proctor_set_password(text) to authenticated;

create or replace function public.proctor_status()
returns jsonb
language sql security definer stable
set search_path = public
as $$
  select jsonb_build_object('configured', password_hash is not null, 'version', version, 'updated_at', updated_at)
  from public.proctor_config where id = 1;
$$;
revoke all on function public.proctor_status() from public;
grant execute on function public.proctor_status() to anon, authenticated;
