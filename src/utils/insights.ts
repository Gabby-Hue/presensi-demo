import { AttendanceRecord, OfficeSettings, UserProfile, WorkShift } from '../types/attendance';
import { scheduleFor } from './payroll';

export interface DayPoint {
  date: string;
  tepat: number;
  telat: number;
  izin: number;
  alpha: number;
}

export interface Insights {
  days: DayPoint[];
  /** Persentase hadir dari hari kerja wajib (hadir / (hadir + izin + alpha)). */
  attendanceRate: number;
  totals: { tepat: number; telat: number; izin: number; alpha: number };
  byDept: Array<{ dept: string; telat: number; hadir: number; rate: number }>;
  topTelat: Array<{ user: UserProfile; count: number }>;
  topAlpha: Array<{ user: UserProfile; count: number }>;
}

const isLeave = (r: AttendanceRecord) =>
  (r.type === 'izin_sakit' || r.sessionType === 'izin_sakit') &&
  r.approvalStatus === 'approved' &&
  !r.reason?.includes('[LEMBUR]') &&
  !r.reason?.includes('[TELAT');

/** Alasan "Terlambat (> HH:MM WIB)" ditulis saat absen masuk memakai jadwal saat itu. */
const isLateMasuk = (r: AttendanceRecord) => /terlambat/i.test(r.reason || '');

/**
 * Ringkasan kehadiran untuk tanggal [from..today]. Alpha hanya dihitung untuk hari kerja wajib yang sudah lewat
 * (hari ini belum dihitung alpha).
 */
export function buildInsights(
  users: UserProfile[],
  records: AttendanceRecord[],
  shifts: WorkShift[],
  offices: OfficeSettings[],
  from: string,
  today: string
): Insights {
  const staff = users.filter((u) => u.role === 'employee');
  const dates: string[] = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); ; t += 86400e3) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d > today) break;
    dates.push(d);
  }

  const masukBy = new Map<string, AttendanceRecord>(); // user|date -> masuk
  const leaveBy = new Set<string>(); // user|date
  for (const r of records) {
    if (r.approvalStatus === 'rejected') continue;
    if (r.sessionType === 'masuk') masukBy.set(r.userId + '|' + r.date, r);
    else if (isLeave(r)) {
      const s = (r.startDate || r.date).slice(0, 10);
      const e = (r.endDate || r.date).slice(0, 10);
      for (const d of dates) if (d >= s && d <= e) leaveBy.add(r.userId + '|' + d);
    }
  }

  const telatCount = new Map<string, number>();
  const alphaCount = new Map<string, number>();
  const dept = new Map<string, { telat: number; hadir: number }>();
  const days: DayPoint[] = dates.map((d) => ({ date: d, tepat: 0, telat: 0, izin: 0, alpha: 0 }));

  staff.forEach((u) => {
    const office = offices.find((o) => (o.companyId ?? null) === (u.companyId ?? null)) || offices[0];
    const joined = (u.createdAt || '').slice(0, 10);
    const dk = u.department || '-';
    if (!dept.has(dk)) dept.set(dk, { telat: 0, hadir: 0 });
    dates.forEach((d, i) => {
      if (joined && d < joined) return;
      const m = masukBy.get(u.id + '|' + d);
      if (m) {
        const dd = dept.get(dk)!;
        dd.hadir++;
        if (isLateMasuk(m)) {
          days[i].telat++;
          dd.telat++;
          telatCount.set(u.id, (telatCount.get(u.id) || 0) + 1);
        } else days[i].tepat++;
        return;
      }
      if (!scheduleFor(u, d, shifts, office).workday) return;
      if (leaveBy.has(u.id + '|' + d)) days[i].izin++;
      else if (d < today) {
        days[i].alpha++;
        alphaCount.set(u.id, (alphaCount.get(u.id) || 0) + 1);
      }
    });
  });

  const totals = days.reduce(
    (a, p) => ({ tepat: a.tepat + p.tepat, telat: a.telat + p.telat, izin: a.izin + p.izin, alpha: a.alpha + p.alpha }),
    { tepat: 0, telat: 0, izin: 0, alpha: 0 }
  );
  const wajib = totals.tepat + totals.telat + totals.izin + totals.alpha;
  const top = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ user: staff.find((u) => u.id === id)!, count }))
      .filter((x) => x.user);

  return {
    days,
    attendanceRate: wajib ? Math.round(((totals.tepat + totals.telat) / wajib) * 100) : 0,
    totals,
    byDept: [...dept.entries()]
      .map(([d, v]) => ({ dept: d, ...v, rate: v.hadir ? Math.round((v.telat / v.hadir) * 100) : 0 }))
      .filter((x) => x.hadir > 0)
      .sort((a, b) => b.telat - a.telat || b.rate - a.rate),
    topTelat: top(telatCount),
    topAlpha: top(alphaCount),
  };
}
