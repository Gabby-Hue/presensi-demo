-- Tukar shift antar karyawan satu divisi untuk satu tanggal.
-- Alur: pemohon mengajukan -> rekan menerima (pending_admin) -> admin menyetujui (approved).
-- Saat approved: pada swap_date pemohon memakai partner_shift_id, rekan memakai requester_shift_id.

CREATE TABLE IF NOT EXISTS public.shift_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  department TEXT,
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  swap_date DATE NOT NULL,
  requester_shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  partner_shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending_partner'
    CHECK (status IN ('pending_partner', 'pending_admin', 'approved', 'rejected', 'cancelled')),
  decided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester_id <> partner_id)
);
CREATE INDEX IF NOT EXISTS shift_swaps_date ON public.shift_swaps (swap_date);
CREATE INDEX IF NOT EXISTS shift_swaps_company_status ON public.shift_swaps (company_id, status);

-- shortcut: policy terbuka mengikuti tabel lain; perketat bersama RLS (lihat Bug Backlog).
ALTER TABLE public.shift_swaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Shift swaps public access" ON public.shift_swaps;
CREATE POLICY "Shift swaps public access" ON public.shift_swaps FOR ALL USING (true) WITH CHECK (true);

-- Notifikasi di tiap tahap
CREATE OR REPLACE FUNCTION private.on_shift_swap_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  req_name TEXT;
  par_name TEXT;
  tgl TEXT := to_char(NEW.swap_date, 'DD Mon YYYY');
BEGIN
  SELECT full_name INTO req_name FROM public.profiles WHERE id = NEW.requester_id;
  SELECT full_name INTO par_name FROM public.profiles WHERE id = NEW.partner_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, url)
    VALUES (NEW.partner_id, 'swap_request', 'Permintaan tukar shift',
            COALESCE(req_name, 'Rekan') || ' mengajak tukar shift tanggal ' || tgl || '. Buka menu Pengajuan untuk menerima atau menolak.', '/');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending_admin' THEN
      INSERT INTO public.notifications (user_id, kind, title, body, url)
      SELECT p.id, 'swap_admin', 'Tukar shift menunggu persetujuan',
             COALESCE(req_name, '-') || ' dan ' || COALESCE(par_name, '-') || ' sepakat tukar shift tanggal ' || tgl || '.', '/'
      FROM public.profiles p WHERE p.role = 'admin' AND p.company_id IS NOT DISTINCT FROM NEW.company_id;
      INSERT INTO public.notifications (user_id, kind, title, body, url)
      VALUES (NEW.requester_id, 'swap_update', 'Tukar shift diterima rekan',
              COALESCE(par_name, 'Rekan') || ' menerima tukar shift tanggal ' || tgl || '. Menunggu persetujuan admin.', '/');
    ELSIF NEW.status IN ('approved', 'rejected') THEN
      INSERT INTO public.notifications (user_id, kind, title, body, url)
      SELECT uid, 'swap_update',
             CASE WHEN NEW.status = 'approved' THEN 'Tukar shift disetujui' ELSE 'Tukar shift ditolak' END,
             'Tukar shift ' || COALESCE(req_name, '-') || ' dengan ' || COALESCE(par_name, '-') || ' tanggal ' || tgl ||
             CASE WHEN NEW.status = 'approved' THEN ' telah disetujui.' ELSE ' ditolak.' END, '/'
      FROM unnest(ARRAY[NEW.requester_id, NEW.partner_id]) AS uid;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS shift_swaps_notify ON public.shift_swaps;
CREATE TRIGGER shift_swaps_notify AFTER INSERT OR UPDATE OF status ON public.shift_swaps
  FOR EACH ROW EXECUTE FUNCTION private.on_shift_swap_change();

-- Pengingat absen memperhitungkan tukar shift yang disetujui
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
      SELECT p.id AS user_id, p.company_id, p.work_minutes, dd.d,
             COALESCE(
               sw.sid,
               CASE WHEN p.shift_schedule ? extract(dow FROM dd.d)::int::text
                     AND (p.shift_schedule ->> extract(dow FROM dd.d)::int::text IS NULL
                          OR EXISTS (SELECT 1 FROM public.shifts x WHERE x.id::text = p.shift_schedule ->> extract(dow FROM dd.d)::int::text))
                    THEN NULLIF(p.shift_schedule ->> extract(dow FROM dd.d)::int::text, '')::uuid
                    ELSE p.shift_id END
             ) AS sid,
             (sw.sid IS NOT NULL OR p.shift_schedule ? extract(dow FROM dd.d)::int::text) AS explicit_day
      FROM public.profiles p
      CROSS JOIN days dd
      LEFT JOIN LATERAL (
        SELECT CASE WHEN s.requester_id = p.id THEN s.partner_shift_id ELSE s.requester_shift_id END AS sid
        FROM public.shift_swaps s
        WHERE s.status = 'approved' AND s.swap_date = dd.d AND (s.requester_id = p.id OR s.partner_id = p.id)
        ORDER BY s.created_at DESC LIMIT 1
      ) sw ON true
      WHERE p.role = 'employee'
    ),
    timed AS (
      SELECT s.user_id, s.d, s.work_minutes,
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
           CASE WHEN t.work_minutes IS NOT NULL THEN (t.d + t.st::time) + make_interval(mins => t.work_minutes)
                ELSE (t.d + t.et::time) + CASE WHEN t.et::time <= t.st::time THEN interval '1 day' ELSE interval '0' END
           END AS end_at,
           t.workday
    FROM timed t
  LOOP
    CONTINUE WHEN NOT r.workday;
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
