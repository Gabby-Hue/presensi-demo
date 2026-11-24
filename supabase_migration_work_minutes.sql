-- Lama kerja khusus per karyawan (mis. satpam 10/12 jam) tanpa membuat shift baru.
-- Jam masuk & batas telat ikut shift/jam kantor; jam pulang = jam masuk + work_minutes.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS work_minutes INTEGER CHECK (work_minutes BETWEEN 60 AND 960);
COMMENT ON COLUMN public.profiles.work_minutes IS 'Lama kerja khusus (menit). NULL = ikut shift / jam kantor. Jam pulang = jam masuk + work_minutes.';
-- private.send_attendance_reminders() juga diperbarui: end_at = start_at + work_minutes bila diisi
-- (lihat migrasi reminders_work_minutes di Supabase).

-- Batas absen masuk lebih awal per perusahaan (menit sebelum jam masuk). NULL = tanpa batas.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS early_checkin_minutes INTEGER DEFAULT 30 CHECK (early_checkin_minutes IS NULL OR early_checkin_minutes BETWEEN 0 AND 720);
