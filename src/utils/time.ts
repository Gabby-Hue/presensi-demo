/** Batas telat & lama kerja default saat admin mengisi jam masuk. */
export const DEFAULT_LATE_MINUTES = 30;
export const DEFAULT_WORK_MINUTES = 8 * 60;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isCompleteTime = (t: string) => TIME_RE.test(t);

/** Format ketikan jadi HH:MM: "0800" -> "08:00", "830" -> "08:30". Hanya angka yang dipakai. */
export function formatTimeInput(raw: string): string {
  let d = raw.replace(/\D/g, '').slice(0, 4);
  // "830": jam satu digit (jam 3-9 tidak mungkin diawali 3..9 sebagai puluhan)
  if (d.length === 3 && Number(d[0]) > 2) d = '0' + d;
  return d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2, 4) : d;
}

/** Tambah menit ke HH:MM, berputar melewati tengah malam (22:00 + 8 jam = 06:00). */
export function addMinutes(t: string, minutes: number): string {
  const [h, m] = t.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

/**
 * Jam masuk baru: kembalikan jam masuk terformat + saran batas telat (+30 mnt) & jam pulang (+8 jam)
 * bila jam masuk sudah lengkap. Admin tetap bisa mengubah saran itu setelahnya.
 */
export function startTimeChange(raw: string): { start: string; late?: string; end?: string } {
  const start = formatTimeInput(raw);
  if (!isCompleteTime(start)) return { start };
  return { start, late: addMinutes(start, DEFAULT_LATE_MINUTES), end: addMinutes(start, DEFAULT_WORK_MINUTES) };
}
