<?php
/**
 * POST /api/print — TicketPro PDV
 * Envia ficha ESC/POS em modo RAW para impressora Windows ou TCP/IP.
 */

date_default_timezone_set('America/Sao_Paulo');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Use POST.']);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

$payload = json_decode(file_get_contents('php://input'), true);
if ($payload === null) { http_response_code(400); echo json_encode(['error' => 'JSON inválido.']); exit; }

$db = json_decode(file_get_contents(DB_FILE), true);
if (!$db || empty($db['printers'])) {
    http_response_code(500); echo json_encode(['error' => 'Nenhuma impressora cadastrada.']); exit;
}

$printerId    = $payload['printerId']    ?? null;
$terminalId   = $payload['terminalId']   ?? null;
$transactions = $payload['transactions'] ?? [];
$operator     = $payload['operator']     ?? 'N/A';

// ── Resolve impressora (4 camadas de fallback) ────────────────────────────────
$printer = null;

if ($printerId !== null)
    foreach ($db['printers'] as $p)
        if ((string)$p['id'] === (string)$printerId) { $printer = $p; break; }

if (!$printer && $terminalId !== null && !empty($db['terminals'])) {
    $term = findTerminalFlex($db['terminals'], $terminalId);
    if ($term && !empty($term['printerId'])) {
        foreach ($db['printers'] as $p) {
            if ((string)$p['id'] === (string)$term['printerId']) {
                $printer = $p;
                break;
            }
        }
    }
}

if (!$printer)
    foreach ($db['printers'] as $p)
        if (!empty($p['useWindowsPrinter']) && !empty($p['systemName'])) { $printer = $p; break; }

if (!$printer)
    foreach ($db['printers'] as $p)
        if (!empty($p['ip'])) { $printer = $p; break; }

if (!$printer) {
    http_response_code(404);
    echo json_encode(['error' => 'Nenhuma impressora disponível. Configure no portal.']);
    exit;
}

if (empty($transactions)) {
    http_response_code(400); echo json_encode(['error' => 'Sem transações para imprimir.']); exit;
}

