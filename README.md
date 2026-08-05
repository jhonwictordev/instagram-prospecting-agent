# Instagram Prospecting Agent

Automação local e conservadora para localizar perfis comerciais públicos, qualificá-los e preparar mensagens. O envio é bloqueado por padrão. Este projeto não resolve CAPTCHA, não usa stealth/proxy e não contorna limites ou intervenções do Instagram. Revise os Termos do Instagram e a legislação aplicável (incluindo LGPD) antes de usar.

## Requisitos

- Windows 10/11, Node.js 22.13+ e Brave instalado.
- Docker Desktop com WSL 2 para PostgreSQL e n8n.
- Uma conta do Instagram acessada manualmente. Nunca coloque usuário, senha ou cookies no `.env`.

## Instalação

No PowerShell:

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run typecheck
npm.cmd test
docker compose up -d postgres n8n
```

Edite `.env` e troque obrigatoriamente `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY` e `BROWSER_WORKER_API_KEY` (mínimo de 16 caracteres). Gere segredos, por exemplo, com `[guid]::NewGuid().ToString('N')`.

### Opção A — recomendada no Windows

Execute PostgreSQL e n8n no Docker e o browser-worker no Windows, permitindo que ele abra o Brave gráfico:

```powershell
docker compose up -d postgres n8n
npm.cmd -w @ipa/browser-worker run dev
Invoke-RestMethod http://localhost:3001/health
```

O n8n usa `http://host.docker.internal:3001`. Se o Brave não for detectado, configure `BRAVE_EXECUTABLE_PATH`. `BRAVE_USER_DATA_DIR` deve apontar para um perfil dedicado e persistente; não use seu perfil pessoal principal.

### Opção B — worker em contêiner

Somente para um host Linux com navegador disponível e configuração gráfica adequada; o contêiner Linux não abre o Brave instalado no Windows. Para execução headless compatível:

```powershell
docker compose --profile worker up -d --build
```

O Dockerfile não instala o Brave. Monte/instale um executável compatível e configure `BRAVE_EXECUTABLE_PATH`; para login inicial gráfico, prefira a opção A.

## Login manual

Com o worker ativo:

```powershell
$headers = @{ Authorization = "Bearer $((Get-Content .env | Select-String '^BROWSER_WORKER_API_KEY=').Line.Split('=')[1])" }
Invoke-RestMethod -Method Post -Uri http://localhost:3001/session/open -Headers $headers
```

Faça login manualmente no Brave. Depois consulte `/session/status`. CAPTCHA, checkpoint, atividade incomum ou bloqueio retornam `platform_intervention_required` e exigem interrupção e ação humana.

## n8n e workflows

Abra `http://localhost:5678`, crie as credenciais PostgreSQL (`host=postgres`, banco/usuário/senha do `.env`) e importe, nesta ordem:

1. `n8n/workflows/error-handler.json`;
2. `n8n/workflows/instagram-prospecting.json`.

Substitua os placeholders de credenciais, salve o workflow de erro, copie seu ID e configure-o como workflow de erro do fluxo principal. Configure a credencial Telegram placeholder ou substitua esse nó por e-mail. Ative o workflow e chame o webhook exibido pelo n8n.

Exemplo seguro:

```powershell
$body = @{
  niche='imobiliária'; location='Maceió'; additionalTerms=@('imóveis Maceió')
  message='Olá {{displayName}}, trabalho com soluções para {{niche}} em {{location}}.'
  maximumContacts=5; minimumDelaySeconds=90; maximumDelaySeconds=240
  allowedStart='09:00'; allowedEnd='18:00'; executionMode='approval'
  excludedKeywords=@('pessoal','fã clube'); dryRun=$true
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:5678/webhook/instagram-prospecting -ContentType application/json -Body $body
```

O workflow principal possui 32 nós e implementa validação, campanha/execução, verificação de sessão, combinações de busca, deduplicação, blocklist, processamento sequencial, classificação, personalização, janela operacional, espera aleatória, preparação/envio e relatório. As requisições ao Instagram têm até três tentativas; qualquer alerta da plataforma interrompe a execução.

O Telegram do workflow de erro é um placeholder desativado. Depois de criar a credencial real e informar o chat, habilite o nó `Notify Telegram (placeholder)`. O registro do erro no PostgreSQL funciona independentemente da notificação.

