# Santê – WhatsApp IA (Moda)

Monorepo simples com API serverless (Vercel + Express), Supabase (Auth + Postgres + RLS + Storage), filas com pg-boss e Workers para sessões WhatsApp (Baileys).

## Requisitos
- Node 18+
- Conta Supabase
- Conta Vercel

## Passo a passo

1) Banco (Supabase)
- Crie um projeto no Supabase
- Rode o arquivo `supabase_schema.sql` (SQL Editor)
- Crie um bucket público no Storage para `SESSION_STORAGE_BUCKET`

2) Variáveis de ambiente

Comuns (Vercel & Workers):
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE (somente backend)
- OPENAI_API_KEY

Vercel (API):
- QUEUE_DB_URL (use a connection string do Postgres do Supabase)
- INTERNAL_WEBHOOK_TOKEN (string secreta para assinar webhooks internos)
 - SESSION_STORAGE_BUCKET (mesmo valor definido no Supabase Storage)
 - INTERNAL_METRICS_TOKEN (token secreto para acessar /api/queue/metrics)

Workers (Railway/Render/Fly):
- INBOUND_URL (ex.: https://seu-dominio.vercel.app/api/inbound)
- INBOUND_TOKEN (mesmo valor do INTERNAL_WEBHOOK_TOKEN)
- SESSION_STORAGE_BUCKET (nome do bucket no Supabase Storage)
- MAX_SESSIONS_PER_NODE (ex.: 50)
- QUEUE_DB_URL

3) Instalação

Na raiz do projeto:

```
npm install
npm --prefix app install
npm --prefix workers/session-node install
```

4) Dev local (API)

```
# Instale o CLI da Vercel se necessário
npm i -g vercel
# Rodar localmente
npm --prefix app run dev
```

5) Deploy
- Vercel: faça import do repositório e configure as envs acima. As rotas serverless estão em `app/api/**/index.ts`.
- Workers: construa a imagem usando o `workers/Dockerfile` em seu provedor (Railway/Render). Configure as envs.

6) Fluxos
- Conectar WhatsApp: POST /api/sessions/create { store_id } → retorna session_id e QR (quando worker enviar `last_qr`). GET /api/sessions/status?session_id=...
- Mensagem recebida: Worker POST /api/inbound com assinatura em `x-inbound-signature`.
- IA: API POST /api/ai/reply (interno), que busca contexto e enfileira /api/send.
- Envio: POST /api/send → pg-boss → Worker envia via Baileys.

7) UI mínima
Abra `https://seu-dominio.vercel.app/` para acessar o painel de operador e `config.html` para configurações.

8) Testes rápidos (smoke)
- API ok: GET `/api/health` deve retornar `{ ok: true }`.
- Sessão/QR: POST `/api/sessions/create { store_id }` → abra a UI e confira QR pelo SSE.
- Envio: selecione conversa na UI e envie mensagem; verifique `messages.status` indo de `queued` → `sent`.
- Inbound: responda no WhatsApp e veja a mensagem chegar na UI e tabela `messages` (direction=in).

9) Métricas da Fila
- Endpoint interno protegido: `GET /api/queue/metrics`
- Header obrigatório: `x-internal-metrics-token: <INTERNAL_METRICS_TOKEN>`
- Retorna JSON com estrutura:
```
{
	"generated_at": "2025-09-17T12:34:56.000Z",
	"overall": { "created": 10, "active": 2, "completed": 120, "failed": 1 },
	"jobs": {
		"send-message": { "created": 3, "completed": 90 },
		"ai-reply": { "created": 7, "failed": 1, "completed": 30 }
	}
}
```
- Cache in-memory de 5s para evitar sobrecarga.
- Use para dashboards ou checks de liveness de backlog.

## Observações
- Este MVP está pronto para evoluir com Baileys real nos workers (não usa Chromium).
- A RLS restringe dados por `store_id` do `owner_id` (auth.uid()).
- Evite expor `SUPABASE_SERVICE_ROLE` no front.

## Migrações Futuras
Para aplicar migrações incrementais (ex.: constraints e índices adicionais):

