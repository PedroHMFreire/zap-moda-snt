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

## Observações
- Este MVP está pronto para evoluir com Baileys real nos workers (não usa Chromium).
- A RLS restringe dados por `store_id` do `owner_id` (auth.uid()).
- Evite expor `SUPABASE_SERVICE_ROLE` no front.
