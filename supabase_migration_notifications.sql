-- Notifikasi: kotak notifikasi di aplikasi + web push + pengingat absen otomatis.
-- Alur: baris baru di public.notifications -> trigger memanggil Edge Function send-push (pg_net) -> web push ke perangkat.

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------- Konfigurasi rahasia (schema private tidak terekspos ke API) ----------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private.push_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  vapid_public TEXT,
  vapid_private TEXT,
  push_secret TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  function_url TEXT NOT NULL DEFAULT 'https://wjdexntvziblqcurcveb.supabase.co/functions/v1/send-push'
);
INSERT INTO private.push_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Dipakai Edge Function (service_role) untuk membaca/menyimpan kunci VAPID.
CREATE OR REPLACE FUNCTION public.push_config_get()
RETURNS TABLE (vapid_public TEXT, vapid_private TEXT, push_secret TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT vapid_public, vapid_private, push_secret FROM private.push_config WHERE id = 1;
$$;
CREATE OR REPLACE FUNCTION public.push_config_set_vapid(p_public TEXT, p_private TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE private.push_config SET vapid_public = p_public, vapid_private = p_private
  WHERE id = 1 AND vapid_public IS NULL;
$$;
REVOKE ALL ON FUNCTION public.push_config_get() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_config_set_vapid(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_config_get() TO service_role;
GRANT EXECUTE ON FUNCTION public.push_config_set_vapid(TEXT, TEXT) TO service_role;

-- Kunci publik VAPID aman dibagikan ke browser.
CREATE OR REPLACE FUNCTION public.vapid_public_key()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT vapid_public FROM private.push_config WHERE id = 1;
$$;
GRANT EXECUTE ON FUNCTION public.vapid_public_key() TO anon, authenticated;

-- ---------- Tabel ----------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- leave_new | leave_decided | remind_in | remind_out
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  dedup_key TEXT UNIQUE,           -- mencegah pengingat terkirim dua kali
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_created ON public.notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- shortcut: policy terbuka mengikuti tabel lain di project ini; perketat bersama RLS (lihat Bug Backlog).
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Notifications public access" ON public.notifications;
CREATE POLICY "Notifications public access" ON public.notifications FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Push subs public access" ON public.push_subscriptions;
CREATE POLICY "Push subs public access" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Kirim push saat notifikasi dibuat ----------
CREATE OR REPLACE FUNCTION private.on_notification_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cfg RECORD;
BEGIN
  SELECT * INTO cfg FROM private.push_config WHERE id = 1;
  PERFORM net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.push_secret),
    body := jsonb_build_object('user_id', NEW.user_id, 'title', NEW.title, 'body', NEW.body, 'url', COALESCE(NEW.url, '/'))
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notifications_push ON public.notifications;
CREATE TRIGGER notifications_push AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION private.on_notification_insert();

-- ---------- Pengajuan izin/lembur: admin diberi tahu; keputusan: karyawan diberi tahu ----------
CREATE OR REPLACE FUNCTION private.leave_label(reason TEXT, status TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN reason LIKE '[LEMBUR]%' THEN 'lembur'
    WHEN reason LIKE '[TELAT%' THEN 'izin telat'
    WHEN status = 'sakit' OR reason LIKE '[SAKIT%' THEN 'izin sakit'
    ELSE 'izin' END;
$$;

CREATE OR REPLACE FUNCTION private.on_attendance_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE label TEXT := private.leave_label(NEW.reason, NEW.status);
BEGIN
  IF NEW.session_type <> 'izin_sakit' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' AND NEW.approval_status = 'pending' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, url)
    SELECT p.id, 'leave_new', 'Pengajuan ' || label || ' baru',
           COALESCE(NEW.user_name, 'Karyawan') || ' mengajukan ' || label || ' untuk ' ||
           to_char(COALESCE(NEW.start_date, NEW.date), 'DD Mon YYYY') || '.', '/'
    FROM public.profiles p
    WHERE p.role = 'admin' AND p.company_id IS NOT DISTINCT FROM NEW.company_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.approval_status = 'pending' AND NEW.approval_status IN ('approved', 'rejected') THEN
    INSERT INTO public.notifications (user_id, kind, title, body, url)
    VALUES (
      NEW.user_id, 'leave_decided',
      'Pengajuan ' || label || CASE WHEN NEW.approval_status = 'approved' THEN ' disetujui' ELSE ' ditolak' END,
      'Pengajuan ' || label || ' untuk ' || to_char(COALESCE(NEW.start_date, NEW.date), 'DD Mon YYYY') ||
        CASE WHEN NEW.approval_status = 'approved' THEN ' telah disetujui admin.' ELSE ' ditolak admin.' END ||
        COALESCE(' Catatan: ' || NULLIF(NEW.review_note, ''), ''),
      '/'
    );
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendances_notify ON public.attendances;
CREATE TRIGGER attendances_notify AFTER INSERT OR UPDATE OF approval_status ON public.attendances
  FOR EACH ROW EXECUTE FUNCTION private.on_attendance_change();

-- ---------- Pengingat absen (tiap 5 menit) ----------
-- Masuk: 15 menit sebelum jam mulai bila belum absen masuk. Pulang: 30-60 menit setelah jam selesai bila sudah masuk tapi belum pulang.
-- shortcut: libur nasional tidak dicek di sini (daftar libur ada di aplikasi); akhir pekan dilewati kecuali dijadwalkan shift.
CREATE OR REPLACE FUNCTION private.send_attendance_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  now_wib TIMESTAMP := (now() AT TIME ZONE 'Asia/Jakarta');
  r RECORD;
BEGIN
  FOR r IN
    WITH days AS (
      SELECT (now_wib::date - 1) AS d UNION ALL SELECT now_wib::date
    ),
    sched AS (
      SELECT p.id AS user_id, p.company_id, dd.d,
             -- jadwal per hari menimpa shift tetap, kecuali menunjuk shift yang sudah dihapus
             CASE WHEN p.shift_schedule ? extract(dow FROM dd.d)::int::text
                   AND (p.shift_schedule ->> extract(dow FROM dd.d)::int::text IS NULL
                        OR EXISTS (SELECT 1 FROM public.shifts x WHERE x.id::text = p.shift_schedule ->> extract(dow FROM dd.d)::int::text))
                  THEN NULLIF(p.shift_schedule ->> extract(dow FROM dd.d)::int::text, '')::uuid
                  ELSE p.shift_id END AS sid,
             (p.shift_schedule ? extract(dow FROM dd.d)::int::text) AS explicit_day
      FROM public.profiles p CROSS JOIN days dd
      WHERE p.role = 'employee'
    ),
    timed AS (
      SELECT s.user_id, s.d,
             COALESCE(sh.start_time, o.work_start_time, '08:00') AS st,
             COALESCE(sh.end_time, o.work_end_time, '17:00') AS et,
             (sh.id IS NOT NULL AND s.explicit_day) OR extract(isodow FROM s.d) < 6 AS workday
      FROM sched s
      LEFT JOIN public.shifts sh ON sh.id = s.sid
      LEFT JOIN LATERAL (
        SELECT work_start_time, work_end_time FROM public.office_settings os
        WHERE os.company_id IS NOT DISTINCT FROM s.company_id ORDER BY os.updated_at LIMIT 1
      ) o ON true
    )
    SELECT t.user_id, t.d,
           (t.d + t.st::time) AS start_at,
           -- shift lewat tengah malam selesai keesokan harinya
           (t.d + t.et::time) + CASE WHEN t.et::time <= t.st::time THEN interval '1 day' ELSE interval '0' END AS end_at,
           t.workday
    FROM timed t
  LOOP
    CONTINUE WHEN NOT r.workday;
    -- izin/sakit yang disetujui pada tanggal itu
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.attendances a
      WHERE a.user_id = r.user_id AND a.session_type = 'izin_sakit' AND a.approval_status = 'approved'
        AND a.reason NOT LIKE '[LEMBUR]%' AND a.reason NOT LIKE '[TELAT%'
        AND r.d BETWEEN COALESCE(a.start_date, a.date) AND COALESCE(a.end_date, a.date)
    );

    IF now_wib BETWEEN r.start_at - interval '15 minutes' AND r.start_at
       AND NOT EXISTS (SELECT 1 FROM public.attendances a WHERE a.user_id = r.user_id AND a.date = r.d AND a.session_type = 'masuk') THEN
      INSERT INTO public.notifications (user_id, kind, title, body, url, dedup_key)
      VALUES (r.user_id, 'remind_in', 'Jangan lupa absen masuk',
              'Jam masuk Anda pukul ' || to_char(r.start_at, 'HH24:MI') || ' WIB.', '/', 'in:' || r.user_id || ':' || r.d)
      ON CONFLICT (dedup_key) DO NOTHING;
    END IF;

    IF now_wib BETWEEN r.end_at + interval '30 minutes' AND r.end_at + interval '60 minutes'
       AND EXISTS (SELECT 1 FROM public.attendances a WHERE a.user_id = r.user_id AND a.date = r.d AND a.session_type = 'masuk')
       AND NOT EXISTS (SELECT 1 FROM public.attendances a WHERE a.user_id = r.user_id AND a.date = r.d AND a.session_type = 'pulang') THEN
      INSERT INTO public.notifications (user_id, kind, title, body, url, dedup_key)
      VALUES (r.user_id, 'remind_out', 'Belum absen pulang',
              'Jam kerja Anda selesai pukul ' || to_char(r.end_at, 'HH24:MI') || ' WIB. Jangan lupa absen pulang.', '/', 'out:' || r.user_id || ':' || r.d)
      ON CONFLICT (dedup_key) DO NOTHING;
    END IF;
  END LOOP;
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'attendance-reminders';
SELECT cron.schedule('attendance-reminders', '*/5 * * * *', 'SELECT private.send_attendance_reminders()');
