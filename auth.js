/* ================================================================
   PITCHLY — auth.js
   Client Supabase + fonctions d'auth et de profil, partagés par
   index.html, app.html et compte.html.
   ================================================================ */

const SUPABASE_URL = 'https://evygjcmaxmnfusrvbjkk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_u7T90UhMnJsLSTK9yErA8w_VpT7NfGk';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;

async function getSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) currentUser = session.user;
  return session;
}

async function signInWithGoogle(redirectTo) {
  await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo || window.location.href },
  });
}

async function signInWithEmailLink(email, redirectTo) {
  return supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo || window.location.href },
  });
}

async function handleLogout(afterHref) {
  await supabaseClient.auth.signOut();
  currentUser = null;
  window.location.href = afterHref || 'index.html';
}

async function getProfile() {
  const { data } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle();
  return data;
}

async function saveProfile(fields) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert({ id: currentUser.id, ...fields })
    .select()
    .single();
  if (error) throw error;
  return data;
}
