const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { exec } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const PORT = 8080;
const DATE_DIR = path.join(__dirname, 'date');
if (!fs.existsSync(DATE_DIR)) {
    fs.mkdirSync(DATE_DIR, { recursive: true });
}
const DB_FILE = path.join(DATE_DIR, 'db.json');

// --- CONTROLE DE LOJAS E LICENÇAS (MULTI-LOJAS / ADM MASTER) ---
const LICENCAS_FILE = path.join(DATE_DIR, 'licencas.json');
let storesList = [];
let currentStoreId = "15476"; // Inicializada com a primeira loja
const activeDatabases = {};

function loadStoresList() {
    if (fs.existsSync(LICENCAS_FILE)) {
        try {
            storesList = JSON.parse(fs.readFileSync(LICENCAS_FILE, 'utf8'));
        } catch (e) {
            console.error("Erro ao ler licencas.json:", e);
        }
    }
    
    if (!storesList || storesList.length === 0) {
        storesList = [
            { id: "15476", name: "SOFTPLUS TECNOLOGIA - TST SUPORTE", cnpj: "13.382.798/0001-25", phone: "(84) 3322-0100", active: true, expireDate: "2027-12-31", terminalsAllowed: 5, activeTerminals: 2 },
            { id: "15521", name: "RECANTO CAIPIRA", cnpj: "26.734.636/0001-50", phone: "(84) 3202-0372", active: true, expireDate: "2027-08-30", terminalsAllowed: 3, activeTerminals: 1 },
            { id: "15835", name: "NETO LANCHES - PRAÇA STC", cnpj: "18.537.574/0001-69", phone: "(84) 99819-6058", active: true, expireDate: "2026-12-25", terminalsAllowed: 4, activeTerminals: 2 },
            { id: "15935", name: "RESTAURANTE BOM SABOR", cnpj: "39.326.977/0001-39", phone: "(84) 98811-9100", active: true, expireDate: "2027-04-15", terminalsAllowed: 2, activeTerminals: 1 },
            { id: "16023", name: "RESTAURANTE QDELÍCIA", cnpj: "27.625.587/0001-80", phone: "(84) 98839-6640", active: true, expireDate: "2027-02-28", terminalsAllowed: 5, activeTerminals: 3 }
        ];
        saveStoresList();
    }
}

function saveStoresList() {
    fs.writeFileSync(LICENCAS_FILE, JSON.stringify(storesList, null, 4), 'utf8');
}

// Inicializa a lista de lojas no boot
loadStoresList();
if (storesList.length > 0) {
    currentStoreId = storesList[0].id;
}

