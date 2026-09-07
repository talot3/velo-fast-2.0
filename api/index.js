const store = require('./supabase-store');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Velo-Store-Id, X-Velo-Agent-Token');
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error('JSON inválido')); } }); req.on('error', reject); });
}
function storeId(req) { return req.headers['x-velo-store-id'] || process.env.VELO_DEFAULT_STORE_ID || '15476'; }
function authorizedAgent(req) { return !process.env.VELO_AGENT_TOKEN || req.headers['x-velo-agent-token'] === process.env.VELO_AGENT_TOKEN; }
async function stores() {
  const { data, error } = await store.supabase.from('velo_stores').select('*').order('id');
  if (error) throw error;
  return (data || []).map(s => ({ id: s.id, name: s.name, cnpj: s.cnpj, phone: s.phone, active: s.active, expireDate: s.expire_date, terminalsAllowed: s.terminals_allowed, activeTerminals: s.active_terminals }));
}
async function getPrinter(state, payload) {
  let printer = (state.printers || []).find(p => String(p.id) === String(payload.printerId));
  if (!printer && payload.terminalId) { const t = (state.terminals || []).find(t => String(t.id) === String(payload.terminalId)); printer = (state.printers || []).find(p => String(p.id) === String(t?.printerId)); }
  return printer || (state.printers || [])[0];
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const path = new URL(req.url, 'https://velo.local').pathname;
  const sid = storeId(req);
  try {
    if (path === '/api/data' && req.method === 'GET') return json(res, 200, await store.getState(sid));
    if (path === '/api/save' && req.method === 'POST') {
      const incoming = await readBody(req); const current = await store.getState(sid);
      return json(res, 200, { success: true, data: await store.saveState({ ...current, ...incoming }, sid) });
    }
    if (path === '/api/push-sales' && req.method === 'POST') {
      const sales = await readBody(req); if (!Array.isArray(sales)) return json(res, 400, { error: 'Esperada uma lista de vendas.' });
      const current = await store.getState(sid); current.sales = [...(current.sales || []), ...sales.map(s => ({ ...s, synchronized: 1 }))];
      return json(res, 200, { success: true, count: sales.length, data: await store.saveState(current, sid) });
    }
    if (path === '/api/cancel-sale' && req.method === 'POST') {
      const body = await readBody(req); const current = await store.getState(sid); const before = current.sales || [];
      current.sales = before.filter(s => String(s.id) !== String(body.id));
      if (current.sales.length === before.length) return json(res, 200, { success: false, error: 'Venda não encontrada' });
      await store.saveState(current, sid); return json(res, 200, { success: true });
    }
    if (path === '/api/print' && req.method === 'POST') {
      const payload = await readBody(req); if (!payload.transactions?.length && typeof payload.text !== 'string') return json(res, 400, { error: 'Sem dados para imprimir.' });
      return json(res, 202, { success: true, queued: true, job: await store.enqueuePrint(payload, sid), message: 'Impressão encaminhada ao agente local.' });
    }
    if (path === '/api/print-test' && req.method === 'POST') {
      const body = await readBody(req); const state = await store.getState(sid); const printer = await getPrinter(state, body);
      if (!printer) return json(res, 404, { error: 'Impressora não encontrada.' });
      const payload = { printerId: printer.id, terminalId: 'PORTAL', operator: 'ADMIN', transactions: [{ productName: '*** TESTE DE IMPRESSORA ***', paymentMethod: 'TESTE', terminalId: 'PORTAL', operator: 'ADMIN', timestamp: new Date().toISOString() }] };
      return json(res, 202, { success: true, queued: true, job: await store.enqueuePrint(payload, sid), printerName: printer.name });
    }
    if (path === '/api/print/jobs/claim' && req.method === 'POST') {
      if (!authorizedAgent(req)) return json(res, 401, { error: 'Agente não autorizado.' });
      return json(res, 200, { success: true, job: await store.claimPrintJob(sid) });
    }
    if (path === '/api/print/jobs/finish' && req.method === 'POST') {
      if (!authorizedAgent(req)) return json(res, 401, { error: 'Agente não autorizado.' });
      const body = await readBody(req); if (!body.id) return json(res, 400, { error: 'ID do job ausente.' });
      await store.finishPrintJob(body.id, body.success === true, body.error || null); return json(res, 200, { success: true });
    }
    if (path === '/api/master/stores' && req.method === 'GET') return json(res, 200, { success: true, currentStoreId: sid, stores: await stores() });
    if (path === '/api/master/select-store' && req.method === 'POST') {
      const body = await readBody(req); const list = await stores(); const selected = list.find(s => String(s.id) === String(body.storeId));
      return selected ? json(res, 200, { success: true, currentStoreId: selected.id, storeName: selected.name }) : json(res, 404, { error: 'Loja não encontrada.' });
    }
    if (path === '/api/master/create-store' && req.method === 'POST') {
      const body = await readBody(req); if (!body.name || !body.cnpj) return json(res, 400, { error: 'Nome e CNPJ são obrigatórios.' });
      const list = await stores(); const id = String(Math.max(16000, ...list.map(s => Number(s.id) || 0)) + 1);
      const { data, error } = await store.supabase.from('velo_stores').insert({ id, name: String(body.name).toUpperCase(), cnpj: body.cnpj, phone: body.phone || 'N/A', expire_date: body.expireDate || '2027-12-31', terminals_allowed: Number(body.terminalsAllowed) || 5 }).select('*').single();
      if (error) throw error; return json(res, 200, { success: true, store: { ...data, expireDate: data.expire_date, terminalsAllowed: data.terminals_allowed } });
    }
    if (path === '/api/master/toggle-license' && req.method === 'POST') {
      const body = await readBody(req); const list = await stores(); const current = list.find(s => String(s.id) === String(body.storeId));
      if (!current) return json(res, 404, { error: 'Loja não encontrada.' });
      const { error } = await store.supabase.from('velo_stores').update({ active: body.active !== undefined ? Boolean(body.active) : !current.active }).eq('id', current.id); if (error) throw error;
      return json(res, 200, { success: true, store: { ...current, active: body.active !== undefined ? Boolean(body.active) : !current.active } });
    }
    return json(res, 404, { error: 'Rota não encontrada.' });
  } catch (error) { console.error(error); return json(res, 500, { error: error.message || 'Erro interno.' }); }
};
