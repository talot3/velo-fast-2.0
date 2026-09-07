const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel.');
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const defaultStoreId = () => String(process.env.VELO_DEFAULT_STORE_ID || '15476');

async function getState(storeId = defaultStoreId()) {
  const { data, error } = await supabase
    .from('velo_app_state').select('state').eq('store_id', String(storeId)).maybeSingle();
  if (error) throw error;
  return data?.state || { products: [], groups: [], subgroups: [], paymentMethods: [], printers: [], terminals: [], sales: [], cash: { isOpen: false, sales: [] }, versions: [], currentVersion: '1.0.0' };
}

async function saveState(state, storeId = defaultStoreId()) {
  const { error } = await supabase.from('velo_app_state').upsert({
    store_id: String(storeId), state, updated_at: new Date().toISOString()
  }, { onConflict: 'store_id' });
  if (error) throw error;
  return state;
}

async function enqueuePrint(payload, storeId = defaultStoreId()) {
  const { data, error } = await supabase.from('velo_print_jobs').insert({
    store_id: String(storeId), payload, status: 'pending'
  }).select('id, status, created_at').single();
  if (error) throw error;
  return data;
}

async function claimPrintJob(storeId = defaultStoreId()) {
  const { data, error } = await supabase.rpc('velo_claim_print_job', { p_store_id: String(storeId) });
  if (error) throw error;
  return data?.[0] || null;
}

async function finishPrintJob(id, ok, errorMessage = null) {
  const { error } = await supabase.from('velo_print_jobs').update({
    status: ok ? 'printed' : 'failed', completed_at: new Date().toISOString(), error: errorMessage
  }).eq('id', id).eq('status', 'processing');
  if (error) throw error;
}

module.exports = { supabase, defaultStoreId, getState, saveState, enqueuePrint, claimPrintJob, finishPrintJob };
