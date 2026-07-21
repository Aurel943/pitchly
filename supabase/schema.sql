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

-- ================================================================
-- ENVOI RÉEL & DÉTECTION DES RÉPONSES
-- Pitchly ne se contente plus de rédiger : il envoie les séquences,
-- relance tout seul, et surtout MESURE ce qui obtient des réponses.
-- C'est cette donnée-là (quel message a fait répondre qui, et en
-- combien de temps) qu'un chatbot généraliste ne peut pas produire.
-- ================================================================

-- Un prospect qu'on veut contacter par email a besoin d'une adresse.
alter table public.prospects add column if not exists email text;

-- IDENTITÉ D'ENVOI — d'où partent les emails de cet utilisateur.
--   mode 'shared' : domaine mutualisé Pitchly, utilisable immédiatement,
--                   délivrabilité correcte mais pas excellente.
--   mode 'domain' : domaine de l'utilisateur vérifié chez Resend (SPF/DKIM),
--                   c'est ce qu'il faut viser dès qu'il envoie du volume.
-- Une seule identité par utilisateur pour l'instant (clé primaire = user_id).
create table if not exists public.sending_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'shared',        -- 'shared' | 'domain'
  from_name text,                              -- "Aurélien Potot"
  from_email text,                             -- adresse d'expédition effective
  reply_to_real text,                          -- vraie boîte du vendeur, où on relaie les réponses
  domain text,                                 -- domaine perso si mode='domain'
  resend_domain_id text,                       -- id du domaine chez Resend
  domain_status text default 'pending',        -- 'pending' | 'verified' | 'failed'
  created_at timestamptz not null default now()
);

alter table public.sending_identities enable row level security;

drop policy if exists "sending_identities: select own" on public.sending_identities;
create policy "sending_identities: select own" on public.sending_identities
  for select using (auth.uid() = user_id);
drop policy if exists "sending_identities: insert own" on public.sending_identities;
create policy "sending_identities: insert own" on public.sending_identities
  for insert with check (auth.uid() = user_id);
drop policy if exists "sending_identities: update own" on public.sending_identities;
create policy "sending_identities: update own" on public.sending_identities
  for update using (auth.uid() = user_id);

-- CAMPAGNE — une séquence effectivement lancée sur UN prospect.
-- reply_token : identifiant opaque qui sert d'adresse de réponse
-- (reply+<token>@<domaine inbound>). Quand le prospect répond, c'est
-- lui qui nous dit de quelle campagne il s'agit — c'est le mécanisme
-- qui permet de détecter les réponses sans accéder à la boîte mail.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete set null,
  sequence_id uuid references public.saved_sequences(id) on delete set null,
  nom text,
  canal text not null default 'email',
  destinataire text not null,                  -- email figé au lancement
  statut text not null default 'active',       -- 'active' | 'replied' | 'stopped' | 'done'
  reply_token text not null unique default encode(gen_random_bytes(9), 'hex'),
  replied_at timestamptz,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;

drop policy if exists "campaigns: select own" on public.campaigns;
create policy "campaigns: select own" on public.campaigns
  for select using (auth.uid() = user_id);
drop policy if exists "campaigns: insert own" on public.campaigns;
create policy "campaigns: insert own" on public.campaigns
  for insert with check (auth.uid() = user_id);
drop policy if exists "campaigns: update own" on public.campaigns;
create policy "campaigns: update own" on public.campaigns
  for update using (auth.uid() = user_id);
drop policy if exists "campaigns: delete own" on public.campaigns;
create policy "campaigns: delete own" on public.campaigns
  for delete using (auth.uid() = user_id);

create index if not exists campaigns_user_id_idx on public.campaigns(user_id);
create index if not exists campaigns_prospect_id_idx on public.campaigns(prospect_id);

-- ÉTAPES PLANIFIÉES — le contenu figé de chaque message et sa date d'envoi.
-- On fige le texte au lancement (plutôt que de le relire dans
-- saved_sequences.etapes au moment d'envoyer) : l'utilisateur doit pouvoir
-- modifier ou supprimer sa séquence sans changer ce qui est déjà programmé.
create table if not exists public.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position int not null,                       -- 0 = premier contact
  titre text,
  objet text,
  message text not null,
  send_at timestamptz not null,
  statut text not null default 'pending',      -- 'pending' | 'sent' | 'cancelled' | 'failed'
  sent_at timestamptz,
  provider_message_id text,
  erreur text,
  created_at timestamptz not null default now()
);

alter table public.campaign_steps enable row level security;

drop policy if exists "campaign_steps: select own" on public.campaign_steps;
create policy "campaign_steps: select own" on public.campaign_steps
  for select using (auth.uid() = user_id);
drop policy if exists "campaign_steps: insert own" on public.campaign_steps;
create policy "campaign_steps: insert own" on public.campaign_steps
  for insert with check (auth.uid() = user_id);
drop policy if exists "campaign_steps: update own" on public.campaign_steps;
create policy "campaign_steps: update own" on public.campaign_steps
  for update using (auth.uid() = user_id);

-- Index qui porte la requête du cron : les étapes à envoyer maintenant.
create index if not exists campaign_steps_due_idx
  on public.campaign_steps(statut, send_at);
create index if not exists campaign_steps_campaign_idx
  on public.campaign_steps(campaign_id, position);

-- ÉVÉNEMENTS — journal brut de ce qui s'est réellement passé.
-- C'est la matière première des stats ("tes accroches courtes font 14 %
-- de réponse") : on ne dérive jamais une stat d'un ressenti, seulement
-- de lignes écrites ici par le serveur.
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  step_id uuid references public.campaign_steps(id) on delete set null,
  type text not null,                          -- 'sent' | 'replied' | 'bounced' | 'complaint' | 'failed'
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table public.email_events enable row level security;

drop policy if exists "email_events: select own" on public.email_events;
create policy "email_events: select own" on public.email_events
  for select using (auth.uid() = user_id);

create index if not exists email_events_user_idx on public.email_events(user_id, type);
create index if not exists email_events_campaign_idx on public.email_events(campaign_id);

-- Désinscription : un prospect qui répond STOP ne doit plus jamais
-- recevoir d'email de ce vendeur, y compris via une future campagne.
alter table public.prospects add column if not exists opted_out_at timestamptz;