// ── Gera e envia ─────────────────────────────────────────────────────────────
try {
    $escpos = buildEscPos($transactions, $operator, $terminalId, $printer, $db);

    if (!empty($printer['useWindowsPrinter'])) {
        printWindowsRaw($printer['systemName'], $escpos);
    } else {
        printNetwork($printer, $escpos);
    }

    echo json_encode(['success' => true, 'printerName' => $printer['name'],
                      'printerType' => !empty($printer['useWindowsPrinter']) ? 'windows' : 'network']);

} catch (Exception $e) {
    error_log('[TicketPro] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUNÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gera bytes ESC/POS no estilo FICHA.
 * Respeita: linesBefore, linesAfter, alignSpacing, activeCut da impressora.
 */
function buildEscPos(array $txs, string $operator, ?string $terminalId, array $printer, array $db = []): string
{
    $ESC = "\x1b";
    $GS  = "\x1d";
    $LF  = "\n";

    $INIT     = $ESC . "@";          // Inicializa
    $CENTER   = $ESC . "a\x01";     // Centraliza
    $LEFT     = $ESC . "a\x00";     // Esquerda
    $BOLD_ON  = $ESC . "E\x01";
    $BOLD_OFF = $ESC . "E\x00";
    $NORM     = $GS  . "!\x00";     // 1×1
    $SIZE_2X2 = $GS  . "!\x11";     // 2× largo + 2× alto

    // Configurações de papel vindas do portal
    $activeCut    = !isset($printer['activeCut'])    || $printer['activeCut']    !== false;
    $linesBefore  = max(0, intval($printer['linesBefore']  ?? 4));  // linhas ANTES do corte
    $linesAfter   = max(0, intval($printer['linesAfter']   ?? 0));  // linhas APÓS o corte
    $alignSpacing = max(0, intval($printer['alignSpacing'] ?? 2));  // linhas entre produtos

    // Corte parcial ESC/POS: GS V B → byte de subtype = 1 (partial cut)
    $CUT = $GS . "V\x01";

    // Colunas: 48 para 80 mm, 32 para 58 mm
    $cols   = intval($printer['paperWidth'] ?? 48);
    $border = str_repeat('=', $cols);
    $sep    = str_repeat('-', $cols);

    // Configurações de ticket personalizadas
    $ticketConfig = $db['ticketConfig'] ?? [];
    $titleTicket  = $ticketConfig['titleTicket'] ?? 'TICKET 1-A-1';
    $titleFicha   = $ticketConfig['titleFicha']  ?? 'ficha';

    $out = $INIT;

    foreach ($txs as $idx => $tx) {
        $product = $tx['productName'] ?? 'PRODUTO';
        $tid     = strtoupper($terminalId ?? ($tx['terminalId'] ?? 'PDV'));
        $dt      = date('d/m/Y H:i:s', strtotime($tx['timestamp'] ?? 'now'));
        $op      = strtoupper($operator);
        $method  = strtoupper($tx['paymentMethod'] ?? '');
        $num     = str_pad($idx + 1, 2, '0', STR_PAD_LEFT);

        // ─── Espaço alinhamento entre produtos (não na primeira ficha) ──────
        if ($idx > 0 && $alignSpacing > 0) {
            $out .= str_repeat($LF, $alignSpacing);
        }

        $out .= $CENTER;

        // ─── Borda superior ──────────────────────────────────────────────────
        $out .= $NORM . $border . $LF;

        // ─── Título secundário em tamanho 2× ─────────────────────────────────
        $out .= $SIZE_2X2 . $BOLD_ON . $titleFicha . $BOLD_OFF . $LF;

        // ─── Cabeçalho em tamanho normal ─────────────────────────────────────
        $out .= $NORM;
        $out .= "{$titleTicket}  -  {$tid}" . $LF;
        $out .= "#{$num}  -  {$dt}" . $LF;

        // ─── Separador --- ────────────────────────────────────────────────────
        $out .= $sep . $LF;

        // ─── Produto em tamanho 2× ───────────────────────────────────────────
        $out .= $SIZE_2X2 . $BOLD_ON . $product . $BOLD_OFF . $LF;

        // ─── Rodapé (operador e método) — tamanho normal ──────────────────────
        $out .= $NORM;
        $out .= "OP: {$op}  |  {$method}" . $LF;

        // ─── Borda final ──────────────────────────────────────────────────────
        $out .= $border . $LF;

        // ─── Linhas antes do corte (espaço inferior) ─────────────────────────
        if ($linesBefore > 0) {
            $out .= str_repeat($LF, $linesBefore);
        }

        // ─── Corte (somente se activeCut = true) ─────────────────────────────
        if ($activeCut) {
            $out .= $CUT;
        }

        // ─── Linhas após o corte (espaço superior do próximo impresso) ────────
        if ($linesAfter > 0) {
            $out .= str_repeat($LF, $linesAfter);
        }

        $out .= $LEFT;
    }

    return $out;
}


/**
 * Envia RAW ESC/POS para impressora Windows via Win32 API (winspool.drv).
 * Evita que o Windows formate como "documento de texto" com fonte pequena.
 */
function printWindowsRaw(string $printerName, string $escposData): void
{
    // Arquivo binário temporário
    $tmpBin = sys_get_temp_dir() . '\\tp_' . uniqid() . '.bin';
    $tmpPs  = sys_get_temp_dir() . '\\tp_' . uniqid() . '.ps1';

    file_put_contents($tmpBin, $escposData, LOCK_EX);

    $escapedBin     = str_replace("'", "''", $tmpBin);
    $escapedPrinter = str_replace("'", "''", $printerName);

    // Script PowerShell com P/Invoke para envio RAW
    $ps = <<<PSEOF
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WinRaw {
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint="ClosePrinter")]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, IntPtr pdi);

    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter")]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter")]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter")]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
}
"@ -Language CSharp

\$data    = [System.IO.File]::ReadAllBytes('$escapedBin')
\$pName   = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('$escapedPrinter')
\$pType   = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('RAW')
\$pDoc    = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('TicketPro')

# DOCINFOA: pDocName, pOutputFile, pDataType (3 pointers)
\$ptrSize = [IntPtr]::Size
\$docInfo = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(\$ptrSize * 3)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$docInfo, 0,            \$pDoc)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$docInfo, \$ptrSize,     [IntPtr]::Zero)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$docInfo, \$ptrSize * 2, \$pType)

