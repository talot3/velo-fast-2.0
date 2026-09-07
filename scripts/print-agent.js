const net = require('net');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { getState, claimPrintJob, finishPrintJob, defaultStoreId } = require('../api/supabase-store');

const STORE_ID = process.env.VELO_STORE_ID || defaultStoreId();
const POLL_MS = Number(process.env.VELO_PRINT_POLL_MS || 2500);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function buildEscPos(txs, operator, terminalId, printer, state) {
  const ESC='\x1b', GS='\x1d', LF='\n';
  const activeCut = printer.activeCut !== false;
  const before = Math.max(0, Number(printer.linesBefore ?? 4));
  const after = Math.max(0, Number(printer.linesAfter ?? 0));
  const spacing = Math.max(0, Number(printer.alignSpacing ?? 2));
  const cols = Number(printer.paperWidth ?? 48);
  const border = '='.repeat(cols), sep = '-'.repeat(cols);
  const cfg = state.ticketConfig || {};
  let out = ESC+'@';
  for (const [idx, tx] of txs.entries()) {
    if (idx > 0) out += LF.repeat(spacing);
    const product = tx.productName ?? 'PRODUTO';
    const tid = String(terminalId ?? tx.terminalId ?? 'PDV').toUpperCase();
    const dt = new Date(tx.timestamp ?? Date.now()).toLocaleString('pt-BR');
    const op = String(operator ?? tx.operator ?? 'N/A').toUpperCase();
    const method = String(tx.paymentMethod ?? '').toUpperCase();
    out += ESC+'a\x01'+GS+'!\x00'+border+LF;
    out += GS+'!\x11'+ESC+'E\x01'+(cfg.titleFicha ?? 'ficha')+ESC+'E\x00'+LF;
    out += GS+'!\x00'+(cfg.titleTicket ?? 'TICKET 1-A-1')+'  -  '+tid+LF;
    out += '#'+String(idx+1).padStart(2,'0')+'  -  '+dt+LF+sep+LF;
    out += GS+'!\x11'+ESC+'E\x01'+product+ESC+'E\x00'+LF;
    out += GS+'!\x00'+'OP: '+op+'  |  '+method+LF+border+LF;
    out += LF.repeat(before);
    if (activeCut) out += GS+'V\x01';
    out += LF.repeat(after)+ESC+'a\x00';
  }
  return Buffer.from(out, 'binary');
}
function printTcp(printer, buffer) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(Number(printer.port || 9100), printer.ip);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Timeout na impressora Ethernet')); }, 7000);
    socket.once('error', reject);
    socket.once('connect', () => socket.end(buffer, () => { clearTimeout(timer); resolve(); }));
  });
}
async function printWindows(printer, buffer) {
  if (process.platform !== 'win32') throw new Error('Impressora compartilhada exige agente executando no Windows.');
  const tmp = `${os.tmpdir()}\\velo-${Date.now()}.bin`;
  fs.writeFileSync(tmp, buffer);
  const ps = `$b=[IO.File]::ReadAllBytes('${tmp.replace(/'/g,"''")}'); $p='${String(printer.systemName || '').replace(/'/g,"''")}'; Add-Type -TypeDefinition @'\nusing System; using System.Runtime.InteropServices; public class VeloRaw { [DllImport("winspool.drv", CharSet=CharSet.Ansi)] public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr p); [DllImport("winspool.drv")] public static extern bool ClosePrinter(IntPtr h); [DllImport("winspool.drv", CharSet=CharSet.Ansi)] public static extern bool StartDocPrinter(IntPtr h,int l,IntPtr d); [DllImport("winspool.drv")] public static extern bool EndDocPrinter(IntPtr h); [DllImport("winspool.drv")] public static extern bool StartPagePrinter(IntPtr h); [DllImport("winspool.drv")] public static extern bool EndPagePrinter(IntPtr h); [DllImport("winspool.drv")] public static extern bool WritePrinter(IntPtr h,IntPtr b,int c,out int w); }\n'@; $h=[IntPtr]::Zero; if(-not [VeloRaw]::OpenPrinter($p,[ref]$h,[IntPtr]::Zero)){throw 'Não foi possível abrir a impressora Windows'}; [VeloRaw]::StartDocPrinter($h,1,[IntPtr]::Zero)|Out-Null; [VeloRaw]::StartPagePrinter($h)|Out-Null; $m=[Runtime.InteropServices.Marshal]::AllocHGlobal($b.Length); [Runtime.InteropServices.Marshal]::Copy($b,0,$m,$b.Length); $w=0; [VeloRaw]::WritePrinter($h,$m,$b.Length,[ref]$w)|Out-Null; [Runtime.InteropServices.Marshal]::FreeHGlobal($m); [VeloRaw]::EndPagePrinter($h)|Out-Null; [VeloRaw]::EndDocPrinter($h)|Out-Null; [VeloRaw]::ClosePrinter($h)|Out-Null; Remove-Item '${tmp.replace(/'/g,"''")}' -Force`;
  await execFileAsync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', ps]);
}
async function run() {
  console.log(`[VELO print-agent] loja ${STORE_ID}; consultando a cada ${POLL_MS}ms`);
  while (true) {
    try {
      const job = await claimPrintJob(STORE_ID);
      if (job) {
        try {
          const state = await getState(STORE_ID); const p = job.payload || {};
          let printer = (state.printers || []).find(x => String(x.id) === String(p.printerId));
          if (!printer && p.terminalId) { const t = (state.terminals || []).find(x => String(x.id) === String(p.terminalId)); printer = (state.printers || []).find(x => String(x.id) === String(t?.printerId)); }
          printer ||= (state.printers || [])[0]; if (!printer) throw new Error('Nenhuma impressora configurada');
          const data = Buffer.isBuffer(p.data) ? p.data : buildEscPos(p.transactions || [], p.operator, p.terminalId, printer, state);
          if (printer.useWindowsPrinter) await printWindows(printer, data); else if (printer.ip) await printTcp(printer, data); else throw new Error('Configure IP ou nome Windows da impressora');
          await finishPrintJob(job.id, true); console.log(`[VELO print-agent] job ${job.id} impresso`);
        } catch (e) { await finishPrintJob(job.id, false, e.message); console.error(`[VELO print-agent] job ${job.id}:`, e.message); }
      }
    } catch (e) { console.error('[VELO print-agent] erro:', e.message); }
    await sleep(POLL_MS);
  }
}
run();