// Retorna a conexão do banco correspondente ao ID da loja (cria e popula se for nova)
function getDatabaseConnection(storeId) {
    if (!activeDatabases[storeId]) {
        const storeDbFile = path.join(DATE_DIR, `ticketpro_${storeId}.db`);
        const isNew = !fs.existsSync(storeDbFile);
        const db = new DatabaseSync(storeDbFile);
        
        // Garante que todas as tabelas relacionais estruturadas existam no banco de dados SQLite
        db.exec(`
            CREATE TABLE IF NOT EXISTS system_data (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                cost REAL NOT NULL,
                subgroupId INTEGER,
                printerId INTEGER,
                icon TEXT,
                item_order INTEGER,
                stock INTEGER,
                useNameOnPrint INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                item_order INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS subgroups (
                id INTEGER PRIMARY KEY,
                groupId INTEGER,
                name TEXT NOT NULL,
                buttonColor TEXT,
                textColor TEXT
            );
            
            CREATE TABLE IF NOT EXISTS payment_methods (
                id INTEGER PRIMARY KEY,
                code TEXT NOT NULL,
                item_order INTEGER,
                name TEXT NOT NULL,
                buttonColor TEXT,
                textColor TEXT
            );
            
            CREATE TABLE IF NOT EXISTS printers (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                model TEXT,
                ip TEXT,
                port INTEGER,
                activeCut INTEGER,
                useWindowsPrinter INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS terminals (
                id TEXT PRIMARY KEY,
                cashNumber INTEGER,
                name TEXT NOT NULL,
                layout TEXT,
                font TEXT,
                fontSize TEXT,
                printerId INTEGER,
                active INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS sales (
                id TEXT PRIMARY KEY,
                timestamp INTEGER,
                productName TEXT NOT NULL,
                price REAL NOT NULL,
                paymentMethod TEXT,
                terminalId TEXT,
                operador TEXT,
                synchronized INTEGER DEFAULT 0
            );
            
            CREATE TABLE IF NOT EXISTS cash_status (
                key TEXT PRIMARY KEY,
                isOpen INTEGER NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS versions (
                id INTEGER PRIMARY KEY,
                version TEXT NOT NULL,
                date TEXT NOT NULL,
                description TEXT
            );
        `);
        
        try {
            db.exec("ALTER TABLE sales ADD COLUMN synchronized INTEGER DEFAULT 0");
        } catch (e) {}

        // Se o banco for recém-criado, injeta dados padrão de demonstração para facilitar testes
        if (isNew) {
            const store = storesList.find(s => s.id === storeId);
            const storeName = store ? store.name : "NOVA LOJA";
            const initialProducts = [
                { id: 101, code: '101', name: `Heineken Long Neck (${storeId})`, price: 12.00, cost: 6.50, subgroupId: 1, printerId: 1, icon: 'beer', order: 1, stock: 100, useNameOnPrint: true },
                { id: 102, code: '102', name: 'Coca-Cola 350ml', price: 6.00, cost: 2.80, subgroupId: 1, printerId: 1, icon: 'droplet', order: 2, stock: 200, useNameOnPrint: true },
                { id: 201, code: '201', name: `X-Burguer ${storeName.split(' ')[0]}`, price: 28.00, cost: 12.00, subgroupId: 2, printerId: 2, icon: 'sandwich', order: 1, stock: 50, useNameOnPrint: true },
                { id: 202, code: '202', name: 'Batata Frita G', price: 18.00, cost: 5.00, subgroupId: 2, printerId: 2, icon: 'utensils', order: 2, stock: null, useNameOnPrint: true }
            ];

            const insertProduct = db.prepare("INSERT INTO products (id, code, name, price, cost, subgroupId, printerId, icon, item_order, stock, useNameOnPrint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            initialProducts.forEach(p => {
                try { insertProduct.run(p.id, p.code, p.name, p.price, p.cost, p.subgroupId, p.printerId, p.icon, p.order, p.stock, p.useNameOnPrint ? 1 : 0); } catch(e){}
            });

            const initialGroups = [
                { id: 1, name: 'BEBIDAS', order: 1 },
                { id: 2, name: 'COMIDA', order: 2 }
            ];
            const insertGroup = db.prepare("INSERT INTO groups (id, name, item_order) VALUES (?, ?, ?)");
            initialGroups.forEach(g => {
                try { insertGroup.run(g.id, g.name, g.order); } catch(e){}
            });

            const initialSubgroups = [
                { id: 1, groupId: 1, name: 'Cervejas e Refris', buttonColor: '#3b82f6', textColor: '#ffffff' },
                { id: 2, groupId: 2, name: 'Lanches e Porções', buttonColor: '#f97316', textColor: '#ffffff' }
            ];
            const insertSubgroup = db.prepare("INSERT INTO subgroups (id, groupId, name, buttonColor, textColor) VALUES (?, ?, ?, ?, ?)");
            initialSubgroups.forEach(sg => {
                try { insertSubgroup.run(sg.id, sg.groupId, sg.name, sg.buttonColor, sg.textColor); } catch(e){}
            });

            const initialPaymentMethods = [
                { id: 1, code: '1', order: 1, name: 'DINHEIRO', buttonColor: '#22c55e', textColor: '#ffffff' },
                { id: 2, code: '2', order: 2, name: 'CARTÃO CRÉDITO', buttonColor: '#3b82f6', textColor: '#ffffff' },
                { id: 3, code: '3', order: 3, name: 'CARTÃO DÉBITO', buttonColor: '#6366f1', textColor: '#ffffff' },
                { id: 4, code: '4', order: 4, name: 'PIX', buttonColor: '#000000', textColor: '#ffffff' }
            ];
            const insertPayment = db.prepare("INSERT INTO payment_methods (id, code, item_order, name, buttonColor, textColor) VALUES (?, ?, ?, ?, ?, ?)");
            initialPaymentMethods.forEach(pm => {
                try { insertPayment.run(pm.id, pm.code, pm.order, pm.name, pm.buttonColor, pm.textColor); } catch(e){}
            });

            const initialPrinters = [
                { id: 1, name: 'IMPRESSORA BAR', model: 'Genérico ESC/POS 80mm', ip: '192.168.1.200', port: 9100, activeCut: true, useWindowsPrinter: false },
                { id: 2, name: 'IMPRESSORA COZINHA', model: 'Genérico ESC/POS 80mm', ip: '192.168.1.201', port: 9100, activeCut: true, useWindowsPrinter: false }
            ];
            const insertPrinter = db.prepare("INSERT INTO printers (id, name, model, ip, port, activeCut, useWindowsPrinter) VALUES (?, ?, ?, ?, ?, ?, ?)");
            initialPrinters.forEach(pr => {
                try { insertPrinter.run(pr.id, pr.name, pr.model, pr.ip, pr.port, pr.activeCut ? 1 : 0, pr.useWindowsPrinter ? 1 : 0); } catch(e){}
            });

            const initialTerminals = [
                { id: "CX1", cashNumber: 1, name: "cx - 01", layout: "vertical", font: "Outfit", fontSize: "medium", printerId: null, active: 1 }
            ];
            const insertTerminal = db.prepare("INSERT INTO terminals (id, cashNumber, name, layout, font, fontSize, printerId, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            initialTerminals.forEach(t => {
                try { insertTerminal.run(t.id, t.cashNumber, t.name, t.layout, t.font, t.fontSize, t.printerId, t.active); } catch(e){}
            });
        }
        
        activeDatabases[storeId] = db;
    }
    return activeDatabases[storeId];
}

// PROXY DINÂMICO DO BANCO DE DADOS: Intercepta todas as chamadas do código legado
// e direciona transparentemente para a conexão do banco de dados da loja ativa.
const dbSqlite = {
    prepare(sql) {
        return getDatabaseConnection(currentStoreId).prepare(sql);
    },
    exec(sql) {
        return getDatabaseConnection(currentStoreId).exec(sql);
    }
};

// Dados iniciais padrão
const initialData = {
    products: [
        { id: 101, code: '101', name: 'Heineken Long Neck', price: 12.00, cost: 6.50, subgroupId: 1, printerId: 1, icon: 'beer', order: 1, stock: 100, useNameOnPrint: true },
        { id: 102, code: '102', name: 'Coca-Cola 350ml', price: 6.00, cost: 2.80, subgroupId: 1, printerId: 1, icon: 'droplet', order: 2, stock: 200, useNameOnPrint: true },
        { id: 201, code: '201', name: 'X-Burguer Artesanal', price: 28.00, cost: 12.00, subgroupId: 2, printerId: 2, icon: 'sandwich', order: 1, stock: 50, useNameOnPrint: true },
        { id: 202, code: '202', name: 'Batata Frita G', price: 18.00, cost: 5.00, subgroupId: 2, printerId: 2, icon: 'utensils', order: 2, stock: null, useNameOnPrint: true }
    ],
    groups: [
        { id: 1, name: 'BEBIDAS', order: 1 },
        { id: 2, name: 'COMIDA', order: 2 }
    ],
    subgroups: [
        { id: 1, groupId: 1, name: 'Cervejas e Refris', buttonColor: '#3b82f6', textColor: '#ffffff' },
        { id: 2, groupId: 2, name: 'Lanches e Porções', buttonColor: '#f97316', textColor: '#ffffff' }
    ],
    paymentMethods: [
        { id: 1, code: '1', order: 1, name: 'DINHEIRO', buttonColor: '#22c55e', textColor: '#ffffff' },
        { id: 2, code: '2', order: 2, name: 'CARTÃO CRÉDITO', buttonColor: '#3b82f6', textColor: '#ffffff' },
        { id: 3, code: '3', order: 3, name: 'CARTÃO DÉBITO', buttonColor: '#6366f1', textColor: '#ffffff' },
        { id: 4, code: '4', order: 4, name: 'PIX', buttonColor: '#000000', textColor: '#ffffff' }
    ],
    printers: [
        { id: 1, name: 'IMPRESSORA BAR', model: 'Genérico ESC/POS 80mm', ip: '192.168.1.200', port: 9100, activeCut: true, useWindowsPrinter: false },
        { id: 2, name: 'IMPRESSORA COZINHA', model: 'Genérico ESC/POS 80mm', ip: '192.168.1.201', port: 9100, activeCut: true, useWindowsPrinter: false }
    ],
    terminals: [
        { id: "CX1", cashNumber: 1, name: "cx - 01", layout: "vertical", font: "Outfit", fontSize: "medium", printerId: null, active: true }
    ],
    sales: [],
    cash: { isOpen: false, sales: [] },
    versions: [
        { id: 1, version: "1.0.0", date: new Date().toISOString(), description: "Versão inicial de lançamento do sistema VELO com controle de vendas e impressão de cupom." }
    ],
    currentVersion: '1.0.0'
};

