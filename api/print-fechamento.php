<?php
/**
 * POST /api/print-fechamento — Imprime Mapa de Fechamento de Caixa (ESC/POS).
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
    http_response_code(400); echo json_encode(['error' => 'JSON inválido.']); exit;
}

$db = json_decode(file_get_contents(DB_FILE), true);
if (!$db || empty($db['printers'])) {
    http_response_code(500); echo json_encode(['error' => 'Nenhuma impressora cadastrada.']); exit;
}

// Resolve impressora: terminal → primeiro Windows → primeiro com IP
$printer    = null;
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
if (!$printer) foreach ($db['printers'] as $p) { if (!empty($p['useWindowsPrinter']) && !empty($p['systemName'])) { $printer = $p; break; } }
if (!$printer) foreach ($db['printers'] as $p) { if (!empty($p['ip'])) { $printer = $p; break; } }
if (!$printer) { http_response_code(404); echo json_encode(['error' => 'Nenhuma impressora disponível.']); exit; }

$escpos = buildFechamentoEscPos($payload, $printer);

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

function buildFechamentoEscPos(array $d, array $printer): string
{
    $ESC = "\x1b"; $GS = "\x1d"; $LF = "\n";
    $INIT     = $ESC . "@";
    $CENTER   = $ESC . "a\x01";
    $LEFT     = $ESC . "a\x00";
    $BOLD_ON  = $ESC . "E\x01";
    $BOLD_OFF = $ESC . "E\x00";
    $NORM     = $GS  . "!\x00";
    $WIDE     = $GS  . "!\x10";   // fonte dupla largura
    $CUT      = $GS  . "V\x01";

    $activeCut   = !isset($printer['activeCut']) || $printer['activeCut'] !== false;
    $linesBefore = max(0, intval($printer['linesBefore'] ?? 3));
    $cols        = intval($printer['paperWidth'] ?? 32);
    $border      = str_repeat('=', $cols);
    $sep         = str_repeat('-', $cols);

    $terminal    = strtoupper($d['terminal']    ?? 'PDV');
    $operador    = strtoupper($d['operador']    ?? 'N/A');
    $dtAbertura  = $d['dtAbertura']  ?? '—';
    $dtFecha     = $d['dtFechamento'] ?? date('d/m/Y H:i:s');
    $suprimento  = floatval($d['suprimento']  ?? 0);
    $totalVendas = floatval($d['totalVendas'] ?? 0);
    $totalSang   = floatval($d['totalSangrias'] ?? 0);
    $totalLiq    = floatval($d['totalLiquido'] ?? 0);
    $byMethod    = $d['byMethod']    ?? [];
    $sangrias    = $d['sangrias']    ?? [];
    $qtd         = intval($d['qtdTransacoes'] ?? 0);

    $fmt = fn($v) => 'R$ ' . number_format($v, 2, ',', '.');

    $out = $INIT;

    // ── Cabeçalho ──────────────────────────────────────────────────────────────
    $out .= $CENTER . $NORM . $border . $LF;
    $out .= $BOLD_ON . 'FECHAMENTO DE CAIXA' . $BOLD_OFF . $LF;
    $out .= $border . $LF;

    $out .= $LEFT;
    $out .= "Terminal  : {$terminal}" . $LF;
    $out .= "Operador  : {$operador}" . $LF;
    $out .= "Abertura  : {$dtAbertura}" . $LF;
    $out .= "Fechamento: {$dtFecha}" . $LF;
    $out .= $sep . $LF;

    // ── Suprimento ─────────────────────────────────────────────────────────────
    $out .= $BOLD_ON . 'SUPRIMENTO INICIAL' . $BOLD_OFF . $LF;
    $out .= $CENTER . $WIDE . $fmt($suprimento) . $NORM . $LF;
    $out .= $LEFT . $sep . $LF;

    // ── Vendas por forma de pagamento ──────────────────────────────────────────
    $out .= $BOLD_ON . "VENDAS - {$qtd} transacoes" . $BOLD_OFF . $LF;
    if (!empty($byMethod)) {
        foreach ($byMethod as $method => $info) {
            $qtyPart = "  " . intval($info['qty']) . "x";
            $valPart = $fmt(floatval($info['total']));
            $remaining = $cols - strlen($qtyPart);
            $labelLen = max(10, $remaining - 12);
            $label = mb_substr($method, 0, $labelLen);
            $spaces = $remaining - mb_strlen($label) - mb_strlen($valPart);
            if ($spaces < 0) $spaces = 0;
            $line = $label . str_repeat(' ', $spaces) . $valPart . $qtyPart;
            $out  .= $line . $LF;
        }
    } else {
        $out .= 'Nenhuma venda registrada.' . $LF;
    }
    $out .= $sep . $LF;
    
    $lblBruto = 'TOTAL BRUTO:';
    $valBruto = $fmt($totalVendas);
    $spacesBruto = $cols - strlen($lblBruto) - strlen($valBruto);
    if ($spacesBruto < 1) $spacesBruto = 1;
    $out .= $BOLD_ON . $lblBruto . str_repeat(' ', $spacesBruto) . $valBruto . $BOLD_OFF . $LF;
    $out .= $sep . $LF;
 
    // ── Sangrias ────────────────────────────────────────────────────────────────
    $out .= $BOLD_ON . 'SANGRIAS' . $BOLD_OFF . $LF;
    if (!empty($sangrias)) {
        foreach ($sangrias as $s) {
            $valPart = $fmt(floatval($s['valor'] ?? 0));
            $labelLen = max(10, $cols - mb_strlen($valPart) - 1);
            $label = mb_substr($s['motivo'] ?? '', 0, $labelLen);
            $spaces = $cols - mb_strlen($label) - mb_strlen($valPart);
            if ($spaces < 1) $spaces = 1;
            $out  .= $label . str_repeat(' ', $spaces) . $valPart . $LF;
        }
    } else {
        $out .= 'Nenhuma sangria.' . $LF;
    }
    
    $lblSang = 'TOTAL SANGRIAS:';
    $valSang = $fmt($totalSang);
    $spacesSang = $cols - strlen($lblSang) - strlen($valSang);
    if ($spacesSang < 1) $spacesSang = 1;
    $out .= $BOLD_ON . $lblSang . str_repeat(' ', $spacesSang) . $valSang . $BOLD_OFF . $LF;
    $out .= $sep . $LF;

    // ── Total líquido ───────────────────────────────────────────────────────────
    $out .= $CENTER;
    $out .= $BOLD_ON . 'TOTAL LIQUIDO EM CAIXA' . $BOLD_OFF . $LF;
    $out .= $WIDE . $fmt($totalLiq) . $NORM . $LF;
    $out .= $LEFT;

    // ── Rodapé ─────────────────────────────────────────────────────────────────
    $out .= $CENTER . $border . $LF;
    $out .= 'TicketPro - Sistema de Gestao' . $LF;
    $out .= $LEFT;

    if ($linesBefore > 0) $out .= str_repeat($LF, $linesBefore);
    if ($activeCut)       $out .= $CUT;

    return $out;
}

function printWindowsRaw(string $printerName, string $escposData): void
{
    $tmpBin = sys_get_temp_dir() . '\\tp_fc_' . uniqid() . '.bin';
    $tmpPs  = sys_get_temp_dir() . '\\tp_fc_' . uniqid() . '.ps1';
    file_put_contents($tmpBin, $escposData, LOCK_EX);

    $eBin = str_replace("'", "''", $tmpBin);
    $ePrn = str_replace("'", "''", $printerName);

    $ps = <<<PSEOF
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class WinRaw3 {
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA",     SetLastError=true)] public static extern bool OpenPrinter(string s, out IntPtr h, IntPtr p);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter")]                        public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true)] public static extern bool StartDocPrinter(IntPtr h, Int32 l, IntPtr d);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter")]                       public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter")]                    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter")]                      public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter",     SetLastError=true)] public static extern bool WritePrinter(IntPtr h, IntPtr b, Int32 c, out Int32 w);
}
"@ -Language CSharp
\$data=[System.IO.File]::ReadAllBytes('$eBin')
\$pN=[System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('$ePrn')
\$pT=[System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('RAW')
\$pD=[System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi('Fechamento')
\$sz=[IntPtr]::Size; \$di=[System.Runtime.InteropServices.Marshal]::AllocHGlobal(\$sz*3)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$di,0,\$pD)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$di,\$sz,[IntPtr]::Zero)
[System.Runtime.InteropServices.Marshal]::WriteIntPtr(\$di,\$sz*2,\$pT)
\$hP=[IntPtr]::Zero; [WinRaw3]::OpenPrinter('$ePrn',[ref]\$hP,[IntPtr]::Zero)|Out-Null
[WinRaw3]::StartDocPrinter(\$hP,1,\$di)|Out-Null; [WinRaw3]::StartPagePrinter(\$hP)|Out-Null
\$ptr=[System.Runtime.InteropServices.Marshal]::AllocHGlobal(\$data.Length)
[System.Runtime.InteropServices.Marshal]::Copy(\$data,0,\$ptr,\$data.Length)
\$wr=0;[WinRaw3]::WritePrinter(\$hP,\$ptr,\$data.Length,[ref]\$wr)|Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal(\$ptr)
[WinRaw3]::EndPagePrinter(\$hP)|Out-Null;[WinRaw3]::EndDocPrinter(\$hP)|Out-Null;[WinRaw3]::ClosePrinter(\$hP)|Out-Null
Remove-Item -LiteralPath '$eBin' -Force -ErrorAction SilentlyContinue
Write-Host "OK:\$wr"
PSEOF;

    file_put_contents($tmpPs, $ps, LOCK_EX);
    exec("powershell -NonInteractive -ExecutionPolicy Bypass -File \"{$tmpPs}\" 2>&1", $out, $code);
    @unlink($tmpPs);
    if ($code !== 0) throw new Exception('RAW print falhou. ' . implode(' | ', array_slice($out, 0, 5)));
}

function printNetwork(array $printer, string $data): void
{
    $ip   = $printer['ip'];
    $port = $printer['port'] ?? 9100;

    $sock = @fsockopen($ip, $port, $errno, $errstr, 5);
    if (!$sock) {
        throw new Exception("Falha ao conectar via IP/Rede em {$ip}:{$port}.\nErro: {$errstr} ({$errno})\n\n💡 Verifique se o outro computador/impressora está ligado, se o VSPE está rodando e escutando na porta {$port}, e se o Firewall do Windows permite tráfego nessa porta.");
    }
    fwrite($sock, $data); fclose($sock);
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
