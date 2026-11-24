// PresensiPro UI · Shadcn-Inspired Attendance Calendar
// Clean institutional calendar layout, monthly stat summary strip, polished nav controls,
// and authentic PresensiPro semantic session colors.

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AttendanceRecord } from '../../types/attendance';
import { colors, fontSize, radius, spacing } from '../../theme';
import { select } from '../../services/feedbackService';
import { isNationalHoliday, getHolidayName } from '../../utils/holidays';

export type DayStatus =
  | 'lengkap' | 'telat' | 'lengkap_izin' | 'satu_sesi' | 'izin' | 'sakit' | 'lembur'
  | 'menunggu' | 'libur' | 'absen' | 'akan_datang' | 'hari_ini_kosong' | 'belum_bergabung';

export interface DayInfo {
  hasMasuk: boolean;
  hasPulang: boolean;
  hasIzin: boolean;
  hasHalfDayLeave: boolean;
  hasPending: boolean;
  /** Absen masuk melewati batas telat (dicatat saat absen) atau izin telat disetujui. */
  isLate?: boolean;
  /** Izin yang disetujui berupa sakit. */
  hasSakit?: boolean;
}

const emptyInfo = (): DayInfo => ({ hasMasuk: false, hasPulang: false, hasIzin: false, hasHalfDayLeave: false, hasPending: false });
const isSickRecord = (r: AttendanceRecord) => r.status === 'sakit' || !!r.reason?.includes('[SAKIT');

/** Palet status kalender (dipakai tile, legenda, dan ringkasan). */
export const DAY_PALETTE = {
  lengkap: { bg: colors.primary, text: '#FFFFFF' },
  telat: { bg: '#EA580C', text: '#FFFFFF' },
  satu_sesi: { bg: '#FACC15', text: '#713F12' },
  izin: { bg: '#7C3AED', text: '#FFFFFF' },
  sakit: { bg: '#DB2777', text: '#FFFFFF' },
  lembur: { bg: '#0D9488', text: '#FFFFFF' },
  libur: { bg: '#FEE2E2', text: '#B91C1C' },
  absen: { bg: '#64748B', text: '#FFFFFF' },
  menunggu: { bg: '#FFFFFF', text: '#6D28D9', border: '#8B5CF6' },
};

export const buildAttendanceMap = (
  attendances: AttendanceRecord[],
  year: number,
  month: number
): Record<number, DayInfo> => {
  const map: Record<number, DayInfo> = {};
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  attendances.forEach((record) => {
    // 1. Tangani Izin / Sakit multi-hari (rentang tanggal startDate s.d endDate)
    if (record.type === 'izin_sakit' || record.sessionType === 'izin_sakit') {
      const isLembur = record.reason && record.reason.includes('[LEMBUR]');
      const isTelat = record.reason && record.reason.includes('[TELAT');
      if (!isLembur && !isTelat) {
        const sDate = (record.startDate || record.date || '').slice(0, 10);
        const eDate = (record.endDate || record.date || '').slice(0, 10);
        const isHalf = !!record.reason && /setengah\s*hari/i.test(record.reason);

        if (sDate && eDate) {
          for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
            const dateStr = `${year}-${pad(month + 1)}-${pad(dayNum)}`;
            if (dateStr >= sDate && dateStr <= eDate) {
              if (!map[dayNum]) map[dayNum] = emptyInfo();
              if (record.approvalStatus === 'pending') {
                map[dayNum].hasPending = true;
              } else if (record.approvalStatus === 'approved') {
                map[dayNum].hasIzin = true;
                if (isSickRecord(record)) map[dayNum].hasSakit = true;
                if (isHalf) map[dayNum].hasHalfDayLeave = true;
              }
            }
          }
        }
        return; // Selesai memproses izin
      }
      // Izin telat yang disetujui: tandai hari itu terlambat (tanggal = tanggal izin telat)
      if (isTelat && record.approvalStatus === 'approved') {
        const dStr = (record.startDate || record.date || '').slice(0, 10);
        const [yy, mm, dd] = dStr.split('-').map(Number);
        if (yy === year && mm - 1 === month && dd >= 1 && dd <= daysInMonth) {
          if (!map[dd]) map[dd] = emptyInfo();
          map[dd].isLate = true;
        }
        return;
      }
      if (isTelat) return;
    }

    // 2. Tangani presensi harian (Masuk, Pulang, atau Lembur)
    let y = -1;
    let m = -1;
    let d = -1;
    if (record.date && /^\d{4}-\d{2}-\d{2}/.test(record.date)) {
      const cleanDate = String(record.date).slice(0, 10);
      const parts = cleanDate.split('-');
      y = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10) - 1;
      d = parseInt(parts[2], 10);
    } else {
      const rd = new Date(record.clockInTime || record.date);
      y = rd.getFullYear();
      m = rd.getMonth();
      d = rd.getDate();
    }
    if (y === year && m === month && d >= 1 && d <= daysInMonth) {
      if (!map[d]) map[d] = emptyInfo();
      if (record.sessionType === 'masuk') {
        map[d].hasMasuk = true;
        // Alasan "Terlambat (> HH:MM WIB)" ditulis saat absen masuk memakai jadwal/shift saat itu.
        if (/terlambat/i.test(record.reason || '')) map[d].isLate = true;
      }
      if (record.sessionType === 'pulang') map[d].hasPulang = true;
    }
  });
  return map;
};