1. Abra o SQL Editor do Supabase.
2. Copie o conteúdo do arquivo em `migrations/20250917_constraints_indexes.sql`.
3. Rode o script. Ele é idempotente (usa `if not exists` e recriações seguras).
4. Valide novas constraints executando selects simples (ex.: verificar índices em `pg_indexes`).

Em novos ambientes, basta rodar primeiro `supabase_schema.sql` e depois as migrações incrementais em ordem cronológica.

## Criptografia de Credenciais de Sessão
Os arquivos de autenticação Baileys (multi-file) agora podem ser criptografados em repouso no Storage.

- Variável: `SESSION_ENCRYPTION_KEY` (32 bytes em base64 ou 64 hex chars).
- Algoritmo: AES-256-GCM (formato `ENCv1:<iv>:<cipher>:<tag>`).
- Backward compatibility: se a key não estiver definida ou inválida, os arquivos continuam em texto simples e um aviso é logado apenas uma vez.

Gerar chave (hex):
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Gerar chave (base64):
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Boas práticas:
- Rotacione a chave periodicamente (ex.: criar nova, reprocessar arquivos, remover antiga).
- Restrinja acesso a essa env somente nos workers (não é necessária na API caso ela não manipule diretório de sessão).
- Faça download e validação de algumas sessões após habilitar para garantir descriptografia correta.

## Rate Limiting
Implementado para mitigar abuso e explosões de custos:

- Tabela: `application_rate_limits` (janela fixa). Ver migração `20250917_rate_limit.sql`.
- Envio de mensagens (`POST /api/send`): limitado por loja por minuto usando `whatsapp_configs.rate_limit_per_min` (default 20). Resposta 429 retorna `retry_at` (epoch ms) e `limit`.
- Criação de sessão (`POST /api/sessions/create`): 5 tentativas por hora por loja (evita flood de QR / conexões). Resposta 429 inclui `retry_at`.
- Erro 503 (`rate_limit_unavailable`) caso o backend de limitação (Postgres) falhe – escolhido fail-closed.
- Limpeza sugerida: `delete from application_rate_limits where window_end < now() - interval '1 day';`

Extensões futuras:
- Chaves separadas por IP + store.
- Sliding window mais preciso (usar duas janelas e interpolar) caso necessário.
- Métricas integradas no endpoint `/api/queue/metrics` (acrescentar contadores de bloqueios).

## Observabilidade & Logs
Implementado correlation id (`request_id`) para rastrear fluxo API → fila → worker.

- Middleware adiciona/propaga header `x-request-id` (ou gera UUID). Retornado na resposta.
- Endpoints instrumentados: send, sessions/create, ai/reply, contacts, inbound, health, metrics.
- Jobs enfileirados incluem `request_id` quando originados de requisições.
- Worker `sender` loga `rid` em sucesso/falha de envio e casos de ausência de `message_id`.

Variáveis:
- `LOG_LEVEL` (info, warn, error, debug).

Tail de logs (exemplos):
```
# Vercel (API) via dashboard ou vercel cli
vercel logs <deployment-url> --since=1h

# Worker container
docker logs -f <container>
```

Estrutura de eventos principais:
- `request:start` { rid, method, path }
- `request:finish` { rid, status, ms }
- `metrics:request:start|finish` { rid }
- `send failed` { rid, err }
- `missing message_id` { rid, jobId }

Próximos passos (opcional):
- Exportar logs para stack central (Loki/ELK). 
- Adicionar latências de banco e fila (wrap queries).
- Expor `rid` também em respostas SSE/stream.

## Salvaguardas de IA
Mecanismos para evitar loops, spam e consumo excessivo:

- Colunas adicionadas em `conversations`: `last_ai_reply_at`, `last_ai_reply_hash`, `last_inbound_hash`.
- Se não há nova mensagem inbound (hash igual) → 409 `no_new_inbound`.
- Intervalo mínimo entre respostas (env `AI_MIN_INTERVAL_MS`, default 15000) → 429 `min_interval`.
- Deduplicação: se hash da nova resposta é igual à anterior → 409 `duplicate_reply`.
- Limite de contexto: últimas mensagens (default 16) até máximo de caracteres (default 4000) via envs:
	- `AI_MAX_MESSAGES`
	- `AI_MAX_CONTEXT_CHARS`

