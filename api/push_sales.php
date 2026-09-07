<?php
/**
 * POST /api/push-sales
 * Adiciona novas vendas ao array "sales" do banco de dados.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Método não permitido. Use POST.']);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

$body    = file_get_contents('php://input');
$newSales = json_decode($body, true);

if ($newSales === null || !is_array($newSales)) {
    http_response_code(400);
    echo json_encode(['error' => 'JSON inválido. Esperado um array de vendas.']);
    exit;
}

// Lê dados atuais
$db = [];
if (file_exists(DB_FILE)) {
    $db = json_decode(file_get_contents(DB_FILE), true) ?? [];
}

// Garante que a chave 'sales' existe
if (!isset($db['sales']) || !is_array($db['sales'])) {
    $db['sales'] = [];
}

// Dá baixa no estoque de produtos controlados ao vender ou devolve ao estornar
if (isset($db['products']) && is_array($db['products'])) {
    foreach ($newSales as $sale) {
        foreach ($db['products'] as &$product) {
            if ((string)$product['id'] === (string)$sale['productId']) {
                if (isset($product['stock']) && $product['stock'] !== null && $product['stock'] !== '') {
                    $qty = (int)$product['stock'];
                    if ((float)$sale['price'] < 0) {
                        // Se o preço for negativo (devolução/estorno), o produto volta ao estoque
                        $product['stock'] = $qty + 1;
                    } else {
                        // Se for venda normal, reduz estoque
                        $product['stock'] = max(0, $qty - 1);
                    }
                }
                break;
            }
        }
        unset($product);
    }
}

// Adiciona as novas vendas
$db['sales'] = array_merge($db['sales'], $newSales);

// Grava
$result = file_put_contents(
    DB_FILE,
    json_encode($db, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);

if ($result === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao gravar as vendas.']);
    exit;
}

echo json_encode([
    'success' => true,
    'count'   => count($newSales),
]);
