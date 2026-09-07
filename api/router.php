<?php
/**
 * TicketPro - Roteador Principal (PHP Embutido)
 * Inicie com: php -S 0.0.0.0:8080 router.php
 */

$dateDir = __DIR__ . '/date';
if (!is_dir($dateDir)) {
    mkdir($dateDir, 0755, true);
}
define('DB_FILE',    $dateDir . '/db.json');
define('BACKUP_DIR', __DIR__ . '/backups');

// ─── TAREFA DE INICIALIZAÇÃO (roda uma vez por sessão) ───────────────────────
$lockFile = sys_get_temp_dir() . '/ticketpro_init_' . date('YmdH') . '.lock';
if (!file_exists($lockFile)) {

    // Cria pasta de backups se não existir
    if (!is_dir(BACKUP_DIR)) {
        mkdir(BACKUP_DIR, 0755, true);
    }

    // Backup automático do banco de dados
    if (file_exists(DB_FILE)) {
        $backupName = 'db_backup_' . date('Y-m-d\TH-i-s') . '.json';
        copy(DB_FILE, BACKUP_DIR . '/' . $backupName);

        // Mantém apenas os últimos 10 backups
        $backups = glob(BACKUP_DIR . '/db_backup_*.json');
        sort($backups);
        while (count($backups) > 10) {
            unlink(array_shift($backups));
        }
    }

    // Semente inicial do banco se não existir ou estiver vazio
    _seedDb();

    // Migra IDs antigos de terminais (legado Node.js)
    _migrateTerminalIds();

    // Migra e inicializa controle de versão
    _migrateVersions();

    file_put_contents($lockFile, '1');
}

// ─── CABEÇALHOS CORS ─────────────────────────────────────────────────────────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ─── ROTEAMENTO ──────────────────────────────────────────────────────────────
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if (strpos($path, '/api/') === 0) {
    $endpoint = substr($path, 5); // Remove o prefixo '/api/'

    switch ($endpoint) {
        case 'data':
            require __DIR__ . '/api/data.php';
            break;
        case 'save':
            require __DIR__ . '/api/save.php';
            break;
        case 'push-sales':
            require __DIR__ . '/api/push_sales.php';
            break;
        case 'cancel-sale':
            require __DIR__ . '/api/cancel_sale.php';
            break;
        case 'print':
            require __DIR__ . '/api/print.php';
            break;
        case 'print-sangria':
            require __DIR__ . '/api/print-sangria.php';
            break;
        case 'print-fechamento':
            require __DIR__ . '/api/print-fechamento.php';
            break;
        case 'print-test':
            require __DIR__ . '/api/print-test.php';
            break;
        default:
            http_response_code(404);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Endpoint não encontrado: ' . $endpoint]);
    }
    exit;
}

// ─── ARQUIVOS ESTÁTICOS (PHP embutido serve automaticamente) ─────────────────
return false;

// ─── FUNÇÕES AUXILIARES ──────────────────────────────────────────────────────

