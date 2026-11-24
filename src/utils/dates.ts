/** True kalau string YYYY-MM-DD jatuh pada Sabtu/Minggu. Tanpa geser timezone. */
export function isWeekendDateString(dateStr: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  if (!m) return new Date(dateStr).getDay() % 6 === 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Lewat deadline jam (h, m) — presisi sekond: 10:00:15 > 10:00:00. Date/timestamp input, local WIB. */
export function isAfterTimeOfDay(d: Date, h: number, m: number): boolean {
  const w = new Date(d.getTime() + 7 * 3600 * 1000); // jam WIB, apa pun zona waktu perangkat
  return w.getUTCHours() * 3600 + w.getUTCMinutes() * 60 + w.getUTCSeconds() > h * 3600 + m * 60;
}

/** Tanggal lokal (WIB / UTC+7) sebagai YYYY-MM-DD — aman di server atau perangkat zona waktu mana pun. */
export function todayWIB(d: Date = new Date()): string {
  // Geser waktu instan ke UTC+7 (WIB)
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  return w.toISOString().slice(0, 10);
}

/** Ambil inisial bersih 1-2 huruf kapital dari nama (kebal simbol tanda kurung, gelar, dan embel-embel). */
export function getInitials(name?: string): string {
  if (!name) return 'U';
  // Buang isi di dalam tanda kurung (), [], atau {} (misal: "Neil (Karyawan)" -> "Neil")
  const clean = name.replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]/g, '').replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    const raw = name.replace(/[^a-zA-Z0-9]/g, '');
    return (raw.slice(0, 2) || 'U').toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}
