import { AttendanceRecord, OfficeSettings, UserProfile, WorkShift } from '../types/attendance';
import { isWeekendDateString } from './dates';
import { isNationalHoliday } from './holidays';
import { isOvernight, shiftIdFor, weekdayOf, withWorkMinutes } from './shifts';
import { addMinutes } from './time';

export const DEFAULT_LEAVE_QUOTA = 12;

/** Jadwal kerja efektif seorang karyawan pada satu tanggal. */
export interface DaySchedule {
  name: string; // nama shift atau 'Jam kantor'
  start: string;
  end: string;
  late: string;
  overnight: boolean;
  /** Hari kerja wajib (bukan akhir pekan/libur, atau dijadwalkan shift secara eksplisit). */
  workday: boolean;
}

type ShiftUser = Pick<UserProfile, 'shiftId' | 'shiftSchedule'> & { workMinutes?: number | null };

export function scheduleFor(
  user: ShiftUser,
  date: string,
  shifts: WorkShift[],
  office?: Pick<OfficeSettings, 'workStartTime' | 'workEndTime' | 'lateDeadline'>
): DaySchedule {
  const id = shiftIdFor(user, date, shifts);
  const found = (id && shifts.find((s) => s.id === id)) || null;
  const shift = found ? withWorkMinutes(found, user.workMinutes) : null;
  // Jadwal per hari yang eksplisit memasang shift di akhir pekan/libur = hari kerja biasa, bukan lembur.
  const explicit = !!found && user.shiftSchedule?.[String(weekdayOf(date))] === found.id;
  const workday = explicit || (!isWeekendDateString(date) && !isNationalHoliday(date));
  if (shift) {
    return { name: shift.name, start: shift.startTime, end: shift.endTime, late: shift.lateDeadline, overnight: isOvernight(shift), workday };
  }
  const officeStart = office?.workStartTime || '08:00';
  return {
    name: 'Jam kantor',
    start: officeStart,
    end: user.workMinutes ? addMinutes(officeStart, user.workMinutes) : office?.workEndTime || '17:00',
    late: office?.lateDeadline || '10:00',
    overnight: false,
    workday,
  };
}

const at = (date: string, hm: string) => Date.parse(`${date}T${hm}:00+07:00`);
const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

/** Menit terlambat dari batas telat (0 bila tepat waktu). Aman untuk shift malam. */
export function lateMinutes(clockInIso: string, date: string, s: DaySchedule): number {
  const t = Date.parse(clockInIso);
  if (isNaN(t)) return 0;
  const lateOffset = (toMin(s.late) - toMin(s.start) + 1440) % 1440;
  const deadline = at(date, s.start) + lateOffset * 60e3;
  return Math.max(0, Math.floor((t - deadline) / 60e3));
}

const isLeaveRecord = (r: AttendanceRecord) =>
  (r.type === 'izin_sakit' || r.sessionType === 'izin_sakit') &&
  !r.reason?.includes('[LEMBUR]') &&
  !r.reason?.includes('[TELAT');

const isSickRecord = (r: AttendanceRecord) => r.status === 'sakit' || !!r.reason?.includes('[SAKIT');
const isHalfDay = (r: AttendanceRecord) => /setengah\s*hari/i.test(r.reason || '');

