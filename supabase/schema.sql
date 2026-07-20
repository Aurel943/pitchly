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

-- PROSPECTS — mini-CRM : une ligne par prospect suivi par l'utilisateur.
-- Le contexte (secteur, statut, notes) s'accumule ici ; les scripts et
-- réponses aux objections générés pour ce prospect s'y rattachent via
-- prospect_id (voir plus bas), formant son historique d'échanges.
create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nom text not null,
  entreprise text,
  secteur text,
  statut text not null default 'nouveau', -- 'nouveau' | 'contacte' | 'en_discussion' | 'gagne' | 'perdu'
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.prospects enable row level security;

drop policy if exists "prospects: select own" on public.prospects;
create policy "prospects: select own" on public.prospects
  for select using (auth.uid() = user_id);
drop policy if exists "prospects: insert own" on public.prospects;
create policy "prospects: insert own" on public.prospects
  for insert with check (auth.uid() = user_id);
drop policy if exists "prospects: update own" on public.prospects;
create policy "prospects: update own" on public.prospects
  for update using (auth.uid() = user_id);
drop policy if exists "prospects: delete own" on public.prospects;
create policy "prospects: delete own" on public.prospects
  for delete using (auth.uid() = user_id);

create index if not exists prospects_user_id_idx on public.prospects(user_id);

-- Rattache scripts / réponses aux objections à un prospect (nullable :
-- toute génération sans prospect sélectionné reste possible comme avant).
-- ON DELETE SET NULL : supprimer un prospect ne supprime pas son historique,
-- il redevient juste "non rattaché".
alter table public.saved_scripts add column if not exists prospect_id uuid references public.prospects(id) on delete set null;
alter table public.saved_objections add column if not exists prospect_id uuid references public.prospects(id) on delete set null;

create index if not exists saved_scripts_prospect_id_idx on public.saved_scripts(prospect_id);
create index if not exists saved_objections_prospect_id_idx on public.saved_objections(prospect_id);

-- PROFIL DE STYLE APPRIS — synthèse (par Claude, via /api/refresh-style)
-- des patterns qui distinguent, pour cet utilisateur, ce qui a fonctionné
-- de ce qui n'a pas fonctionné (scripts + réponses aux objections notés
-- 👍/👎). Régénéré côté client dès que de nouveaux retours arrivent (voir
-- maybeRefreshStyleProfile dans auth.js) et réinjecté dans chaque
-- génération — style_profile_rated_count sert juste à savoir si de
-- nouveaux retours sont arrivés depuis la dernière synthèse.
alter table public.profiles add column if not exists style_profile text;
alter table public.profiles add column if not exists style_profile_rated_count int not null default 0;

-- SÉQUENCES SAUVEGARDÉES — une ligne par séquence de prospection générée
-- (premier contact + relances). Les étapes (titre/délai/objet/message) sont
-- stockées en JSON dans "etapes" plutôt qu'en lignes séparées : une séquence
-- est toujours lue, notée et supprimée d'un bloc, jamais étape par étape.
create table if not exists public.saved_sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nom text,
  canal text not null,
  objectif text not null,
  etapes jsonb not null,
  outcome text, -- 'worked' | 'failed' | null — retour terrain de l'utilisateur
  prospect_id uuid references public.prospects(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.saved_sequences enable row level security;

drop policy if exists "saved_sequences: select own" on public.saved_sequences;
create policy "saved_sequences: select own" on public.saved_sequences
  for select using (auth.uid() = user_id);
drop policy if exists "saved_sequences: insert own" on public.saved_sequences;
create policy "saved_sequences: insert own" on public.saved_sequences
  for insert with check (auth.uid() = user_id);
drop policy if exists "saved_sequences: update own" on public.saved_sequences;
create policy "saved_sequences: update own" on public.saved_sequences
  for update using (auth.uid() = user_id);
drop policy if exists "saved_sequences: delete own" on public.saved_sequences;
create policy "saved_sequences: delete own" on public.saved_sequences
  for delete using (auth.uid() = user_id);

create index if not exists saved_sequences_user_id_idx on public.saved_sequences(user_id);
create index if not exists saved_sequences_prospect_id_idx on public.saved_sequences(prospect_id);
