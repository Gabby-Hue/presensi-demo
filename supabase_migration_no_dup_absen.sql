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