Status/erros especiais retornados pelo endpoint `/api/ai/reply` (HTTP):
- 409 `no_new_inbound`
- 409 `duplicate_reply`
- 429 `min_interval`
- 200 `ok: true` (resposta enviada / enfileirada)

Rotina de uso recomendada:
1. Worker inbound chama `/api/ai/reply` (interno). 
2. Se receber 409/429, não re-enfileirar; aguardar novo inbound real ou passar intervalo.
3. Se 200, mensagem será enviada (quando `session_id` e `to` presentes) e colunas atualizadas.

Extensões futuras:
- Classificador para detectar intenção (ex.: suporte vs vendas) e ajustar prompt.
- Cache semântico de produtos para sugerir mais rápido.
- Limitar tokens diários por store.

## Performance & Caching

Camada leve de cache in-memory adicionada para reduzir latência e carga em consultas repetitivas de leitura rápida.

Implementação:
- Arquivo: `app/lib/cache.ts` (estrutura simples: Map + TTL por chave).
- Primitive `cache.wrap(key, ttlMs, fn)` executa `fn` somente em falta / expiração.

Locais onde o cache foi aplicado:
1. Configuração WhatsApp (`whatsapp_configs.rate_limit_per_min`) no endpoint `/api/send` → evita SELECT por requisição. TTL padrão global.
2. `away_message` da store no endpoint `/api/ai/reply` → reduz fetch duplicado quando múltiplas threads de IA disparam.
3. Busca de produtos (`searchProducts`) → chaveia por `(store_id, query, limit)` com TTL configurável para aliviar buscas `ilike` consecutivas.

Variáveis de ambiente:
- `CACHE_DEFAULT_TTL_MS` (default 5000) TTL genérico em ms para chaves sem TTL específico.
- `CACHE_PRODUCT_SEARCH_TTL_MS` (default 30000) TTL de resultados de busca de produtos.

Fallback/Sem estado:
- Em ambiente serverless múltiplas instâncias não compartilham cache; ganho ainda existe por conexão HTTP persistente enquanto a instância está aquecida.
- Em invalidations necessárias (ex.: alteração de catálogo), opção simples: alterar a query (ex.: adicionar sufixo de versão em chave) ou reduzir TTL.

Instrumentação:
- Função `generateReply` agora loga evento `ai.generateReply.duration` com `dur_ms` e `tokens_est` (quando fornecido pelo provedor) para acompanhar latência de resposta do modelo.

Extensões futuras:
- LRU + métricas de hit/miss.
- Cache distribuído (Redis) para escalas > 1 instância / picos de leitura.
- Wrap genérico para medir latências de SELECT/INSERT.

## QA & Testes Automatizados

Framework: Vitest (unit) + Supertest (integração básica HTTP).

Localização dos testes:
- Unit: `app/lib/__tests__/*.test.ts`
- Integração simples: `app/api/__tests__/send.integration.test.ts`

Scripts:
```
npm --prefix app run test        # roda uma vez
npm --prefix app run test:watch  # modo watch (desenvolvimento)
```

O teste de integração cria um mini wrapper Express in-memory e injeta um usuário falso para simular autenticação. Supabase é chamado, portanto se quiser isolar completamente, configure variáveis apontando para um banco de testes ou mock no futuro.

Boas práticas futuras:
- Adicionar mocks para `supabaseService` permitindo cenários de erro.
- Testes de limites de rate limiting e AI safeguards (409/429 cases).
- Cobertura de worker (extrair lógica em funções puras quando possível para testar reconexão/backoff).

Ajustes de CI (futuro):
- Adicionar workflow GitHub Actions rodando `npm ci && npm --prefix app ci && npm --prefix app run test`.
- Exportar cobertura (`vitest --coverage`).