function eachDate(start: string, end: string, fn: (d: string) => void) {
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  for (let i = 0; cur <= last && i < 400; i++) {
    fn(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/**
 * Hari cuti (izin, bukan sakit) yang dipakai di tahun tertentu. Setengah hari = 0,5.
 * Akhir pekan & libur nasional dalam rentang izin tidak memotong kuota.
 * includePending: hitung juga pengajuan yang belum diputus (untuk mencegah pengajuan melebihi kuota).
 */
export function leaveDaysUsed(records: AttendanceRecord[], userId: string, year: number, includePending = false): number {
  // Per tanggal unik: izin yang tumpang tindih tidak memotong kuota dua kali.
  const byDate = new Map<string, number>();
  for (const r of records) {
    if (r.userId !== userId || !isLeaveRecord(r) || isSickRecord(r)) continue;
    if (r.approvalStatus === 'rejected' || (!includePending && r.approvalStatus === 'pending')) continue;
    const start = (r.startDate || r.date || '').slice(0, 10);
    const end = (r.endDate || r.date || '').slice(0, 10);
    if (!start || !end) continue;
    const per = isHalfDay(r) ? 0.5 : 1;
    eachDate(start, end, (d) => {
      if (d.startsWith(String(year)) && !isWeekendDateString(d) && !isNationalHoliday(d)) {
        byDate.set(d, Math.max(byDate.get(d) || 0, per));
      }
    });
  }
  let used = 0;
  byDate.forEach((v) => (used += v));
  return used;
}

/**
 * Cek kuota untuk rentang izin yang mungkin melewati pergantian tahun.
 * Mengembalikan pesan bila kuota salah satu tahun tidak cukup, selain itu null.
 */
export function checkLeaveQuota(
  start: string,
  end: string,
  halfDay: boolean,
  quota: number,
  usedInYear: (year: number) => number
): string | null {
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    const s = start > y + '-01-01' ? start : y + '-01-01';
    const e = end < y + '-12-31' ? end : y + '-12-31';
    const need = countLeaveDays(s, e, halfDay);
    const left = Math.max(0, quota - usedInYear(y));
    if (need > left) return 'Pengajuan ini butuh ' + need + ' hari di tahun ' + y + ', sisa kuota cuti Anda ' + left + ' hari. Hubungi admin bila perlu tambahan.';
  }
  return null;
}

/** Jumlah hari kerja (bukan akhir pekan/libur) dalam rentang izin, untuk validasi kuota sebelum mengajukan. */
export function countLeaveDays(start: string, end: string, halfDay: boolean): number {
  let n = 0;
  eachDate(start, end, (d) => {
    if (!isWeekendDateString(d) && !isNationalHoliday(d)) n += 1;
  });
  return halfDay ? Math.min(n, 1) * 0.5 : n;
}

export interface PayrollRow {
  nama: string;
  departemen: string;
  hariKerja: number;
  hadir: number;
  terlambat: number;
  menitTerlambat: number;
  izin: number;
  sakit: number;
  alpha: number;
  jamKerja: number;
  jamLembur: number;
  kuotaCuti: number;
  sisaCuti: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Rekap payroll per karyawan untuk satu bulan (ym = 'YYYY-MM'), dihitung sampai `today` (tanggal hari ini tidak dihitung alpha).
 * Jam lembur = jam lembur dari pengajuan [LEMBUR] yang disetujui + jam kerja di hari non-kerja (akhir pekan/libur).
 */
export function buildPayroll(
  users: UserProfile[],
  records: AttendanceRecord[],
  shifts: WorkShift[],
  offices: OfficeSettings[],
  ym: string,
  today: string
): PayrollRow[] {
  const [y, m] = ym.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const lastDay = monthEnd < today ? monthEnd : today;

  return users
    .filter((u) => u.role === 'employee')
    .map((u) => {
      const own = records.filter((r) => r.userId === u.id && r.approvalStatus !== 'rejected');
      const office = offices.find((o) => (o.companyId ?? null) === (u.companyId ?? null)) || offices[0];
      const joined = (u.createdAt || '').slice(0, 10);

      // Tanggal yang tertutup izin/sakit yang disetujui
      const leaveOn = new Map<string, 'izin' | 'sakit'>();
      own.filter((r) => isLeaveRecord(r) && r.approvalStatus === 'approved').forEach((r) => {
        const s = (r.startDate || r.date || '').slice(0, 10);
        const e = (r.endDate || r.date || '').slice(0, 10);
        if (s && e) eachDate(s, e, (d) => leaveOn.set(d, isSickRecord(r) ? 'sakit' : 'izin'));
      });

      const row: PayrollRow = {
        nama: u.fullName,
        departemen: u.department || '-',
        hariKerja: 0, hadir: 0, terlambat: 0, menitTerlambat: 0, izin: 0, sakit: 0, alpha: 0,
        jamKerja: 0, jamLembur: 0,
        kuotaCuti: u.leaveQuota ?? DEFAULT_LEAVE_QUOTA,
        sisaCuti: 0,
      };

      eachDate(`${ym}-01`, monthEnd, (d) => {
        const sched = scheduleFor(u, d, shifts, office);
        const masuk = own.find((r) => r.date === d && r.sessionType === 'masuk');
        const pulang = own.find((r) => r.date === d && r.sessionType === 'pulang');
        const leave = leaveOn.get(d);
        const counted = d <= lastDay && (!joined || d >= joined);

        if (sched.workday && counted) row.hariKerja++;
        if (masuk) {
          row.hadir++;
          if (sched.workday) {
            const late = lateMinutes(masuk.clockInTime, d, sched);
            if (late > 0) {
              row.terlambat++;
              row.menitTerlambat += late;
            }
          }
          if (pulang) {
            const hours = Math.max(0, (Date.parse(pulang.clockInTime) - Date.parse(masuk.clockInTime)) / 3600e3);
            if (!isNaN(hours)) {
              row.jamKerja += hours;
              if (!sched.workday) row.jamLembur += hours;
            }
          }
        } else if (leave && sched.workday && counted) {
          row[leave]++;
        } else if (sched.workday && counted && d < today) {
          row.alpha++;
        }
      });

      // Pengajuan lembur disetujui: "[LEMBUR] 17:00 - 20:00 (3 Jam) | ..."
      own
        .filter((r) => r.reason?.includes('[LEMBUR]') && r.approvalStatus === 'approved' && (r.startDate || r.date || '').startsWith(ym))
        .forEach((r) => {
          const h = /\(([\d.]+)\s*Jam\)/.exec(r.reason || '');
          if (h) row.jamLembur += Number(h[1]) || 0;
        });

      row.jamKerja = round1(row.jamKerja);
      row.jamLembur = round1(row.jamLembur);
      row.sisaCuti = Math.max(0, row.kuotaCuti - leaveDaysUsed(records, u.id, y));
      return row;
    })
    .sort((a, b) => a.departemen.localeCompare(b.departemen) || a.nama.localeCompare(b.nama));
}