function _seedDb(): void {
    if (file_exists(DB_FILE)) {
        $content = trim(file_get_contents(DB_FILE));
        if ($content !== '') {
            $data = json_decode($content, true);
            if ($data !== null) return; // DB válido, não precisa seed
        }
    }

    $initial = [
        'products' => [
            ['id' => 101, 'code' => '101', 'name' => 'Heineken Long Neck',  'price' => 12.00, 'cost' => 6.50,  'subgroupId' => 1, 'printerId' => 1, 'icon' => 'beer',     'order' => 1, 'stock' => 100, 'useNameOnPrint' => true],
            ['id' => 102, 'code' => '102', 'name' => 'Coca-Cola 350ml',     'price' => 6.00,  'cost' => 2.80,  'subgroupId' => 1, 'printerId' => 1, 'icon' => 'droplet',  'order' => 2, 'stock' => 200, 'useNameOnPrint' => true],
            ['id' => 201, 'code' => '201', 'name' => 'X-Burguer Artesanal', 'price' => 28.00, 'cost' => 12.00, 'subgroupId' => 2, 'printerId' => 2, 'icon' => 'sandwich', 'order' => 1, 'stock' => 50,  'useNameOnPrint' => true],
            ['id' => 202, 'code' => '202', 'name' => 'Batata Frita G',      'price' => 18.00, 'cost' => 5.00,  'subgroupId' => 2, 'printerId' => 2, 'icon' => 'utensils', 'order' => 2, 'stock' => null,'useNameOnPrint' => true],
        ],
        'groups' => [
            ['id' => 1, 'name' => 'BEBIDAS', 'order' => 1],
            ['id' => 2, 'name' => 'COMIDA',  'order' => 2],
        ],
        'subgroups' => [
            ['id' => 1, 'groupId' => 1, 'name' => 'Cervejas e Refris',   'buttonColor' => '#3b82f6', 'textColor' => '#ffffff'],
            ['id' => 2, 'groupId' => 2, 'name' => 'Lanches e Porções',   'buttonColor' => '#f97316', 'textColor' => '#ffffff'],
        ],
        'paymentMethods' => [
            ['id' => 1, 'code' => '1', 'order' => 1, 'name' => 'DINHEIRO',        'buttonColor' => '#22c55e', 'textColor' => '#ffffff'],
            ['id' => 2, 'code' => '2', 'order' => 2, 'name' => 'CARTÃO CRÉDITO',  'buttonColor' => '#3b82f6', 'textColor' => '#ffffff'],
            ['id' => 3, 'code' => '3', 'order' => 3, 'name' => 'CARTÃO DÉBITO',   'buttonColor' => '#6366f1', 'textColor' => '#ffffff'],
            ['id' => 4, 'code' => '4', 'order' => 4, 'name' => 'PIX',             'buttonColor' => '#000000', 'textColor' => '#ffffff'],
        ],
        'printers' => [
            ['id' => 1, 'name' => 'IMPRESSORA BAR',     'model' => 'Genérico ESC/POS 80mm', 'ip' => '192.168.1.200', 'port' => 9100, 'activeCut' => true,  'useWindowsPrinter' => false],
            ['id' => 2, 'name' => 'IMPRESSORA COZINHA', 'model' => 'Genérico ESC/POS 80mm', 'ip' => '192.168.1.201', 'port' => 9100, 'activeCut' => true,  'useWindowsPrinter' => false],
        ],
        'terminals' => [
            ['id' => 'CX1', 'cashNumber' => 1, 'name' => 'cx - 01', 'layout' => 'horizontal', 'font' => 'Outfit', 'fontSize' => 'medium', 'printerId' => null, 'active' => true],
        ],
        'sales' => [],
        'cash'  => ['isOpen' => false, 'sales' => []],
        'versions' => [
            [
                'id' => 1,
                'version' => '1.0.0',
                'date' => date(DATE_ATOM),
                'description' => 'Versão inicial de lançamento do sistema VELO com controle de vendas e impressão de cupom.'
            ]
        ],
        'currentVersion' => '1.0.0'
    ];

    file_put_contents(DB_FILE, json_encode($initial, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    error_log('[TicketPro] Banco de dados inicializado com dados padrão.');
}

function _migrateTerminalIds(): void {
    if (!file_exists(DB_FILE)) return;
    $db = json_decode(file_get_contents(DB_FILE), true);
    if (!$db || !isset($db['terminals'])) return;

    $modified = false;
    foreach ($db['terminals'] as &$t) {
        if (is_numeric($t['id']) && $t['id'] > 1_000_000) {
            $t['id'] = 'CX' . $t['cashNumber'];
            $modified = true;
        }
    }
    unset($t);

    if ($modified) {
        file_put_contents(DB_FILE, json_encode($db, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        error_log('[TicketPro] IDs de terminais migrados para formato curto.');
    }
}

function _migrateVersions(): void {
    if (!file_exists(DB_FILE)) return;
    $db = json_decode(file_get_contents(DB_FILE), true);
    if (!$db) return;

    $modified = false;
    if (!isset($db['versions']) || empty($db['versions'])) {
        $db['versions'] = [
            [
                'id' => 1,
                'version' => '1.0.0',
                'date' => date(DATE_ATOM),
                'description' => 'Versão inicial de lançamento do sistema VELO com controle de vendas e impressão de cupom.'
            ]
        ];
        $db['currentVersion'] = '1.0.0';
        $modified = true;
    }

    if ($modified) {
        file_put_contents(DB_FILE, json_encode($db, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        error_log('[TicketPro] Banco de dados migrado com controle de versão.');
    }
}