export const getDayStatus = (
  info: DayInfo | undefined,
  isPast: boolean,
  isToday: boolean,
  isWeekend = false,
  isHoliday = false,
  isBeforeJoin = false
): DayStatus => {
  const worked = !!(info?.hasMasuk || info?.hasPulang);
  // Masuk kerja di akhir pekan / libur nasional = lembur
  if (worked && (isWeekend || isHoliday)) return 'lembur';
  // Hadir + izin (umumnya setengah hari): tile dibagi dua (hadir + izin)
  if (info?.hasIzin && worked) return 'lengkap_izin';

  // Presensi murni tanpa izin
  if (info?.hasMasuk && info?.hasPulang) return info.isLate ? 'telat' : 'lengkap';
  if (worked) return 'satu_sesi';

  // Izin murni (seharian penuh tanpa presensi)
  if (info?.hasIzin) return info.hasSakit ? 'sakit' : 'izin';
  if (info?.hasPending) return 'menunggu';
  if (!info && (isWeekend || isHoliday)) return 'libur';
  if (isBeforeJoin && !info) return 'belum_bergabung';
  if (isToday) return 'hari_ini_kosong';
  if (isPast) return 'absen';
  return 'akan_datang';
};

interface MonthAttendanceCalendarProps {
  attendances: AttendanceRecord[];
  year?: number;
  month?: number;
  onMonthChange?: (year: number, month: number) => void;
  selectedDay?: number | null;
  onSelectDay?: (day: number) => void;
  showNav?: boolean;
  userCreatedAt?: string;
}

const STATUS_LABEL: Record<DayStatus, string> = {
  lengkap: 'hadir tepat waktu', telat: 'terlambat', lengkap_izin: 'hadir dan izin setengah hari',
  satu_sesi: 'baru satu sesi', izin: 'izin', sakit: 'sakit', lembur: 'lembur', menunggu: 'izin menunggu persetujuan',
  libur: 'libur', absen: 'alpa', akan_datang: '', hari_ini_kosong: 'hari ini, belum absen', belum_bergabung: 'belum bergabung',
};

