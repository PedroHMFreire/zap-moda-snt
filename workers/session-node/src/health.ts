import type { Express, Request, Response } from 'express';

type HealthOpts = {
  /** Retorna o número de sessões WA ativas (ex.: sessions.size) */
  getSessionsActive?: () => number;
  /** Retorna o backlog da fila de envio (se não tiver, pode retornar 0) */
  getSendBacklog?: () => Promise<number> | number;
  /** Qualquer info extra para /health */
  extra?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
};

/**
 * Registra endpoints de saúde/observabilidade.
 * - GET /health   → JSON com ok, ts, uptime, memória, sessões, backlog
 * - GET /metrics  → Exposição Prometheus em text/plain
 */
export function startHealth(app: Express, opts: HealthOpts = {}) {
  const getSessionsActive = () => {
    try { return Number(opts.getSessionsActive?.() ?? 0); } catch { return 0; }
  };
  const getSendBacklog = async () => {
    try {
      const v = await opts.getSendBacklog?.();
      return Number(v ?? 0);
    } catch { return 0; }
  };
  const getExtra = async () => {
    try { return (await opts.extra?.()) ?? {}; } catch { return {}; }
  };

  app.get('/health', async (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    const payload = {
      ok: true,
      ts: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      sessionsActive: getSessionsActive(),
      queueSendBacklog: await getSendBacklog(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      ...(await getExtra())
    };
    res.status(200).json(payload);
  });

  app.get('/metrics', async (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    const lines: string[] = [];

    // Métricas custom (prefixo snt_)
    lines.push(`# HELP snt_sessions_active Número de sessões WhatsApp ativas`);
    lines.push(`# TYPE snt_sessions_active gauge`);
    lines.push(`snt_sessions_active ${getSessionsActive()}`);

    const backlog = await getSendBacklog();
    lines.push(`# HELP snt_queue_send_backlog Backlog de mensagens na fila de envio`);
    lines.push(`# TYPE snt_queue_send_backlog gauge`);
    lines.push(`snt_queue_send_backlog ${backlog}`);

    // Métricas de processo
    lines.push(`# HELP process_uptime_seconds Tempo de atividade do processo`);
    lines.push(`# TYPE process_uptime_seconds gauge`);
    lines.push(`process_uptime_seconds ${process.uptime().toFixed(0)}`);

    lines.push(`# HELP nodejs_memory_rss_bytes Resident Set Size em bytes`);
    lines.push(`# TYPE nodejs_memory_rss_bytes gauge`);
    lines.push(`nodejs_memory_rss_bytes ${mem.rss}`);

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(lines.join('\n') + '\n');
  });
}