// Função para ler dados (com auto-recuperação/self-healing)
function readData() {
    try {
        const rows = dbSqlite.prepare("SELECT value FROM system_data WHERE key = 'state'").all();
        if (rows.length > 0) {
            const data = JSON.parse(rows[0].value);
            
            let modified = false;
            
            // Migração automática de IDs de terminais antigos (legado)
            if (data.terminals) {
                data.terminals = data.terminals.map(t => {
                    if (typeof t.id === 'number' && t.id > 1000000) {
                        t.id = "CX" + t.cashNumber;
                        modified = true;
                    }
                    return t;
                });
            }
            
            // Migração automática para controle de versão
            if (!data.versions || data.versions.length === 0) {
                data.versions = [
                    { id: 1, version: "1.0.0", date: new Date().toISOString(), description: "Versão inicial de lançamento do sistema VELO com controle de vendas e impressão de cupom." }
                ];
                data.currentVersion = "1.0.0";
                modified = true;
            }
            
            if (modified) {
                writeData(data);
            }
            return data;
        }
    } catch (e) {
        console.error("Erro ao ler do SQLite:", e);
    }

    // Se o SQLite estiver vazio, tenta ler do db.json legado para migrar
    if (fs.existsSync(DB_FILE)) {
        try {
            const content = fs.readFileSync(DB_FILE, 'utf8').trim();
            if (content !== '') {
                const parsed = JSON.parse(content);
                writeData(parsed);
                console.log(" > Dados migrados do db.json para o SQLite (ticketpro.db) com sucesso!");
                return parsed;
            }
        } catch (e) {}
    }

    // Se nenhum existe, inicia com os dados padrão
    writeData(initialData);
    console.log(" > Banco de dados SQLite inicializado com os dados padrão.");
    return initialData;
}

// Retorna a string JSON diretamente do banco de dados para ganho extremo de performance
function readDataRaw() {
    try {
        const rows = dbSqlite.prepare("SELECT value FROM system_data WHERE key = 'state'").all();
        if (rows.length > 0) {
            // Garante que o arquivo físico db.json esteja sempre espelhado e sincronizado
            if (!fs.existsSync(DB_FILE)) {
                fs.writeFileSync(DB_FILE, rows[0].value, 'utf8');
            }
            return rows[0].value;
        }
    } catch (e) {}
    return JSON.stringify(readData(), null, 2);
}

