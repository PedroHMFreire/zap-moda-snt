// app/api/config/index.ts
export default async function handler(_req: any, res: any) {
  // Somente valores PÚBLICOS. Nunca exponha SERVICE_ROLE aqui.
  const cfg = {
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
    // Se o front e a API estão no mesmo domínio, pode deixar vazio.
    API_BASE: process.env.PUBLIC_API_BASE || "",
    MODEL: 'user-as-workspace'
  };

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    return res
      .status(500)
      .json({ error: "Config faltando no ambiente (SUPABASE_URL/ANON_KEY)." });
  }

  res.setHeader("Cache-Control", "public, max-age=60");
  return res.status(200).json(cfg);
}
