-- Rate limiting support tables - 2025-09-17
create table if not exists application_rate_limits (
  key text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  counter int not null default 0,
  constraint application_rate_limits_pk primary key (key, window_start)
);

create index if not exists idx_application_rate_limits_key_window_end on application_rate_limits(key, window_end);

-- Optional TTL cleanup (manual, or use cron job / pg-boss scheduled job)
-- delete from application_rate_limits where window_end < now() - interval '1 day';