\$hPrinter = [IntPtr]::Zero
[WinRaw]::OpenPrinter('$escapedPrinter', [ref]\$hPrinter, [IntPtr]::Zero) | Out-Null

[WinRaw]::StartDocPrinter(\$hPrinter, 1, \$docInfo) | Out-Null
[WinRaw]::StartPagePrinter(\$hPrinter) | Out-Null

\$ptr     = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(\$data.Length)
[System.Runtime.InteropServices.Marshal]::Copy(\$data, 0, \$ptr, \$data.Length)
\$written = 0
[WinRaw]::WritePrinter(\$hPrinter, \$ptr, \$data.Length, [ref]\$written) | Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$ptr)

[WinRaw]::EndPagePrinter(\$hPrinter)  | Out-Null
[WinRaw]::EndDocPrinter(\$hPrinter)   | Out-Null
[WinRaw]::ClosePrinter(\$hPrinter)    | Out-Null

[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$pName)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$pType)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$pDoc)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$docInfo)

Remove-Item -LiteralPath '$escapedBin' -Force -ErrorAction SilentlyContinue
Write-Host "OK:\$written bytes enviados."
PSEOF;

    file_put_contents($tmpPs, $ps, LOCK_EX);

    exec("powershell -NonInteractive -ExecutionPolicy Bypass -File \"{$tmpPs}\" 2>&1",
         $output, $code);

    @unlink($tmpPs);

    if ($code !== 0) {
        $detail = implode(' | ', array_slice($output, 0, 5));
        throw new Exception("Falha RAW print em '{$printerName}'. Código: {$code}. {$detail}");
    }

    error_log('[TicketPro] RAW print OK: ' . implode(' ', $output));
}

/**
 * Envia ESC/POS via TCP/IP direto na porta 9100.
 */
function printNetwork(array $printer, string $data): void
{
    $ip   = $printer['ip'];
    $port = $printer['port'] ?? 9100;

    $sock = @fsockopen($ip, $port, $errno, $errstr, 5);
    if (!$sock) {
        throw new Exception("Falha ao conectar via IP/Rede em {$ip}:{$port}.\nErro: {$errstr} ({$errno})\n\n💡 Verifique se o outro computador/impressora está ligado, se o VSPE está rodando e escutando na porta {$port}, e se o Firewall do Windows permite tráfego nessa porta.");
    }

    fwrite($sock, $data);
    fclose($sock);
}

/**
 * Busca flexível de terminal por ID, nome, cashNumber ou aproximação alfanumérica.
 */
function findTerminalFlex(?array $terminals, ?string $terminalIdOrInput): ?array
{
    if (empty($terminalIdOrInput) || empty($terminals)) {
        return null;
    }
    
    $inputUpper = trim(strtoupper($terminalIdOrInput));
    $inputDigits = preg_replace('/\D/', '', $inputUpper);

    // 1. Tenta correspondência exata por ID
    foreach ($terminals as $t) {
        if (strcasecmp(trim($t['id']), $inputUpper) === 0) {
            return $t;
        }
    }

    // 2. Tenta correspondência exata por Nome
    foreach ($terminals as $t) {
        if (isset($t['name']) && strcasecmp(trim($t['name']), $inputUpper) === 0) {
            return $t;
        }
    }

    // 3. Tenta correspondência numérica com o cashNumber
    if ($inputDigits !== '') {
        foreach ($terminals as $t) {
            if (isset($t['cashNumber']) && (string)$t['cashNumber'] === $inputDigits) {
                return $t;
            }
        }
    }

    // 4. Tenta correspondência flexível removendo caracteres não-alfanuméricos
    $cleanInput = preg_replace('/[^A-Z0-9]/', '', $inputUpper);
    if ($cleanInput !== '') {
        foreach ($terminals as $t) {
            $cleanId = preg_replace('/[^A-Z0-9]/', '', strtoupper($t['id']));
            $cleanName = isset($t['name']) ? preg_replace('/[^A-Z0-9]/', '', strtoupper($t['name'])) : '';
            if ($cleanId === $cleanInput || $cleanName === $cleanInput || strpos($cleanId, $cleanInput) !== false || strpos($cleanName, $cleanInput) !== false) {
                return $t;
            }
        }
    }

    return null;
}
