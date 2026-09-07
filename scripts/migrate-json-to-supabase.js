const fs = require('fs');
const path = require('path');
const { saveState, defaultStoreId } = require('../api/supabase-store');

const input = process.argv[2] || path.join(__dirname, '..', 'date', 'db.json');
const storeId = process.argv[3] || defaultStoreId();
if (!fs.existsSync(input)) throw new Error(`Arquivo não encontrado: ${input}`);
const state = JSON.parse(fs.readFileSync(input, 'utf8'));
saveState(state, storeId).then(() => console.log(`Estado migrado para a loja ${storeId}: ${input}`)).catch(error => { console.error(error); process.exit(1); });