// Grava os dados de forma transacional e segura no SQLite e espelha no db.json
function writeData(data) {
    const jsonStr = JSON.stringify(data, null, 2);
    try {
        // 1. Grava o estado JSON completo para compatibilidade
        const stmt = dbSqlite.prepare("INSERT OR REPLACE INTO system_data (key, value) VALUES ('state', ?)");
        stmt.run(jsonStr);
        
        // 2. Popula as tabelas relacionais do SQLite estruturadas
        
        // --- PRODUTOS ---
        if (Array.isArray(data.products)) {
            dbSqlite.exec("DELETE FROM products");
            const insertProd = dbSqlite.prepare(`
                INSERT INTO products (id, code, name, price, cost, subgroupId, printerId, icon, item_order, stock, useNameOnPrint)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            data.products.forEach(p => {
                insertProd.run(
                    p.id,
                    p.code || '',
                    p.name || '',
                    Number(p.price) || 0,
                    Number(p.cost) || 0,
                    p.subgroupId || null,
                    p.printerId || null,
                    p.icon || null,
                    p.order || null,
                    p.stock || null,
                    p.useNameOnPrint ? 1 : 0
                );
            });
        }
        
        // --- GRUPOS ---
        if (Array.isArray(data.groups)) {
            dbSqlite.exec("DELETE FROM groups");
            const insertGroup = dbSqlite.prepare(`
                INSERT INTO groups (id, name, item_order)
                VALUES (?, ?, ?)
            `);
            data.groups.forEach(g => {
                insertGroup.run(
                    g.id,
                    g.name || '',
                    g.order || null
                );
            });
        }
        
        // --- SUBGRUPOS ---
        if (Array.isArray(data.subgroups)) {
            dbSqlite.exec("DELETE FROM subgroups");
            const insertSubgroup = dbSqlite.prepare(`
                INSERT INTO subgroups (id, groupId, name, buttonColor, textColor)
                VALUES (?, ?, ?, ?, ?)
            `);
            data.subgroups.forEach(sg => {
                insertSubgroup.run(
                    sg.id,
                    sg.groupId || null,
                    sg.name || '',
                    sg.buttonColor || null,
                    sg.textColor || null
                );
            });
        }
        
        // --- FORMAS DE PAGAMENTO ---
        if (Array.isArray(data.paymentMethods)) {
            dbSqlite.exec("DELETE FROM payment_methods");
            const insertPm = dbSqlite.prepare(`
                INSERT INTO payment_methods (id, code, item_order, name, buttonColor, textColor)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            data.paymentMethods.forEach(pm => {
                insertPm.run(
                    pm.id,
                    pm.code || '',
                    pm.order || null,
                    pm.name || '',
                    pm.buttonColor || null,
                    pm.textColor || null
                );
            });
        }
        
        // --- IMPRESSORAS ---
        if (Array.isArray(data.printers)) {
            dbSqlite.exec("DELETE FROM printers");
            const insertPrinter = dbSqlite.prepare(`
                INSERT INTO printers (id, name, model, ip, port, activeCut, useWindowsPrinter)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            data.printers.forEach(pr => {
                insertPrinter.run(
                    pr.id,
                    pr.name || '',
                    pr.model || null,
                    pr.ip || null,
                    pr.port || null,
                    pr.activeCut ? 1 : 0,
                    pr.useWindowsPrinter ? 1 : 0
                );
            });
        }
        
        // --- TERMINAIS ---
        if (Array.isArray(data.terminals)) {
            dbSqlite.exec("DELETE FROM terminals");
            const insertTerminal = dbSqlite.prepare(`
                INSERT INTO terminals (id, cashNumber, name, layout, font, fontSize, printerId, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            data.terminals.forEach(t => {
                insertTerminal.run(
                    t.id,
                    t.cashNumber || null,
                    t.name || '',
                    t.layout || null,
                    t.font || null,
                    t.fontSize || null,
                    t.printerId || null,
                    t.active ? 1 : 0
                );
            });
        }
        
        // --- VENDAS ---
        if (Array.isArray(data.sales)) {
            dbSqlite.exec("DELETE FROM sales");
            const insertSale = dbSqlite.prepare(`
                INSERT OR REPLACE INTO sales (id, timestamp, productName, price, paymentMethod, terminalId, operador, synchronized)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            data.sales.forEach(s => {
                insertSale.run(
                    s.id,
                    s.timestamp || null,
                    s.productName || '',
                    Number(s.price) || 0,
                    s.paymentMethod || null,
                    s.terminalId || null,
                    s.operador || null,
                    s.synchronized ? 1 : 0
                );
            });
        }
        
        // --- ESTADO DO CAIXA ---
        if (data.cash) {
            dbSqlite.exec("DELETE FROM cash_status");
            const insertCash = dbSqlite.prepare(`
                INSERT INTO cash_status (key, isOpen)
                VALUES ('current_cash', ?)
            `);
            insertCash.run(data.cash.isOpen ? 1 : 0);
        }
        
        // --- VERSÕES ---
        if (Array.isArray(data.versions)) {
            dbSqlite.exec("DELETE FROM versions");
            const insertVersion = dbSqlite.prepare(`
                INSERT INTO versions (id, version, date, description)
                VALUES (?, ?, ?, ?)
            `);
            data.versions.forEach(v => {
                insertVersion.run(
                    v.id,
                    v.version || '',
                    v.date || '',
                    v.description || ''
                );
            });
        }
        
    } catch (e) {
        console.error("Erro crítico ao gravar relacional no SQLite:", e);
    }

    // Espelha no db.json de forma assíncrona (não bloqueante) para compatibilidade e backup
    fs.writeFile(DB_FILE, jsonStr, 'utf8', (err) => {
        if (err) console.error("Erro ao gravar espelhamento no db.json:", err);
    });
}

// Inicializa e sincroniza os bancos no boot do servidor
const currentDbState = readData();

// Backups Automáticos
const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

const backupFile = path.join(BACKUP_DIR, `db_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.copyFileSync(DB_FILE, backupFile);

// Mantém apenas os últimos 10 backups
const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db_backup_')).sort();
if (backups.length > 10) {
    fs.unlinkSync(path.join(BACKUP_DIR, backups[0]));
}

function findTerminalFlex(terminals, terminalIdOrInput) {
    if (!terminalIdOrInput || !Array.isArray(terminals) || terminals.length === 0) return null;
    const inputUpper = String(terminalIdOrInput).trim().toUpperCase();
    const inputDigits = inputUpper.replace(/\D/g, '');

    // 1. Tenta correspondência exata por ID
    let found = terminals.find(t => String(t.id).toUpperCase() === inputUpper);
    if (found) return found;

    // 2. Tenta correspondência exata por Nome
    found = terminals.find(t => String(t.name).toUpperCase() === inputUpper);
    if (found) return found;

    // 3. Tenta correspondência numérica com o cashNumber
    if (inputDigits !== '') {
        found = terminals.find(t => String(t.cashNumber) === inputDigits);
        if (found) return found;
    }

    // 4. Tenta correspondência flexível removendo caracteres não-alfanuméricos
    const cleanInput = inputUpper.replace(/[^A-Z0-9]/g, '');
    if (cleanInput !== '') {
        found = terminals.find(t => {
            const cleanId = String(t.id).toUpperCase().replace(/[^A-Z0-9]/g, '');
            const cleanName = String(t.name).toUpperCase().replace(/[^A-Z0-9]/g, '');
            return cleanId === cleanInput || cleanName === cleanInput || cleanId.includes(cleanInput) || cleanName.includes(cleanInput);
        });
        if (found) return found;
    }

    return null;
}

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// ─── Gera bytes ESC/POS no estilo FICHA ────────────────────────────────────
function buildEscPos(txs, operator, terminalId, printer, db) {
    const ESC = '\x1b';
    const GS  = '\x1d';
    const LF  = '\n';

    const INIT     = ESC + '@';
    const CENTER   = ESC + 'a\x01';
    const LEFT     = ESC + 'a\x00';
    const BOLD_ON  = ESC + 'E\x01';
    const BOLD_OFF = ESC + 'E\x00';
    const NORM     = GS  + '!\x00';
    const SIZE_2X2 = GS  + '!\x11';

    const activeCut    = printer.activeCut !== false;
    const linesBefore  = Math.max(0, parseInt(printer.linesBefore  ?? 4));
    const linesAfter   = Math.max(0, parseInt(printer.linesAfter   ?? 0));
    const alignSpacing = Math.max(0, parseInt(printer.alignSpacing ?? 2));

    const CUT = GS + 'V\x01';

    const cols   = parseInt(printer.paperWidth ?? 48);
    const border = '='.repeat(cols);
    const sep    = '-'.repeat(cols);

    const ticketConfig = (db && db.ticketConfig) || {};
    const titleTicket  = ticketConfig.titleTicket ?? 'TICKET 1-A-1';
    const titleFicha   = ticketConfig.titleFicha  ?? 'ficha';

    let out = INIT;

    txs.forEach((tx, idx) => {
        const product = tx.productName ?? 'PRODUTO';
        const tid     = String(terminalId ?? tx.terminalId ?? 'PDV').toUpperCase();
        const dt      = new Date(tx.timestamp ?? Date.now()).toLocaleString('pt-BR');
        const op      = String(operator ?? tx.operator ?? 'N/A').toUpperCase();
        const method  = String(tx.paymentMethod ?? '').toUpperCase();
        const num     = String(idx + 1).padStart(2, '0');

        if (idx > 0 && alignSpacing > 0) {
            out += LF.repeat(alignSpacing);
        }

        out += CENTER;
        out += NORM + border + LF;
        out += SIZE_2X2 + BOLD_ON + titleFicha + BOLD_OFF + LF;
        out += NORM;
        out += `${titleTicket}  -  ${tid}` + LF;
        out += `#${num}  -  ${dt}` + LF;
        out += sep + LF;
        out += SIZE_2X2 + BOLD_ON + product + BOLD_OFF + LF;
        out += NORM;
        out += `OP: ${op}  |  ${method}` + LF;
        out += border + LF;

        if (linesBefore > 0) out += LF.repeat(linesBefore);
        if (activeCut)       out += CUT;
        if (linesAfter > 0)  out += LF.repeat(linesAfter);

        out += LEFT;
    });

    return out;
}

// Envia bytes ESC/POS brutos via TCP (sem reprocessar)
function printNetworkRaw(printer, data) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        client.setTimeout(5000);

        client.connect(printer.port || 9100, printer.ip, () => {
            const buf = Buffer.from(data, 'binary');
            client.write(buf, () => {
                client.destroy();
                resolve(true);
            });
        });

        client.on('error', (err) => { client.destroy(); reject(err); });
        client.on('timeout', ()  => { client.destroy(); reject(new Error('Timeout ao conectar à impressora')); });
    });
}

// Mantém compatibilidade com chamadas legadas (texto simples via rede)
function printNetwork(printer, ticketText) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        client.setTimeout(5000);

        client.connect(printer.port || 9100, printer.ip, () => {
            const ESC = '\x1b';
            const GS  = '\x1d';
            const INIT = ESC + '@';
            const CUT  = GS + 'V\x41\x03';

            let buffer = INIT;
            for (let i = 0; i < (printer.linesBefore || 0); i++) buffer += '\n';
            buffer += ticketText;
            for (let i = 0; i < (printer.linesAfter  || 0); i++) buffer += '\n';
            if (printer.activeCut) buffer += '\n\n\n' + CUT;
            else buffer += '\n\n\n\n\n';

            client.write(buffer, 'latin1', () => {
                client.destroy();
                resolve(true);
            });
        });

        client.on('error',   (err) => { client.destroy(); reject(err); });
        client.on('timeout', ()    => { client.destroy(); reject(new Error('Timeout connecting to printer')); });
    });
}

// Envia para impressora Windows via RAW (P/Invoke)
function printWindows(printer, escposData) {
    return new Promise((resolve, reject) => {
        if (!printer.systemName) return reject(new Error('Nome do sistema da impressora não configurado'));

        const os   = require('os');
        const fs2  = require('fs');
        const path2 = require('path');

        const tmpBin = path2.join(os.tmpdir(), `tp_${Date.now()}.bin`);
        const tmpPs  = path2.join(os.tmpdir(), `tp_${Date.now()}.ps1`);

        // Grava binário ESC/POS
        fs2.writeFileSync(tmpBin, Buffer.from(escposData, 'binary'));

        const escapedBin     = tmpBin.replace(/'/g, "''");
        const escapedPrinter = printer.systemName.replace(/'/g, "''");

        const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinRaw {
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true)]
    public static extern bool OpenPrinter(string sz, out IntPtr h, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter")]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr h, Int32 level, IntPtr pdi);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter")]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter")]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter")]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr h, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
}
"@ -Language CSharp
$data  = [System.IO.File]::ReadAllBytes('${escapedBin}')
$pName = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('${escapedPrinter}')
$pType = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('RAW')
$pDoc  = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('TicketPro')
$ps    = [IntPtr]::Size
$di    = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($ps * 3)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr($di, 0,      $pDoc)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr($di, $ps,    [IntPtr]::Zero)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr($di, $ps*2,  $pType)
$hP = [IntPtr]::Zero
[WinRaw]::OpenPrinter('${escapedPrinter}', [ref]$hP, [IntPtr]::Zero) | Out-Null
[WinRaw]::StartDocPrinter($hP, 1, $di)  | Out-Null
[WinRaw]::StartPagePrinter($hP)         | Out-Null
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($data.Length)
[System.Runtime.InteropServices.Marshal]::Copy($data, 0, $ptr, $data.Length)
$wr = 0
[WinRaw]::WritePrinter($hP, $ptr, $data.Length, [ref]$wr) | Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
[WinRaw]::EndPagePrinter($hP)  | Out-Null
[WinRaw]::EndDocPrinter($hP)   | Out-Null
[WinRaw]::ClosePrinter($hP)    | Out-Null
Remove-Item -LiteralPath '${escapedBin}' -Force -ErrorAction SilentlyContinue
Write-Host "OK:$wr bytes enviados."
`;
        fs2.writeFileSync(tmpPs, ps);

        exec(`powershell -NonInteractive -ExecutionPolicy Bypass -File "${tmpPs}" 2>&1`, (error, stdout) => {
            try { fs2.unlinkSync(tmpPs); } catch(e) {}
            if (error) {
                console.error('PS RAW Error:', error.message, stdout);
                return reject(new Error(`Falha RAW print: ${error.message}`));
            }
            resolve(true);
        });
    });
}


const server = http.createServer((req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // API ENDPOINTS
    if (req.url === '/api/data' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(readDataRaw());
        return;
    }

    if (req.url === '/api/save' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const newData = JSON.parse(body);
                const currentData = readData();
                const updatedData = { ...currentData, ...newData };
                writeData(updatedData);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    if (req.url === '/api/push-sales' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const newSales = JSON.parse(body);
                const currentData = readData();

                // Dá baixa no estoque de produtos controlados ao vender ou devolve ao estornar
                if (Array.isArray(currentData.products)) {
                    newSales.forEach(sale => {
                        const product = currentData.products.find(p => String(p.id) === String(sale.productId));
                        if (product && product.stock !== null && product.stock !== undefined && product.stock !== '') {
                            const qty = Number(product.stock);
                            if (Number(sale.price) < 0) {
                                // Se o preço for negativo (devolução/estorno), o produto volta ao estoque
                                product.stock = qty + 1;
                            } else {
                                // Se for venda normal, reduz estoque
                                product.stock = Math.max(0, qty - 1);
                            }
                        }
                    });
                }

                const salesWithSyncState = newSales.map(s => ({
                    ...s,
                    synchronized: 0
                }));
                currentData.sales = [...(currentData.sales || []), ...salesWithSyncState];
                writeData(currentData);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, count: newSales.length }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    if (req.url === '/api/cancel-sale' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                if (!payload || !payload.id) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'JSON inválido ou ID de venda ausente.' }));
                    return;
                }
                const saleId = payload.id;
                const currentData = readData();

                if (!Array.isArray(currentData.sales)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Nenhuma venda encontrada' }));
                    return;
                }

                // Localiza a venda para repor o estoque
                const saleToCancel = currentData.sales.find(s => String(s.id) === String(saleId));
                if (saleToCancel) {
                    // Repõe o estoque se for controlado
                    if (Array.isArray(currentData.products)) {
                        const product = currentData.products.find(p => String(p.id) === String(saleToCancel.productId));
                        if (product && product.stock !== null && product.stock !== undefined && product.stock !== '') {
                            const qty = Number(product.stock);
                            if (Number(saleToCancel.price) < 0) {
                                // Se a venda cancelada era uma devolução (preço negativo),
                                // cancelar a devolução retira o item do estoque
                                product.stock = Math.max(0, qty - 1);
                            } else {
                                // Cancelar venda normal devolve o item ao estoque
                                product.stock = qty + 1;
                            }
                        }
                    }

                    // Remove a venda
                    currentData.sales = currentData.sales.filter(s => String(s.id) !== String(saleId));
                    writeData(currentData);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Venda não encontrada' }));
                }
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }


    if (req.url === '/api/print' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                const data    = readData();

                // Resolve impressora: printerId direto → fallback pelo terminal
                let printer = null;

                if (payload.printerId != null) {
                    printer = data.printers.find(p => String(p.id) === String(payload.printerId)) || null;
                }

                if (!printer && payload.terminalId && Array.isArray(data.terminals)) {
                    const term = findTerminalFlex(data.terminals, payload.terminalId);
                    if (term && term.printerId) {
                        printer = data.printers.find(p => String(p.id) === String(term.printerId)) || null;
                    }
                }

                // Último fallback: primeira impressora disponível
                if (!printer && data.printers && data.printers.length > 0) {
                    printer = data.printers[0];
                }

                if (!printer) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Nenhuma impressora disponível. Configure no portal.' }));
                    return;
                }

                // Se veio com 'transactions' (formato moderno do PDV), gera ESC/POS
                let printData;
                if (Array.isArray(payload.transactions) && payload.transactions.length > 0) {
                    printData = buildEscPos(
                        payload.transactions,
                        payload.operator || 'N/A',
                        payload.terminalId || 'PDV',
                        printer,
                        data
                    );
                } else if (typeof payload.text === 'string') {
                    // Formato legado: texto puro
                    printData = payload.text;
                } else {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Sem dados para imprimir (transactions ou text).' }));
                    return;
                }

                if (printer.useWindowsPrinter) {
                    await printWindows(printer, printData);
                } else if (printer.ip) {
                    await printNetworkRaw(printer, printData);
                } else {
                    throw new Error('Configuração de conexão da impressora inválida (sem IP e sem Windows Printer).');
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, printerName: printer.name }));
            } catch (e) {
                console.error('Erro de impressão:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Endpoint de TESTE de impressora (chamado pelo portal)
    if (req.url === '/api/print-test' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { printerId } = JSON.parse(body);
                const data    = readData();
                const printer = data.printers.find(p => String(p.id) === String(printerId));

                if (!printer) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Impressora não encontrada.' }));
                    return;
                }

                // Transação de teste
                const testTx = [{
                    productName:   '*** TESTE DE IMPRESSORA ***',
                    paymentMethod: 'TESTE',
                    terminalId:    'PORTAL',
                    operator:      'ADMIN',
                    timestamp:     new Date().toISOString(),
                }];

                const printData = buildEscPos(testTx, 'ADMIN', 'PORTAL', printer, data);

                if (printer.useWindowsPrinter) {
                    await printWindows(printer, printData);
                } else if (printer.ip) {
                    await printNetworkRaw(printer, printData);
                } else {
                    throw new Error('Sem IP ou nome Windows configurado para esta impressora.');
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, printerName: printer.name }));
            } catch (e) {
                console.error('Erro no teste de impressão:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // --- ENDPOINTS ADM MASTER / MULTI-LOJAS ---
    if (req.url === '/api/master/stores' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            currentStoreId: currentStoreId,
            stores: storesList
        }));
        return;
    }

    if (req.url === '/api/master/dashboard' && req.method === 'GET') {
        try {
            const stats = storesList.map(store => {
                try {
                    const db = getDatabaseConnection(store.id);
                    
                    // Contagem de vendas
                    const rowSalesCount = db.prepare("SELECT COUNT(*) as count FROM sales").all();
                    const salesCount = rowSalesCount.length > 0 ? rowSalesCount[0].count : 0;
                    
                    // Faturamento total
                    const rowSalesSum = db.prepare("SELECT SUM(price) as total FROM sales").all();
                    const salesSum = (rowSalesSum.length > 0 && rowSalesSum[0].total) ? rowSalesSum[0].total : 0;
                    
                    // Produtos cadastrados
                    const rowProductsCount = db.prepare("SELECT COUNT(*) as count FROM products").all();
                    const productsCount = rowProductsCount.length > 0 ? rowProductsCount[0].count : 0;
                    
                    // Terminais cadastrados
                    const rowTerminalsCount = db.prepare("SELECT COUNT(*) as count FROM terminals").all();
                    const terminalsCount = rowTerminalsCount.length > 0 ? rowTerminalsCount[0].count : 0;
                    
                    return {
                        storeId: store.id,
                        storeName: store.name,
                        salesCount,
                        salesSum,
                        productsCount,
                        terminalsCount,
                        active: store.active
                    };
                } catch (err) {
                    return {
                        storeId: store.id,
                        storeName: store.name,
                        salesCount: 0,
                        salesSum: 0,
                        productsCount: 0,
                        terminalsCount: 0,
                        error: true
                    };
                }
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, dashboard: stats }));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (req.url === '/api/master/select-store' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { storeId } = JSON.parse(body);
                if (storesList.some(s => s.id === storeId)) {
                    currentStoreId = storeId;
                    
                    // Inicializa e sincroniza os dados do novo banco ativo de forma transparente
                    const data = readData(); 
                    
                    console.log(`[Master Control] Alternado dinamicamente para a loja ${storeId} (${storesList.find(s => s.id === storeId).name})`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, currentStoreId: currentStoreId, storeName: storesList.find(s => s.id === storeId).name }));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Loja não encontrada.' }));
                }
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'JSON inválido' }));
            }
        });
        return;
    }

    if (req.url === '/api/master/create-store' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const newStore = JSON.parse(body);
                if (!newStore.name || !newStore.cnpj) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Nome e CNPJ são obrigatórios.' }));
                    return;
                }

                // Gera um ID sequencial para simulação
                const maxId = storesList.reduce((max, s) => Math.max(max, parseInt(s.id)), 16000);
                const newId = String(maxId + 1);

                const storeObj = {
                    id: newId,
                    name: newStore.name.toUpperCase(),
                    cnpj: newStore.cnpj,
                    phone: newStore.phone || "N/A",
                    active: true,
                    expireDate: newStore.expireDate || "2027-12-31",
                    terminalsAllowed: parseInt(newStore.terminalsAllowed) || 5,
                    activeTerminals: 1
                };

                storesList.push(storeObj);
                saveStoresList();

                // Força a criação do banco de dados chamando a conexão
                getDatabaseConnection(newId);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, store: storeObj }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Erro ao cadastrar loja.' }));
            }
        });
        return;
    }

    if (req.url === '/api/master/toggle-license' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { storeId, active, expireDate } = JSON.parse(body);
                const store = storesList.find(s => s.id === storeId);
                if (store) {
                    if (active !== undefined) store.active = !!active;
                    if (expireDate !== undefined) store.expireDate = expireDate;
                    
                    saveStoresList();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, store: store }));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Loja não encontrada.' }));
                }
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'JSON inválido' }));
            }
        });
        return;
    }

    // --- ENDPOINTS MOCK CENTRAL CLOUD ---
    if (req.url === '/api/mock-cloud/push' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const sales = JSON.parse(body);
                console.log(`[Mock Nuvem Central] Recebeu ${sales.length} vendas para salvar na Nuvem.`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, receivedCount: sales.length }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'JSON inválido' }));
            }
        });
        return;
    }

    if (req.url === '/api/mock-cloud/pull' && req.method === 'GET') {
        // Envia os produtos atuais mesclados com a Pizza Gigante Velo que só existe na Nuvem
        const currentData = readData();
        const mockProducts = [
            ...(currentData.products || []),
            {
                id: 999,
                code: '999',
                name: 'Pizza Gigante Velo (Nuvem)',
                price: 49.90,
                cost: 20.00,
                subgroupId: 2,
                printerId: 2,
                icon: 'pizza',
                order: 10,
                stock: 50,
                useNameOnPrint: true
            }
        ];
        
        // Remove duplicados de ID caso já tenha sido importado
        const uniqueProducts = [];
        const seenIds = new Set();
        mockProducts.forEach(p => {
            if (!seenIds.has(p.id)) {
                seenIds.add(p.id);
                uniqueProducts.push(p);
            }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            data: {
                products: uniqueProducts
            }
        }));
        return;
    }

    // --- ENDPOINTS DO PAINEL DE CONTROLE SYNC ---
    if (req.url === '/api/sync/status' && req.method === 'GET') {
        try {
            const currentData = readData();
            syncState.pendingCount = (currentData.sales || []).filter(s => !s.synchronized).length;
        } catch (e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(syncState));
        return;
    }

    if (req.url === '/api/sync/trigger' && req.method === 'POST') {
        runSync().catch(console.error);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Sincronização iniciada sob demanda.' }));
        return;
    }

    // STATIC FILE SERVER
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    let filePath = '.' + parsedUrl.pathname;
    
    if (filePath === './') filePath = './index.html';
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    const extname = path.extname(filePath);
    let contentType = 'text/html';
    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': contentType = 'image/jpg'; break;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// ============================================================================
// MOTOR DE SINCRONIZAÇÃO - VELO SYNC (A cada 5 minutos)
// ============================================================================

const syncState = {
    active: true,
    lastSync: null,
    status: 'Aguardando próximo ciclo...', // 'Aguardando...', 'Sincronizando...', 'Erro de conexão'
    logs: [
        `[${new Date().toLocaleTimeString('pt-BR')}] > Sistema Velo Sync inicializado. Aguardando primeiro ciclo.`
    ],
    pendingCount: 0
};

function addSyncLog(msg) {
    const time = new Date().toLocaleTimeString('pt-BR');
    const logMsg = `[${time}] > ${msg}`;
    syncState.logs.push(logMsg);
    if (syncState.logs.length > 40) syncState.logs.shift();
    console.log(`[Velo Sync] ${msg}`);
}

function fetchLocalMock(path, options = {}) {
    return new Promise((resolve, reject) => {
        const reqOpts = {
            hostname: '127.0.0.1',
            port: PORT,
            path: path,
            method: options.method || 'GET',
            headers: options.headers || {}
        };
        
        const req = http.request(reqOpts, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error("Erro ao processar resposta do servidor local."));
                }
            });
        });
        
        req.on('error', (err) => {
            reject(new Error(`Conexão recusada pelo servidor local: ${err.message}`));
        });
        
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

async function runSync() {
    if (syncState.status === 'Sincronizando...') return;
    
    syncState.status = 'Sincronizando...';
    addSyncLog("Iniciando ciclo de sincronização...");
    const startTime = Date.now();

    try {
        const currentData = readData();
        
        // 1. PUSH: Encontra vendas pendentes
        const pendingSales = (currentData.sales || []).filter(s => !s.synchronized);
        syncState.pendingCount = pendingSales.length;

        if (pendingSales.length > 0) {
            addSyncLog(`PUSH: ${pendingSales.length} venda(s) pendente(s) localizada(s). Enviando para o portal...`);
            
            // Simula chamada HTTP POST para a nuvem via requisição interna no mock local
            const response = await fetchLocalMock('/api/mock-cloud/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pendingSales)
            });

            if (response.success) {
                // Marca como sincronizado
                currentData.sales.forEach(s => {
                    if (!s.synchronized) s.synchronized = 1;
                });
                writeData(currentData);
                addSyncLog(`PUSH: ${pendingSales.length} venda(s) transmitida(s) e confirmada(s) com sucesso.`);
            } else {
                throw new Error("Portal central rejeitou o lote de vendas: " + response.error);
            }
        } else {
            addSyncLog("PUSH: Nenhuma venda nova para sincronizar.");
        }

        // 2. PULL: Baixa catálogo atualizado da nuvem
        addSyncLog("PULL: Consultando catálogo atualizado na nuvem...");
        const pullData = await fetchLocalMock('/api/mock-cloud/pull');
        
        if (pullData.success && pullData.data) {
            let importCount = 0;
            let priceUpdateCount = 0;

            const cloudProducts = pullData.data.products || [];
            if (cloudProducts.length > 0) {
                if (!Array.isArray(currentData.products)) currentData.products = [];
                
                cloudProducts.forEach(cloudP => {
                    const localPIndex = currentData.products.findIndex(lp => String(lp.id) === String(cloudP.id));
                    if (localPIndex !== -1) {
                        const localP = currentData.products[localPIndex];
                        if (localP.price !== cloudP.price) {
                            priceUpdateCount++;
                        }
                        currentData.products[localPIndex] = { ...localP, ...cloudP };
                    } else {
                        currentData.products.push(cloudP);
                        importCount++;
                    }
                });

                writeData(currentData);
            }

            if (importCount > 0 || priceUpdateCount > 0) {
                addSyncLog(`PULL: Importação concluída. ${importCount} novo(s) produto(s) e ${priceUpdateCount} alteração(ões) de preço.`);
            } else {
                addSyncLog("PULL: Catálogo local já está atualizado com a nuvem.");
            }
        } else {
            throw new Error("Erro ao baixar dados da nuvem.");
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        syncState.lastSync = new Date().toLocaleString('pt-BR');
        syncState.status = 'Aguardando próximo ciclo...';
        syncState.pendingCount = 0;
        addSyncLog(`Ciclo concluído com sucesso. Duração: ${duration}s. Aguardando 5 minutos.`);
    } catch (err) {
        console.error("Erro no sincronizador:", err);
        syncState.status = 'Erro de conexão';
        addSyncLog(`ERRO: Falha na sincronização - ${err.message}`);
    }
}

// Inicializa a sincronização em segundo plano após 3 segundos do boot do servidor
setTimeout(() => {
    runSync().catch(console.error);
}, 4000);

// Agenda sincronização a cada 5 minutos
setInterval(() => {
    runSync().catch(console.error);
}, 300000);

// Auto-migrate old terminal IDs inside SQLite (handled inside readData)

const localIp = getLocalIp();
server.listen(PORT, '0.0.0.0', () => {
    console.log('\x1b[32m%s\x1b[0m', '-------------------------------------------------');
    console.log('\x1b[32m%s\x1b[0m', '   TICKET PRO - SERVIDOR DE IGREJA ATIVO         ');
    console.log('\x1b[32m%s\x1b[0m', '-------------------------------------------------');
    console.log(` > Painel Admin:   http://localhost:${PORT}`);
    
    try {
        const data = readData();
        if (data.terminals && data.terminals.length > 0) {
            console.log('\x1b[36m%s\x1b[0m', '\n > ACESSOS RÁPIDOS (COPIE E COLE NO NAVEGADOR):');
            data.terminals.forEach(t => {
                if (t.active !== false) {
                    const cleanLink = `http://localhost:${PORT}/pdv/?tid=${t.id}`;
                    console.log(`   [CAIXA ${t.cashNumber}] - ${t.name.padEnd(15)} : ${cleanLink}`);
                }
            });
        }
    } catch (e) {}

    console.log('\x1b[33m%s\x1b[0m', '\n-------------------------------------------------');
    console.log(' Mantenha esta janela aberta para o sistema funcionar.');
    console.log(' Acesso Local:            http://localhost:' + PORT);
    console.log(' IP de Rede (Celulares):  http://' + localIp + ':' + PORT);
    console.log('-------------------------------------------------');
});
