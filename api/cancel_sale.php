<?php
/**
 * POST /api/cancel-sale
 * Remove uma venda do array "sales" usando o "id".
 */

date_default_timezone_set('America/Sao_Paulo');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Método não permitido. Use POST.']);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

$body = file_get_contents('php://input');
$payload = json_decode($body, true);

if ($payload === null || !isset($payload['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'JSON inválido. Esperado um ID de venda.']);
    exit;
}

$saleId = $payload['id'];

// Lê dados atuais
$db = [];
if (file_exists(DB_FILE)) {
    $db = json_decode(file_get_contents(DB_FILE), true) ?? [];
}

if (!isset($db['sales']) || !is_array($db['sales'])) {
    echo json_encode(['success' => false, 'error' => 'Nenhuma venda encontrada']);
    exit;
}

// Localiza a venda para repor o estoque
$saleToCancel = null;
foreach ($db['sales'] as $sale) {
    if ((string)$sale['id'] === (string)$saleId) {
        $saleToCancel = $sale;
        break;
    }
}

if ($saleToCancel === null) {
    echo json_encode(['success' => false, 'error' => 'Venda não encontrada']);
    exit;
}

// Repõe o estoque se for controlado
if (isset($db['products']) && is_array($db['products'])) {
    foreach ($db['products'] as &$product) {
        if ((string)$product['id'] === (string)$saleToCancel['productId']) {
            if (isset($product['stock']) && $product['stock'] !== null && $product['stock'] !== '') {
                $qty = (int)$product['stock'];
                if ((float)$saleToCancel['price'] < 0) {
                    // Se a venda cancelada era uma devolução (preço negativo),
                    // cancelar a devolução retira o item do estoque
                    $product['stock'] = max(0, $qty - 1);
                } else {
                    // Cancelar venda normal devolve o item ao estoque
                    $product['stock'] = $qty + 1;
                }
            }
            break;
        }
    }
    unset($product);
}

// Remove a venda
$db['sales'] = array_values(array_filter($db['sales'], function($sale) use ($saleId) {
    return (string)$sale['id'] !== (string)$saleId;
}));

// Grava
$result = file_put_contents(
    DB_FILE,
    json_encode($db, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);

if ($result === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao gravar.']);
    exit;
}

echo json_encode(['success' => true]);
