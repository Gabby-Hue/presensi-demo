-- =====================================================================
-- E-PRESENSI SUPABASE FULL SCHEMA & INITIAL SEED
-- Pure polosan & netral, 100% didukung Supabase + Vercel
-- Hanya ada akun Super Admin (tidak ada akun dummy)
-- =====================================================================

-- 0. Ekstensi pgcrypto untuk hash password auth bawaan
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------
-- 1. Tabel companies (Entitas Usaha / Multi-PT)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Companies public access" ON public.companies;
CREATE POLICY "Companies public access" ON public.companies FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 2. Tabel departments (Master Data Departemen)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uk_company_dept UNIQUE (company_id, name)
);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Departments public access" ON public.departments;
CREATE POLICY "Departments public access" ON public.departments FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 3. Tabel profiles (Akun Pengguna, Admin, & Super Admin)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'employee')) DEFAULT 'employee',
  department TEXT DEFAULT 'None',
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  avatar_url TEXT,
  phone_number TEXT,
  device_model TEXT,
  device_id TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  plain_password TEXT DEFAULT '123456',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Profiles public access" ON public.profiles;
CREATE POLICY "Profiles public access" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 4. Tabel office_settings (Geofence Titik & Jam Kantor)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.office_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_name TEXT NOT NULL DEFAULT 'Kantor Utama',
  latitude DOUBLE PRECISION NOT NULL DEFAULT -6.2088,
  longitude DOUBLE PRECISION NOT NULL DEFAULT 106.8456,
  radius_meters INTEGER NOT NULL DEFAULT 150,
  color TEXT NOT NULL DEFAULT '#0061A4',
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  work_start_time TEXT DEFAULT '08:00',
  work_end_time TEXT DEFAULT '17:00',
  late_deadline TEXT DEFAULT '10:00',
  address TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.office_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Office settings public access" ON public.office_settings;
CREATE POLICY "Office settings public access" ON public.office_settings FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 5. Tabel attendances (Data Presensi & Perizinan Karyawan)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('luring', 'daring', 'izin_sakit')),
  session_type TEXT NOT NULL DEFAULT 'masuk' CHECK (session_type IN ('masuk', 'pulang', 'izin_sakit')),
  status TEXT NOT NULL CHECK (status IN ('hadir', 'izin', 'sakit')),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  clock_in_time TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  distance_meters INTEGER,
  office_name TEXT,
  office_color TEXT,
  reason TEXT,
  start_date DATE,
  end_date DATE,
  photo_url TEXT,
  document_url TEXT,
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Attendances public access" ON public.attendances;
CREATE POLICY "Attendances public access" ON public.attendances FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 6. Tabel audit_logs (Riwayat Aktivitas & Perubahan)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Audit logs public access" ON public.audit_logs;
CREATE POLICY "Audit logs public access" ON public.audit_logs FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 7. Tabel activities (Timesheet / Log Aktivitas Proyek)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  project_code TEXT NOT NULL,
  project_name TEXT,
  activity_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  is_overtime BOOLEAN NOT NULL DEFAULT false,
  overtime_status TEXT NOT NULL DEFAULT 'none' CHECK (overtime_status IN ('none', 'pending', 'approved', 'rejected')),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_address TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Activities public access" ON public.activities;
CREATE POLICY "Activities public access" ON public.activities FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 8. Storage Buckets (Foto Swafoto, Dokumen Izin, Avatar)
-- -----------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('attendance-photos', 'attendance-photos', true),
  ('attendance-docs', 'attendance-docs', true),
  ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Allow all storage reads" ON storage.objects;
CREATE POLICY "Allow all storage reads" ON storage.objects FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all storage inserts" ON storage.objects;
CREATE POLICY "Allow all storage inserts" ON storage.objects FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all storage updates" ON storage.objects;
CREATE POLICY "Allow all storage updates" ON storage.objects FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow all storage deletes" ON storage.objects;
CREATE POLICY "Allow all storage deletes" ON storage.objects FOR DELETE USING (true);

-- -----------------------------------------------------
-- 9. Trigger Anti-Double Absen di Level Database
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_duplicate_attendance()
RETURNS TRIGGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Cegah dobel absen masuk atau pulang pada tanggal yang sama
  IF NEW.session_type IN ('masuk', 'pulang') THEN
    SELECT COUNT(*) INTO v_count
    FROM public.attendances
    WHERE user_id = NEW.user_id
      AND date = NEW.date
      AND session_type = NEW.session_type;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Presensi sesi ini pada tanggal ini sudah tersimpan. Tidak bisa absen dua kali.';
    END IF;

  -- Cegah dobel izin/sakit berstatus pending pada rentang tanggal yang sama
  ELSIF NEW.session_type = 'izin_sakit' AND NEW.approval_status = 'pending' THEN
    SELECT COUNT(*) INTO v_count
    FROM public.attendances
    WHERE user_id = NEW.user_id
      AND session_type = 'izin_sakit'
      AND approval_status = 'pending'
      AND NEW.start_date = start_date
      AND NEW.end_date = end_date;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Pengajuan izin/sakit untuk tanggal ini sudah menunggu persetujuan admin.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_attendance ON public.attendances;