const LEGEND: Array<{ label: string; bg?: string; border?: string; split?: boolean; clock?: boolean }> = [
  { label: 'Tepat waktu', bg: DAY_PALETTE.lengkap.bg },
  { label: 'Terlambat', bg: DAY_PALETTE.telat.bg },
  { label: 'Tanda telat', clock: true },
  { label: '1 Sesi', bg: DAY_PALETTE.satu_sesi.bg },
  { label: 'Izin', bg: DAY_PALETTE.izin.bg },
  { label: 'Sakit', bg: DAY_PALETTE.sakit.bg },
  { label: 'Hadir + izin setengah hari', split: true },
  { label: 'Menunggu', bg: '#FFFFFF', border: DAY_PALETTE.menunggu.border },
  { label: 'Lembur', bg: DAY_PALETTE.lembur.bg },
  { label: 'Libur', bg: '#FCA5A5' },
  { label: 'Alpa', bg: DAY_PALETTE.absen.bg },
];

const monthNames = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const MonthAttendanceCalendar: React.FC<MonthAttendanceCalendarProps> = ({
  attendances,
  year: yearProp,
  month: monthProp,
  onMonthChange,
  selectedDay,
  onSelectDay,
  showNav = true,
  userCreatedAt,
}) => {
  const now = new Date();
  const [innerYear, setInnerYear] = useState(now.getFullYear());
  const [innerMonth, setInnerMonth] = useState(now.getMonth());

  const year = yearProp ?? innerYear;
  const month = monthProp ?? innerMonth;

  const userJoinDateKey = userCreatedAt ? userCreatedAt.slice(0, 10) : null;

  const setMonth = (y: number, m: number) => {
    if (yearProp === undefined || monthProp === undefined) {
      setInnerYear(y);
      setInnerMonth(m);
    }
    onMonthChange?.(y, m);
  };

  const goPrev = () => {
    const d = new Date(year, month - 1, 1);
    setMonth(d.getFullYear(), d.getMonth());
  };
  const goNext = () => {
    const d = new Date(year, month + 1, 1);
    setMonth(d.getFullYear(), d.getMonth());
  };

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();

  const attendanceMap = useMemo(
    () => buildAttendanceMap(attendances, year, month),
    [attendances, year, month]
  );

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const isPastMonth =
    year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth());
  const todayDate = now.getDate();

  const dayLabels = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  const calendarCells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push({ day: null });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    calendarCells.push({ day });
  }

  // Ringkasan metrik bulanan ala Shadcn dashboard
  // Menghilangkan kepanikan alpa: Hari sebelum karyawan bergabung (userJoinDateKey)
  // TIDAK dihitung sebagai alpa/absen.
  const monthStats = useMemo(() => {
    let hadir = 0;
    let telat = 0;
    let satuSesi = 0;
    let izin = 0;
    let sakit = 0;
    let alpa = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const info = attendanceMap[d];
      const isPast = isPastMonth || (isCurrentMonth && d < todayDate);
      const isToday = isCurrentMonth && d === todayDate;
      const weekday = new Date(year, month, d).getDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isHoliday = isNationalHoliday(dateKey);
      const isBeforeJoin = Boolean(userJoinDateKey && dateKey < userJoinDateKey);
      const st = getDayStatus(info, isPast, isToday, isWeekend, isHoliday, isBeforeJoin);
      if (st === 'lengkap' || st === 'lengkap_izin') hadir++;
      else if (st === 'telat') telat++;
      else if (st === 'satu_sesi') satuSesi++;
      else if (st === 'izin') izin++;
      else if (st === 'sakit') sakit++;
      else if (st === 'absen') alpa++;
    }
    return { hadir, telat, satuSesi, izin, sakit, alpa };
  }, [attendanceMap, daysInMonth, isPastMonth, isCurrentMonth, todayDate, year, month, userJoinDateKey]);

  // Skema warna asli PresensiPro:
  // alpa = abu-abu solid, 1 sesi = kuning solid, lengkap = biru solid,
  // lengkap_izin = biru solid tapi border merah (izin setengah hari),
  // izin = merah hollow (putih + border merah), Sabtu-Minggu / Libur Nasional kosong = merah solid
  const getDayColors = (day: number) => {
    const info = attendanceMap[day];
    const isPast = isPastMonth || (isCurrentMonth && day < todayDate);
    const isToday = isCurrentMonth && day === todayDate;
    const weekday = new Date(year, month, day).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isHoliday = isNationalHoliday(dateKey);
    const isBeforeJoin = Boolean(userJoinDateKey && dateKey < userJoinDateKey);
    const status = getDayStatus(info, isPast, isToday, isWeekend, isHoliday, isBeforeJoin);

    const late = !!info?.isLate;
    const base: { isToday: boolean; isHoliday: boolean; late: boolean; split: boolean; dashed: boolean; status: DayStatus; border?: string; borderWidth?: number } =
      { isToday, isHoliday, late, split: false, dashed: false, status };
    switch (status) {
      case 'belum_bergabung':
        return { ...base, bg: colors.surfaceSoft, text: colors.faint, border: colors.border, borderWidth: 1, isToday: false, isHoliday: false };
      case 'lengkap_izin':
        // atas = hadir (oranye bila telat), bawah = izin
        return { ...base, bg: late ? DAY_PALETTE.telat.bg : DAY_PALETTE.lengkap.bg, text: '#FFFFFF', split: true };
      case 'menunggu':
        return { ...base, bg: DAY_PALETTE.menunggu.bg, text: DAY_PALETTE.menunggu.text, border: DAY_PALETTE.menunggu.border, borderWidth: 2, dashed: true };
      case 'hari_ini_kosong':
        return { ...base, bg: '#FFFFFF', text: colors.primary, border: colors.primary, borderWidth: 2 };
      case 'akan_datang':
        return { ...base, bg: '#E8F0FE', text: '#64748B', isToday: false };
      default:
        return { ...base, ...DAY_PALETTE[status] };
    }
  };

  const jumpToToday = () => {
    select();
    const t = new Date();
    setMonth(t.getFullYear(), t.getMonth());
    onSelectDay?.(t.getDate());
  };

  return (
    <View style={styles.container}>
      {/* 1. Shadcn-Style Month Navigator Header */}
      <View style={styles.monthHeader}>
        <View style={styles.titleGroup}>
          <Text style={styles.monthTitle}>{monthNames[month]} {year}</Text>
          {isCurrentMonth && (
            <View style={styles.currentMonthBadge}>
              <Text style={styles.currentMonthBadgeText}>Bulan Ini</Text>
            </View>
          )}
        </View>

        {showNav && (
          <View style={styles.navControls}>
            {!isCurrentMonth && (
              <TouchableOpacity
                onPress={jumpToToday}
                style={styles.todayShortcutBtn}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <Text style={styles.todayShortcutText}>Hari Ini</Text>
              </TouchableOpacity>
            )}
            <View style={styles.chevronGroup}>
              <TouchableOpacity
                onPress={() => { select(); goPrev(); }}
                style={styles.chevronBtn}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <Feather name="chevron-left" size={17} color={colors.ink} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { select(); goNext(); }}
                style={styles.chevronBtn}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <Feather name="chevron-right" size={17} color={colors.ink} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* 2. Shadcn Monthly Stat Summary Chips */}
      <View style={styles.statSummaryGrid}>
        {([
          ['Tepat', monthStats.hadir, DAY_PALETTE.lengkap.bg],
          ['Telat', monthStats.telat, DAY_PALETTE.telat.bg],
          ['1 Sesi', monthStats.satuSesi, '#A16207'],
          ['Izin', monthStats.izin, DAY_PALETTE.izin.bg],
          ['Sakit', monthStats.sakit, DAY_PALETTE.sakit.bg],
          ['Alpa', monthStats.alpa, DAY_PALETTE.absen.bg],
        ] as const).map(([label, value, color]) => (
          <View key={label} style={styles.statChip}>
            <View style={[styles.statChipBar, { backgroundColor: color }]} />
            <Text style={styles.statChipLabel}>{label}</Text>
            <Text style={[styles.statChipValue, { color }]}>{value}</Text>
          </View>
        ))}
      </View>

      {/* 3. Weekday Columns */}
      <View style={styles.weekHeaderRow}>
        {dayLabels.map((lbl, idx) => {
          const isWeekend = idx === 0 || idx === 6;
          return (
            <View key={idx} style={styles.weekHeaderCell}>
              <Text style={[styles.weekHeaderText, isWeekend && styles.weekHeaderTextWeekend]}>
                {lbl}
              </Text>
            </View>
          );
        })}
      </View>

      {/* 4. Calendar Days Grid */}
      <View style={styles.daysGrid}>
        {calendarCells.map((cell, index) => {
          if (cell.day === null) {
            return <View key={`e-${index}`} style={styles.dayCellWrapper} />;
          }

          const c = getDayColors(cell.day);
          const isSelected = selectedDay === cell.day;

          return (
            <View key={`d-${cell.day}`} style={styles.dayCellWrapper}>
              <TouchableOpacity
                activeOpacity={0.75}
                disabled={!onSelectDay}
                onPress={() => {
                  select();
                  onSelectDay?.(cell.day!);
                }}
                accessibilityLabel={cell.day + ' ' + STATUS_LABEL[c.status] + (c.late && c.status !== 'telat' ? ', terlambat' : '')}
                style={[
                  styles.dayTile,
                  {
                    backgroundColor: c.bg,
                    borderColor: isSelected ? colors.ink : c.border || 'transparent',
                    borderWidth: isSelected ? 3 : (c.borderWidth ?? 0),
                    borderStyle: c.dashed && !isSelected ? 'dashed' : 'solid',
                  },
                ]}
              >
                {c.split && <View style={[styles.splitBottom, { backgroundColor: DAY_PALETTE.izin.bg }]} />}
                <Text style={[styles.dayTileText, { color: c.text }]}>
                  {cell.day}
                </Text>
                {c.late && (
                  <View style={styles.lateMark}>
                    <Feather name="clock" size={9} color="#EA580C" />
                  </View>
                )}
                {c.isToday && <View style={[styles.todayDot, { backgroundColor: c.text }]} />}
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* 5. Clean Semantic Status Legend */}
      <View style={styles.legendContainer}>
        <View style={styles.legendRow}>
          {LEGEND.map((l) => (
            <View key={l.label} style={styles.legendPill}>
              {l.split ? (
                <View style={[styles.legendDot, { backgroundColor: DAY_PALETTE.lengkap.bg, overflow: 'hidden' }]}>
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', backgroundColor: DAY_PALETTE.izin.bg }} />
                </View>
              ) : l.clock ? (
                <Feather name="clock" size={11} color="#EA580C" />
              ) : (
                <View style={[styles.legendDot, { backgroundColor: l.bg }, l.border ? { borderWidth: 1.5, borderColor: l.border, borderStyle: 'dashed' } : null]} />
              )}
              <Text style={styles.legendLabel}>{l.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 2,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  currentMonthBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
  },
  currentMonthBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  navControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  todayShortcutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 2,
  },
  todayShortcutText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.ink,
  },
  chevronGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chevronBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stat Summary Strip (Shadcn style)
  statSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  statChipBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 3,
  },
  statChip: {
    flexGrow: 1,
    flexBasis: '30%',
    overflow: 'hidden',
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  statChipLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '600',
  },
  statChipValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  weekHeaderRow: {
    flexDirection: 'row',
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderMuted,
  },
  weekHeaderCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 2,
  },
  weekHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  weekHeaderTextWeekend: {
    color: colors.danger,
    fontWeight: '600',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  dayCellWrapper: {
    width: '14.2857%',
    aspectRatio: 1,
    padding: 2.5,
  },
  dayTile: {
    flex: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  splitBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
  },
  lateMark: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayDot: {
    position: 'absolute',
    bottom: 3,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  dayTileText: {
    fontSize: 13,
    fontWeight: '700',
  },
  legendContainer: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderMuted,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-start',
  },
  legendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '500',
  },
});
