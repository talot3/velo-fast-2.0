# VELO FAST — Vercel, Supabase e impressão online

## Arquitetura

A aplicação web roda na Vercel. O estado compartilhado de cada loja fica em `velo_app_state` no Supabase e os pedidos de impressão ficam em `velo_print_jobs`. A Vercel não consegue abrir TCP para uma impressora dentro da rede da loja; o `scripts/print-agent.js` roda em um computador Windows da loja, consulta a fila e imprime localmente.

Esse agente é necessário tanto para impressora Ethernet quanto para uma impressora compartilhada por outro computador Windows. Ele não substitui nenhuma funcionalidade do PDV: apenas transporta o trabalho de impressão da nuvem até a rede local.

## Supabase

1. Crie um projeto no Supabase.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Migre o conteúdo atual de `date/db.json` para uma linha em `velo_app_state`, com `store_id` igual ao ID da loja. A coluna `state` deve receber o JSON completo do banco atual.
4. Não exponha a `SUPABASE_SERVICE_ROLE_KEY` no navegador.

## Variáveis na Vercel

- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: chave service role, somente no ambiente servidor.
- `VELO_DEFAULT_STORE_ID`: ID da loja padrão, por exemplo `15476`.
- `VELO_AGENT_TOKEN`: token aleatório usado pelo agente Windows.

## Deploy

Na raiz que contém `package.json`, `vercel.json`, `api/`, `portal/` e `pdv/`:

```bash
npm install
vercel --prod
```

O arquivo `vercel.json` envia `/api/*` para a função serverless e mantém `/portal/` e `/pdv/` como arquivos estáticos.

## Agente Windows de impressão

No computador Windows que enxerga a impressora:

```powershell
npm install
$env:SUPABASE_URL="https://SEU-PROJETO.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="CHAVE-SOMENTE-NESTE-COMPUTADOR"
$env:VELO_STORE_ID="15476"
$env:VELO_AGENT_TOKEN="MESMO_TOKEN_DA_VERCEL"
node scripts/print-agent.js
```

Para impressora Ethernet, configure no portal `ip` e `port` (normalmente `9100`) e deixe `useWindowsPrinter` como `false`.

Para impressora compartilhada pelo Windows, execute o agente no computador que possui a impressora instalada/compartilhada e configure `useWindowsPrinter: true` e `systemName` com o nome do compartilhamento, por exemplo `\\CAIXA01\\EPSON`.

O agente deve ser instalado como tarefa agendada do Windows para iniciar com o computador e permanecer ativo. A chave service role deve ficar somente nesse computador confiável; nunca coloque-a em código do navegador.

## Limitações importantes

A migração online requer copiar o conteúdo existente para o Supabase. O projeto original possui dados em SQLite/JSON e lógica local; a camada online nova não usa o filesystem da Vercel. A operação local original continua disponível para testes e contingência, mas o deploy online usa Supabase.
