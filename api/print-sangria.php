<?php
/**
 * POST /api/print-sangria — Imprime comprovante de Sangria de Caixa.
 */

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

// Resolve impressora: terminal → primeiro Windows → primeiro com IP
$printer = null;
$terminalId = $payload['terminal'] ?? null;

if ($terminalId && !empty($db['terminals'])) {
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
if (!$printer) {
    foreach ($db['printers'] as $p) {
        if (!empty($p['useWindowsPrinter']) && !empty($p['systemName'])) { $printer = $p; break; }
    }
}
if (!$printer) {
    foreach ($db['printers'] as $p) {
        if (!empty($p['ip'])) { $printer = $p; break; }
    }
}
if (!$printer) {
    http_response_code(404);
    echo json_encode(['error' => 'Nenhuma impressora disponível.']);
    exit;
}

// Dados da sangria
$valor    = floatval($payload['valor']    ?? 0);
$motivo   = $payload['motivo']   ?? 'Sangria';
$operador = strtoupper($payload['operador'] ?? 'N/A');
$terminal = strtoupper($payload['terminal'] ?? 'PDV');
$dt       = date('d/m/Y H:i:s', strtotime($payload['timestamp'] ?? 'now'));

// Gera ESC/POS
$escpos = buildSangriaEscPos($valor, $motivo, $operador, $terminal, $dt, $printer);

try {
    if (!empty($printer['useWindowsPrinter'])) {
        printWindowsRaw($printer['systemName'], $escpos);
    } else {
        printNetwork($printer, $escpos);
    }
    echo json_encode(['success' => true, 'printerName' => $printer['name']]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}

// ─────────────────────────────────────────────────────────────────────────────

function buildSangriaEscPos(float $valor, string $motivo, string $op,
                             string $terminal, string $dt, array $printer): string
{
    $ESC = "\x1b";
    $GS  = "\x1d";
    $LF  = "\n";

    $INIT     = $ESC . "@";
    $CENTER   = $ESC . "a\x01";
    $LEFT     = $ESC . "a\x00";
    $BOLD_ON  = $ESC . "E\x01";
    $BOLD_OFF = $ESC . "E\x00";
    $NORM     = $GS  . "!\x00";

    $activeCut   = !isset($printer['activeCut'])   || $printer['activeCut']   !== false;
    $linesBefore = max(0, intval($printer['linesBefore'] ?? 3));
    $CUT = $GS . "V\x01";

    $cols   = intval($printer['paperWidth'] ?? 32);
    $border = str_repeat('=', $cols);
    $sep    = str_repeat('-', $cols);

    // Trunca o motivo para caber na largura
    $motivo = wordwrap($motivo, $cols, "\n", true);

    $valorFmt = 'R$ ' . number_format($valor, 2, ',', '.');

    $out = $INIT;
    $out .= $CENTER;
    $out .= $NORM . $border . $LF;
    $out .= $BOLD_ON . "SANGRIA DE CAIXA" . $BOLD_OFF . $LF;
    $out .= $border . $LF;
    $out .= $LEFT;
    $out .= "Terminal : {$terminal}" . $LF;
    $out .= "Operador : {$op}" . $LF;
    $out .= "Data/Hora: {$dt}" . $LF;
    $out .= $sep . $LF;
    $out .= $BOLD_ON . "Motivo:" . $BOLD_OFF . $LF;
    $out .= $motivo . $LF;
    $out .= $sep . $LF;
    $out .= $CENTER;
    $out .= $BOLD_ON . $valorFmt . $BOLD_OFF . $LF;
    $out .= $NORM . $border . $LF;
    $out .= $LEFT;

    if ($linesBefore > 0) $out .= str_repeat($LF, $linesBefore);
    if ($activeCut)       $out .= $CUT;

    return $out;
}

function printWindowsRaw(string $printerName, string $escposData): void
{
    $tmpBin = sys_get_temp_dir() . '\\tp_sg_' . uniqid() . '.bin';
    $tmpPs  = sys_get_temp_dir() . '\\tp_sg_' . uniqid() . '.ps1';
    file_put_contents($tmpBin, $escposData, LOCK_EX);

    $escapedBin     = str_replace("'", "''", $tmpBin);
    $escapedPrinter = str_replace("'", "''", $printerName);

    $ps = <<<PSEOF
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinRaw2 {
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
\$data=  [System.IO.File]::ReadAllBytes('$escapedBin')
\$pName = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('$escapedPrinter')
\$pType = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('RAW')
\$pDoc  = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('Sangria')
\$ptrSz = [IntPtr]::Size
\$di    = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(\$ptrSz * 3)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$di, 0,          \$pDoc)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$di, \$ptrSz,    [IntPtr]::Zero)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$di, \$ptrSz*2,  \$pType)
\$hP = [IntPtr]::Zero
[WinRaw2]::OpenPrinter('$escapedPrinter', [ref]\$hP, [IntPtr]::Zero) | Out-Null
[WinRaw2]::StartDocPrinter(\$hP, 1, \$di) | Out-Null
[WinRaw2]::StartPagePrinter(\$hP) | Out-Null
\$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(\$data.Length)
[System.Runtime.InteropServices.Marshal]::Copy(\$data, 0, \$ptr, \$data.Length)
\$wr = 0; [WinRaw2]::WritePrinter(\$hP, \$ptr, \$data.Length, [ref]\$wr) | Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$ptr)
[WinRaw2]::EndPagePrinter(\$hP) | Out-Null
[WinRaw2]::EndDocPrinter(\$hP)  | Out-Null
[WinRaw2]::ClosePrinter(\$hP)   | Out-Null
Remove-Item -LiteralPath '$escapedBin' -Force -ErrorAction SilentlyContinue
Write-Host "OK:\$wr bytes."
PSEOF;

    file_put_contents($tmpPs, $ps, LOCK_EX);
    exec("powershell -NonInteractive -ExecutionPolicy Bypass -File \"{$tmpPs}\" 2>&1", $out, $code);
    @unlink($tmpPs);
    if ($code !== 0) throw new Exception("RAW print falhou. " . implode(' | ', array_slice($out, 0, 5)));
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
