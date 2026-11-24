import { UserProfile, WorkShift } from '../types/attendance';
import { todayWIB } from './dates';
import { addMinutes } from './time';

type ShiftUser = Pick<UserProfile, 'shiftId' | 'shiftSchedule'> & {
  workMinutes?: number | null;
  shiftOverrides?: Record<string, string | null>;
};

/** Peta tanggal -> shift dari tukar shift yang disetujui untuk satu karyawan. */
export function swapOverrides(
  swaps: Array<{ status: string; swapDate: string; requesterId: string; partnerId: string; requesterShiftId?: string | null; partnerShiftId?: string | null }>,
  userId: string
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const s of swaps) {
    if (s.status !== 'approved') continue;
    if (s.requesterId === userId) out[s.swapDate] = s.partnerShiftId ?? null;
    else if (s.partnerId === userId) out[s.swapDate] = s.requesterShiftId ?? null;
  }
  return out;
}

/** Lama kerja khusus (mis. satpam 12 jam): jam pulang = jam masuk + workMinutes, jam masuk & batas telat tetap. */
export function withWorkMinutes(s: WorkShift, workMinutes?: number | null): WorkShift {
  return workMinutes ? { ...s, endTime: addMinutes(s.startTime, workMinutes) } : s;
}

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

/**
 * Id shift yang berlaku di tanggal itu. Bila `shifts` diberikan, entri jadwal yang menunjuk shift
 * yang sudah dihapus diabaikan (kembali ke shift tetap).
 */
export function shiftIdFor(
  user: Pick<UserProfile, 'shiftId' | 'shiftSchedule'> & { shiftOverrides?: Record<string, string | null> },
  dateStr: string,
  shifts?: WorkShift[]
): string | null {
  // Tukar shift yang disetujui menimpa jadwal pada tanggal itu
  const ov = user.shiftOverrides;
  if (ov && dateStr in ov) {
    const v = ov[dateStr];
    if (v && (!shifts || shifts.some((s) => s.id === v))) return v;
  }
  const key = String(weekdayOf(dateStr));
  const sched = user.shiftSchedule;
  if (sched && key in sched) {
    const v = sched[key];
    if (v === null || !shifts || shifts.some((s) => s.id === v)) return v;
  }
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
  user: ShiftUser,
  shifts: WorkShift[],
  now: Date = new Date(),
  /** Apakah tanggal itu punya presensi masuk tanpa pulang. Tanpa info ini dianggap ya. */
  hasOpenSession: (date: string) => boolean = () => true
): { date: string; shift: WorkShift | null; minutesSinceStart: number | null } {
  const byId = (id: string | null) => {
    const s = (id && shifts.find((x) => x.id === id)) || null;
    return s ? withWorkMinutes(s, user.workMinutes) : null;
  };
  const today = todayWIB(now);
  const yesterday = todayWIB(new Date(now.getTime() - 24 * 3600e3));
  const nowMin = wibMinutes(now);
  const todayShift = byId(shiftIdFor(user, today, shifts));
  const prev = byId(shiftIdFor(user, yesterday, shifts));

  if (prev && isOvernight(prev)) {
    const end = toMin(prev.endTime);
    let cutoff = end + OVERNIGHT_GRACE_MIN;
    if (todayShift) cutoff = Math.min(cutoff, toMin(todayShift.startTime));
    // Sebelum jam selesai pasti masih shift kemarin; masa tenggang hanya bila sesi kemarin belum ditutup.
    if (nowMin < end || (nowMin < cutoff && hasOpenSession(yesterday))) {
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
