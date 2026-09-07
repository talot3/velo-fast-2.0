<?php
/**
 * POST /api/print-test
 * Envia uma ficha de teste ESC/POS para a impressora especificada.
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
if ($payload === null) {
    http_response_code(400);
    echo json_encode(['error' => 'JSON inválido.']);
    exit;
}

$db = json_decode(file_get_contents(DB_FILE), true);
if (!$db || empty($db['printers'])) {
    http_response_code(500);
    echo json_encode(['error' => 'Nenhuma impressora cadastrada.']);
    exit;
}

$printerId = $payload['printerId'] ?? null;
if ($printerId === null) {
    http_response_code(400);
    echo json_encode(['error' => 'ID da impressora não informado.']);
    exit;
}

$printer = null;
foreach ($db['printers'] as $p) {
    if ((string)$p['id'] === (string)$printerId) {
        $printer = $p;
        break;
    }
}

if (!$printer) {
    http_response_code(404);
    echo json_encode(['error' => 'Impressora não encontrada.']);
    exit;
}

try {
    // Transação de teste
    $testTx = [[
        'productName'   => '*** TESTE DE IMPRESSORA ***',
        'paymentMethod' => 'TESTE',
        'terminalId'    => 'PORTAL',
        'operator'      => 'ADMIN',
        'timestamp'     => date('c'),
    ]];

    // Gera bytes ESC/POS de teste usando a mesma estrutura de print.php
    $escpos = buildTestEscPos($testTx, 'ADMIN', 'PORTAL', $printer, $db);

    if (!empty($printer['useWindowsPrinter'])) {
        if (empty($printer['systemName'])) {
            throw new Exception("Nome exato da impressora no Windows não configurado.");
        }
        printWindowsRaw($printer['systemName'], $escpos);
    } else {
        if (empty($printer['ip'])) {
            throw new Exception("IP da impressora não configurado.");
        }
        printNetwork($printer, $escpos);
    }

    echo json_encode([
        'success'     => true,
        'printerName' => $printer['name'],
        'printerType' => !empty($printer['useWindowsPrinter']) ? 'windows' : 'network'
    ]);

} catch (Exception $e) {
    error_log('[TicketPro] Erro no teste: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Funções auxiliares baseadas em print.php para auto-suficiência do arquivo

function buildTestEscPos(array $txs, string $operator, ?string $terminalId, array $printer, array $db = []): string
{
    $ESC = "\x1b"; $GS  = "\x1d"; $LF  = "\n";
    $INIT     = $ESC . "@";
    $CENTER   = $ESC . "a\x01";
    $LEFT     = $ESC . "a\x00";
    $BOLD_ON  = $ESC . "E\x01";
    $BOLD_OFF = $ESC . "E\x00";
    $NORM     = $GS  . "!\x00";
    $SIZE_2X2 = $GS  . "!\x11";

    $activeCut    = !isset($printer['activeCut'])    || $printer['activeCut']    !== false;
    $linesBefore  = max(0, intval($printer['linesBefore']  ?? 4));
    $linesAfter   = max(0, intval($printer['linesAfter']   ?? 0));
    $alignSpacing = max(0, intval($printer['alignSpacing'] ?? 2));
    $CUT          = $GS . "V\x01";

    $cols   = intval($printer['paperWidth'] ?? 48);
    $border = str_repeat('=', $cols);
    $sep    = str_repeat('-', $cols);

    $ticketConfig = $db['ticketConfig'] ?? [];
    $titleTicket  = $ticketConfig['titleTicket'] ?? 'TICKET 1-A-1';
    $titleFicha   = $ticketConfig['titleFicha']  ?? 'ficha';

    $out = $INIT;
    foreach ($txs as $idx => $tx) {
        $product = $tx['productName'] ?? 'PRODUTO';
        $tid     = strtoupper($terminalId ?? 'PDV');
        $dt      = date('d/m/Y H:i:s', strtotime($tx['timestamp']));
        $op      = strtoupper($operator);
        $method  = strtoupper($tx['paymentMethod'] ?? '');
        $num     = str_pad($idx + 1, 2, '0', STR_PAD_LEFT);

        if ($idx > 0 && $alignSpacing > 0) {
            $out .= str_repeat($LF, $alignSpacing);
        }

        $out .= $CENTER;
        $out .= $NORM . $border . $LF;
        $out .= $SIZE_2X2 . $BOLD_ON . $titleFicha . $BOLD_OFF . $LF;
        $out .= $NORM;
        $out .= "{$titleTicket}  -  {$tid}" . $LF;
        $out .= "#{$num}  -  {$dt}" . $LF;
        $out .= $sep . $LF;
        $out .= $SIZE_2X2 . $BOLD_ON . $product . $BOLD_OFF . $LF;
        $out .= $NORM;
        $out .= "OP: {$op}  |  {$method}" . $LF;
        $out .= $border . $LF;

        if ($linesBefore > 0) $out .= str_repeat($LF, $linesBefore);
        if ($activeCut)       $out .= $CUT;
        if ($linesAfter > 0)  $out .= str_repeat($LF, $linesAfter);
        $out .= $LEFT;
    }
    return $out;
}

function printWindowsRaw(string $printerName, string $escposData): void
{
    $tmpBin = sys_get_temp_dir() . '\\tp_tst_' . uniqid() . '.bin';
    $tmpPs  = sys_get_temp_dir() . '\\tp_tst_' . uniqid() . '.ps1';

    file_put_contents($tmpBin, $escposData, LOCK_EX);

    $escapedBin     = str_replace("'", "''", $tmpBin);
    $escapedPrinter = str_replace("'", "''", $printerName);

    $ps = <<<PSEOF
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinRawTst {
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
\$data  = [System.IO.File]::ReadAllBytes('$escapedBin')
\$pName = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('$escapedPrinter')
\$pType = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('RAW')
\$pDoc  = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('TicketProTest')
\$ptrSize = [IntPtr]::Size
\$docInfo = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(\$ptrSize * 3)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$docInfo, 0,            \$pDoc)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$docInfo, \$ptrSize,     [IntPtr]::Zero)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$docInfo, \$ptrSize * 2, \$pType)
\$hPrinter = [IntPtr]::Zero
[WinRawTst]::OpenPrinter('$escapedPrinter', [ref]\$hPrinter, [IntPtr]::Zero) | Out-Null
[WinRawTst]::StartDocPrinter(\$hPrinter, 1, \$docInfo) | Out-Null
[WinRawTst]::StartPagePrinter(\$hPrinter) | Out-Null
\$ptr     = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(\$data.Length)
[System.Runtime.InteropServices.Marshal]::Copy(\$data, 0, \$ptr, \$data.Length)
\$written = 0
[WinRawTst]::WritePrinter(\$hPrinter, \$ptr, \$data.Length, [ref]\$written) | Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$ptr)
[WinRawTst]::EndPagePrinter(\$hPrinter)  | Out-Null
[WinRawTst]::EndDocPrinter(\$hPrinter)   | Out-Null
[WinRawTst]::ClosePrinter(\$hPrinter)    | Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$pName)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$pType)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$pDoc)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$docInfo)
Remove-Item -LiteralPath '$escapedBin' -Force -ErrorAction SilentlyContinue
Write-Host "OK:\$written"
PSEOF;

    file_put_contents($tmpPs, $ps, LOCK_EX);
    exec("powershell -NonInteractive -ExecutionPolicy Bypass -File \"{$tmpPs}\" 2>&1", $output, $code);
    @unlink($tmpPs);

    if ($code !== 0) {
        $detail = implode(' | ', array_slice($output, 0, 5));
        throw new Exception("Falha no spooler do Windows '{$printerName}': {$detail}");
    }
}

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
