# ============================================================
#  INSTALAR_PHP.ps1 - Instalador automatico do PHP para Windows
#  TicketPro PDV - Servidor PHP Embutido
# ============================================================

$phpDir  = "$env:LOCALAPPDATA\php"
$phpZip  = "$env:TEMP\php_ticketpro.zip"
$iniFile = "$phpDir\php.ini"

Write-Host ""
Write-Host "  =================================================" -ForegroundColor Cyan
Write-Host "   INSTALADOR AUTOMATICO DO PHP - TicketPro PDV   " -ForegroundColor Cyan
Write-Host "  =================================================" -ForegroundColor Cyan
Write-Host ""

# ── PASSO 1: Encontrar versão mais recente ──────────────────
Write-Host " [1/5] Verificando versao do PHP..." -ForegroundColor Yellow

# URL direta da versao mais recente (PHP 8.5.6 - VS17 x64 Thread Safe)
$downloadUrl = "https://downloads.php.net/~windows/releases/archives/php-8.5.6-Win32-vs17-x64.zip"
Write-Host "      Versao selecionada: PHP 8.5.6 (VS17 x64 Thread Safe)" -ForegroundColor Green

# ── PASSO 2: Baixar ────────────────────────────────────────
Write-Host ""
Write-Host " [2/5] Baixando PHP de:" -ForegroundColor Yellow
Write-Host "       $downloadUrl" -ForegroundColor DarkGray

try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $phpZip -UseBasicParsing -TimeoutSec 120
    Write-Host "      Download concluido!" -ForegroundColor Green
} catch {
    Write-Host "      ERRO no download: $_" -ForegroundColor Red
    Write-Host "      Verifique sua conexao com a internet." -ForegroundColor Red
    Read-Host "  Pressione ENTER para sair"
    exit 1
}

# ── PASSO 3: Extrair ────────────────────────────────────────
Write-Host ""
Write-Host " [3/5] Instalando em: $phpDir" -ForegroundColor Yellow
if (Test-Path $phpDir) {
    Remove-Item $phpDir -Recurse -Force
}
New-Item -ItemType Directory -Path $phpDir | Out-Null
Expand-Archive -Path $phpZip -DestinationPath $phpDir -Force
Remove-Item $phpZip -Force
Write-Host "      Arquivos extraidos!" -ForegroundColor Green

# ── PASSO 4: Configurar php.ini ────────────────────────────
Write-Host ""
Write-Host " [4/5] Configurando PHP (php.ini)..." -ForegroundColor Yellow
Copy-Item "$phpDir\php.ini-development" $iniFile -Force

# Habilita extensoes necessarias
$ini = Get-Content $iniFile -Raw
$ini = $ini -replace ";extension=sockets",  "extension=sockets"   # Impressora rede TCP
$ini = $ini -replace ";extension=openssl",  "extension=openssl"   # HTTPS
$ini = $ini -replace ";extension=mbstring", "extension=mbstring"  # Strings Unicode
$ini = $ini -replace ";extension=json",     "extension=json"      # JSON (PHP 8+: ja ativo)
Set-Content $iniFile $ini -Encoding UTF8
Write-Host "      Extensoes habilitadas: sockets, openssl, mbstring" -ForegroundColor Green

# ── PASSO 5: Adicionar ao PATH do usuario ──────────────────
Write-Host ""
Write-Host " [5/5] Adicionando PHP ao PATH do usuario..." -ForegroundColor Yellow
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$phpDir*") {
    $newPath = "$currentPath;$phpDir"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    # Tambem atualiza na sessao atual
    $env:PATH = "$env:PATH;$phpDir"
    Write-Host "      PATH atualizado!" -ForegroundColor Green
} else {
    Write-Host "      PHP ja esta no PATH." -ForegroundColor DarkGray
}

# ── VERIFICACAO FINAL ────────────────────────────────────────
Write-Host ""
Write-Host "  =================================================" -ForegroundColor Cyan
$phpVersion = & "$phpDir\php.exe" --version 2>&1 | Select-Object -First 1
Write-Host "   $phpVersion" -ForegroundColor Green
Write-Host ""
Write-Host "   PHP instalado com sucesso!" -ForegroundColor Green
Write-Host "   Local: $phpDir" -ForegroundColor DarkGray
Write-Host "  =================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Agora inicie o sistema com o arquivo:" -ForegroundColor White
Write-Host "  >> INICIAR_PHP.bat <<" -ForegroundColor Yellow
Write-Host ""
