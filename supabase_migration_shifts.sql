-- Shift kerja per departemen (opsional). Departemen tanpa shift tetap memakai jam kantor.
-- Karyawan punya shift tetap (profiles.shift_id) + jadwal per hari opsional (profiles.shift_schedule).
-- Jalankan sekali di Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,      -- 'HH:MM'
  end_time TEXT NOT NULL,        -- 'HH:MM' (<= start_time berarti lewat tengah malam)
  late_deadline TEXT NOT NULL,   -- 'HH:MM'
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Shifts public access" ON public.shifts;
CREATE POLICY "Shifts public access" ON public.shifts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL;

-- Jadwal per hari: {"0".."6" (Minggu..Sabtu): shift_id | null (jam kantor)}. Hari tanpa kunci ikut shift_id.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shift_schedule JSONB;
