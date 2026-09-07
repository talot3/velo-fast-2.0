<?php
/**
 * POST /api/save
 * Salva dados no banco (merge: mantém campos existentes, sobrescreve os enviados).
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Método não permitido. Use POST.']);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

$body = file_get_contents('php://input');
$newData = json_decode($body, true);

if ($newData === null) {
    http_response_code(400);
    echo json_encode(['error' => 'JSON inválido no corpo da requisição.']);
    exit;
}

// Lê dados atuais
$currentData = [];
if (file_exists(DB_FILE)) {
    $currentData = json_decode(file_get_contents(DB_FILE), true) ?? [];
}

// Merge: os dados novos sobrescrevem os existentes por chave
$updatedData = array_merge($currentData, $newData);

// Grava com formatação
$result = file_put_contents(
    DB_FILE,
    json_encode($updatedData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);

if ($result === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao gravar no banco de dados.']);
    exit;
}

echo json_encode(['success' => true]);