CREATE TRIGGER trg_prevent_duplicate_attendance
BEFORE INSERT ON public.attendances
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_duplicate_attendance();

-- -----------------------------------------------------
-- 10. Data Awal Default (Perusahaan, Titik Kantor, & Departemen)
-- -----------------------------------------------------
-- 1. Perusahaan Default
INSERT INTO public.companies (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Perusahaan Utama')
ON CONFLICT (id) DO NOTHING;

-- 2. Titik Kantor Default
INSERT INTO public.office_settings (id, office_name, latitude, longitude, radius_meters, color, company_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Kantor Utama',
  -7.23707,
  112.6346,
  150,
  '#0061A4',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- 3. Departemen Standar
INSERT INTO public.departments (name, company_id)
VALUES
  ('Management', '00000000-0000-0000-0000-000000000001'),
  ('HR', '00000000-0000-0000-0000-000000000001'),
  ('Engineering', '00000000-0000-0000-0000-000000000001'),
  ('Sales', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------
-- 11. HANYA AKUN SUPER ADMIN (admin@admin.com / 123456)
-- Tidak ada akun karyawan dummy!
-- -----------------------------------------------------
DO $$
DECLARE
  v_admin_id UUID := '00000000-0000-0000-0000-000000000099';
BEGIN
  -- Insert ke auth.users jika belum ada
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@admin.com') THEN
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      v_admin_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'admin@admin.com',
      crypt('123456', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Super Admin","role":"superadmin"}',
      now(),
      now()
    );
  ELSE
    SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@admin.com';
    UPDATE auth.users
    SET encrypted_password = crypt('123456', gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now())
    WHERE id = v_admin_id;
  END IF;

  -- Insert / Update ke public.profiles
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    department,
    company_id,
    plain_password,
    created_at
  ) VALUES (
    v_admin_id,
    'admin@admin.com',
    'Super Admin',
    'superadmin',
    'Management',
    '00000000-0000-0000-0000-000000000001',
    '123456',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    role = 'superadmin',
    full_name = 'Super Admin',
    plain_password = '123456',
    department = 'Management',
    company_id = '00000000-0000-0000-0000-000000000001';
END $$;

-- -----------------------------------------------------
-- 11. Trigger Otomatis Hapus Auth User saat Profil Dihapus
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cleanup_auth_user_on_profile_delete()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM auth.users WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_cleanup_auth_user ON public.profiles;
CREATE TRIGGER trg_cleanup_auth_user
AFTER DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.fn_cleanup_auth_user_on_profile_delete();

-- Blokir absen ganda di level database (port dari trigger MySQL versi company).
CREATE OR REPLACE FUNCTION public.trg_no_dup_absen() RETURNS trigger AS $$
BEGIN
  IF NEW.session_type IN ('masuk', 'pulang') AND EXISTS (
    SELECT 1 FROM public.attendances
    WHERE user_id = NEW.user_id AND date = NEW.date AND session_type = NEW.session_type
  ) THEN
    RAISE EXCEPTION 'Presensi sesi ini pada tanggal ini sudah tersimpan. Tidak bisa absen dua kali.';
  ELSIF NEW.session_type = 'izin_sakit' AND NEW.approval_status = 'pending' AND EXISTS (
    SELECT 1 FROM public.attendances
    WHERE user_id = NEW.user_id AND session_type = 'izin_sakit' AND approval_status = 'pending'
      AND start_date IS NOT DISTINCT FROM NEW.start_date AND end_date IS NOT DISTINCT FROM NEW.end_date
  ) THEN
    RAISE EXCEPTION 'Pengajuan izin/sakit untuk tanggal ini sudah menunggu persetujuan admin.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_dup_absen ON public.attendances;
CREATE TRIGGER trg_no_dup_absen BEFORE INSERT ON public.attendances
  FOR EACH ROW EXECUTE FUNCTION public.trg_no_dup_absen();

-- Shift kerja per departemen (opsional). Departemen tanpa shift tetap memakai jam kantor.
-- Karyawan punya shift tetap (profiles.shift_id) + jadwal per hari opsional (profiles.shift_schedule).
-- Jalankan sekali di Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,      -- 'HH:MM'
  end_time TEXT NOT NULL,        -- 'HH:MM' (harus > start_time, shift lintas tengah malam belum didukung)
  late_deadline TEXT NOT NULL,   -- 'HH:MM'
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Shifts public access" ON public.shifts;
CREATE POLICY "Shifts public access" ON public.shifts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shift_schedule JSONB; -- {"0".."6": shift_id | null}, hari tanpa kunci ikut shift_id

-- Kuota cuti (izin, bukan sakit) per tahun dalam hari.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leave_quota INTEGER NOT NULL DEFAULT 12 CHECK (leave_quota BETWEEN 0 AND 365);

-- Satu presensi masuk/pulang per karyawan per tanggal (mencegah absen dobel).
CREATE UNIQUE INDEX IF NOT EXISTS attendances_one_session_per_day ON public.attendances (user_id, date, session_type) WHERE session_type IN ('masuk','pulang');
