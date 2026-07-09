-- ================================================================
-- PITCHLY — schéma Supabase
-- À exécuter une fois dans le SQL Editor du projet Supabase
-- (Dashboard → SQL Editor → New query → coller → Run).
-- ================================================================

-- PROFIL — une ligne par utilisateur, liée à auth.users.
-- Regroupe les infos de compte (nom/date de naissance/téléphone) et le
-- profil métier (secteur/offre/panier).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nom text,
  date_naissance date,
  telephone text,
  secteur text,
  offre text,
  panier text,
  quota_used int not null default 0,
  quota_month text not null default to_char(now(), 'YYYY-MM'),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

-- SCRIPTS SAUVEGARDÉS — plusieurs lignes par utilisateur.
create table if not exists public.saved_scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nom text,
  canal text not null,
  situation text not null,
  texte text not null,
  outcome text, -- 'worked' | 'failed' | null — retour terrain de l'utilisateur
  created_at timestamptz not null default now()
);

alter table public.saved_scripts enable row level security;

create policy "saved_scripts: select own" on public.saved_scripts
  for select using (auth.uid() = user_id);

create policy "saved_scripts: insert own" on public.saved_scripts
  for insert with check (auth.uid() = user_id);

create policy "saved_scripts: update own" on public.saved_scripts
  for update using (auth.uid() = user_id);

create policy "saved_scripts: delete own" on public.saved_scripts
  for delete using (auth.uid() = user_id);

-- OBJECTIONS TRAITÉES — une ligne par objection saisie + réponse générée.
create table if not exists public.saved_objections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  objection text not null,
  reponse text not null,
  outcome text, -- 'worked' | 'failed' | null — retour terrain de l'utilisateur
  created_at timestamptz not null default now()
);

alter table public.saved_objections enable row level security;

create policy "saved_objections: select own" on public.saved_objections
  for select using (auth.uid() = user_id);

create policy "saved_objections: insert own" on public.saved_objections
  for insert with check (auth.uid() = user_id);

create policy "saved_objections: update own" on public.saved_objections
  for update using (auth.uid() = user_id);

create policy "saved_objections: delete own" on public.saved_objections
  for delete using (auth.uid() = user_id);

-- ================================================================
-- MIGRATION — à coller/exécuter si les tables ci-dessus existent déjà
-- dans ton projet Supabase (idempotent, sans risque à ré-exécuter).
-- ================================================================
alter table public.saved_scripts add column if not exists outcome text;
alter table public.saved_objections add column if not exists outcome text;

drop policy if exists "saved_objections: update own" on public.saved_objections;
create policy "saved_objections: update own" on public.saved_objections
  for update using (auth.uid() = user_id);
