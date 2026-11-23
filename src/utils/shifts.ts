import { UserProfile, WorkShift } from '../types/attendance';
import { todayWIB } from './dates';

/** Jadwal mingguan: kunci "0" (Minggu) … "6" (Sabtu) -> id shift, null = jam kantor. Hari tanpa kunci ikut shift tetap. */
export type ShiftSchedule = Record<string, string | null>;

export const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Shift lewat tengah malam, mis. 22:00 - 06:00. */
export const isOvernight = (s: WorkShift) => toMin(s.endTime) <= toMin(s.startTime);

/** Durasi shift dalam menit (sudah memperhitungkan lewat tengah malam). */
export const shiftDuration = (s: WorkShift) => (toMin(s.endTime) - toMin(s.startTime) + 1440) % 1440 || 1440;

export function weekdayOf(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

export function shiftIdFor(user: Pick<UserProfile, 'shiftId' | 'shiftSchedule'>, dateStr: string): string | null {
  const key = String(weekdayOf(dateStr));
  const sched = user.shiftSchedule;
  if (sched && key in sched) return sched[key];
  return user.shiftId ?? null;
}

const wibMinutes = (now: Date) => {
  const w = new Date(now.getTime() + 7 * 3600e3);
  return w.getUTCHours() * 60 + w.getUTCMinutes();
};

// Masa tenggang presensi pulang setelah shift malam berakhir.
const OVERNIGHT_GRACE_MIN = 6 * 60;

/**
 * Tanggal kerja + shift yang berlaku sekarang. Shift malam kemarin yang belum lewat
 * (jam selesai + tenggang, dan belum masuk jam mulai shift hari ini) tetap dihitung tanggal kemarin.
 */
export function resolveWorkDay(
  user: Pick<UserProfile, 'shiftId' | 'shiftSchedule'>,
  shifts: WorkShift[],
  now: Date = new Date()
): { date: string; shift: WorkShift | null; minutesSinceStart: number | null } {
  const byId = (id: string | null) => (id && shifts.find((s) => s.id === id)) || null;
  const today = todayWIB(now);
  const yesterday = todayWIB(new Date(now.getTime() - 24 * 3600e3));
  const nowMin = wibMinutes(now);
  const todayShift = byId(shiftIdFor(user, today));
  const prev = byId(shiftIdFor(user, yesterday));

  if (prev && isOvernight(prev)) {
    let cutoff = toMin(prev.endTime) + OVERNIGHT_GRACE_MIN;
    if (todayShift) cutoff = Math.min(cutoff, toMin(todayShift.startTime));
    if (nowMin < cutoff) {
      return { date: yesterday, shift: prev, minutesSinceStart: nowMin + 1440 - toMin(prev.startTime) };
    }
  }
  return {
    date: today,
    shift: todayShift,
    minutesSinceStart: todayShift ? nowMin - toMin(todayShift.startTime) : null,
  };
}

/** Terlambat bila lewat batas telat, dihitung relatif dari jam mulai (aman untuk shift malam). */
export const isLateForShift = (s: WorkShift, minutesSinceStart: number) =>
  minutesSinceStart > (toMin(s.lateDeadline) - toMin(s.startTime) + 1440) % 1440;

export const isClockOutOpenForShift = (s: WorkShift, minutesSinceStart: number) =>
  minutesSinceStart >= shiftDuration(s);

/** Validasi form shift. Mengembalikan pesan error atau null. */
export function validateShiftTimes(start: string, end: string, late: string): string | null {
  if (start === end) return 'Jam pulang tidak boleh sama dengan jam masuk.';
  const s = { startTime: start, endTime: end, lateDeadline: late } as WorkShift;
  const lateOffset = (toMin(late) - toMin(start) + 1440) % 1440;
  if (lateOffset >= shiftDuration(s)) return 'Batas terlambat harus di antara jam masuk dan jam pulang.';
  return null;
}