## Modos e interrupção

- `dryRun=true`: nunca envia.
- `approval` (padrão): o workflow chama `/message/prepare`, registra a mensagem e retorna `status=awaiting_approval`, além de um `outreachMessageId` e um `approvalToken` por item. Nada é enviado nessa etapa.
- `automatic`: requer simultaneamente `AUTOMATIC_MODE_ENABLED=true`, `dryRun=false` e ausência de emergência.
- Emergência: defina `EMERGENCY_STOP=true` e reinicie o worker. Novos envios serão recusados.

Os limites padrão são 10 contatos, teto absoluto 20 e intervalo de 90–240 segundos. O banco possui índice que permite apenas uma execução `running`. URLs/usernames, campanha+prospect e prospect+mensagem têm restrições de unicidade. A tabela `blocklist` é permanente.

### Aprovação humana explícita

Revise no Brave o texto preenchido e os campos retornados em `approvals`. Para aprovar um item específico, chame a rota local protegida. O token deve corresponder ao ID da mensagem preparada:

```powershell
$headers = @{ Authorization = "Bearer $((Get-Content .env | Select-String '^BROWSER_WORKER_API_KEY=').Line.Split('=')[1])" }
$approval = @{
  outreachMessageId = 'UUID_RETORNADO_PELO_WORKFLOW'
  approvalToken = 'UUID_RETORNADO_PELO_WORKFLOW'
  approved = $true
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3001/message/approve -Headers $headers -ContentType application/json -Body $approval
```

A rota só aceita mensagens previamente registradas como `prepared`, respeita `EMERGENCY_STOP`, verifica novamente se já existe mensagem idêntica na conversa e atualiza o banco após o envio. Não reutilize tokens e não aprove mensagens sem revisar o perfil e o conteúdo.

## Consultas úteis

```powershell
docker compose exec postgres psql -U prospecting -d instagram_prospecting -c "select * from executions order by started_at desc;"
docker compose exec postgres psql -U prospecting -d instagram_prospecting -c "select username,qualification_status,do_not_contact from prospects;"
docker compose exec postgres psql -U prospecting -d instagram_prospecting -c "insert into blocklist(username,reason) values ('perfil','solicitação de exclusão');"
```

## Seletores e diagnóstico

Todos os seletores estão em `apps/browser-worker/src/instagram/selectors.ts`, com alternativas em português e inglês. Quando o compositor falha, o worker salva screenshot local mascarando o campo de mensagem em `storage/diagnostics`; revise e apague imagens após o diagnóstico. Nunca as envie automaticamente.

## Desenvolvimento e testes

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Os testes usam mocks e não acessam contas reais. Cobrem validação/teto, deduplicação, personalização, blocklist, contador de erros, autenticação, dry-run, aprovação e bloqueio do automático.

## Solução de problemas

- `Brave not found`: defina o caminho absoluto em `BRAVE_EXECUTABLE_PATH`.
- `LOGIN_REQUIRED`: execute `/session/open` e faça login manual.
- `401 UNAUTHORIZED`: confira se o mesmo `BROWSER_WORKER_API_KEY` está no worker e no n8n.
- n8n não alcança o worker: mantenha `BROWSER_WORKER_URL=http://host.docker.internal:3001`.
- migration não reaplicada: scripts de init só rodam em volume PostgreSQL novo; aplique o SQL manualmente em bancos existentes.
- seletor falhou: consulte `storage/diagnostics`, atualize apenas `selectors.ts` e rode os testes.
- `platform_intervention_required`: pare; resolva manualmente no navegador. Não automatize o contorno.
- n8n demora para iniciar: em computadores com poucos núcleos, aguarde o log `Activated workflow` antes de chamar o webhook; o `/healthz` pode responder alguns instantes antes do registro da rota.

## Limitações conhecidas

O Instagram muda interface e seletores sem aviso; a extração é heurística e não usa API oficial. Seguidores, categoria e localização podem não estar disponíveis. A aprovação é feita pela API REST local, não por uma tela dedicada no n8n. A aplicação não garante conformidade legal nem permissão para mensagens; isso cabe ao operador. O botão de emergência via `.env` exige reinício do worker.
