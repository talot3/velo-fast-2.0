<?php
/**
 * GET /api/data
 * Retorna o conteúdo completo do banco de dados (db.json).
 */

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Método não permitido. Use GET.']);
    exit;
}

if (!file_exists(DB_FILE)) {
    http_response_code(500);
    echo json_encode(['error' => 'Banco de dados não encontrado.']);
    exit;
}

$content = file_get_contents(DB_FILE);

// Valida o JSON antes de enviar
if (json_decode($content) === null) {
    http_response_code(500);
    echo json_encode(['error' => 'Banco de dados corrompido.']);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
echo $content;
