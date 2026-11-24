import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AttendanceRecord, OfficeSettings, ShiftSwap, UserProfile, WorkShift } from '../../types/attendance';
import { AttendanceService } from '../../services/attendanceService';
import { Card } from '../ui/Card';
import { colors, fontSize, radius } from '../../theme';
import { select } from '../../services/feedbackService';
import { todayWIB } from '../../utils/dates';
import { swapOverrides } from '../../utils/shifts';
import { buildInsights } from '../../utils/insights';
import { DAY_PALETTE } from '../user/MonthAttendanceCalendar';

interface Props {
  currentAdmin: UserProfile;
  users: UserProfile[];
  offices: OfficeSettings[];
}

const RANGES = [7, 14, 30] as const;
const SERIES = [
  { key: 'tepat', label: 'Tepat waktu', color: DAY_PALETTE.lengkap.bg },
  { key: 'telat', label: 'Telat', color: DAY_PALETTE.telat.bg },
  { key: 'izin', label: 'Izin/Sakit', color: DAY_PALETTE.izin.bg },
  { key: 'alpha', label: 'Alpha', color: DAY_PALETTE.absen.bg },
] as const;
const CHART_H = 140;

export const AdminInsights: React.FC<Props> = ({ currentAdmin, users, offices }) => {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [swaps, setSwaps] = useState<ShiftSwap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const companyId = currentAdmin.companyId || undefined;

  const today = todayWIB();
  // Selalu ambil 30 hari agar ganti rentang tidak memuat ulang
  const from30 = todayWIB(new Date(Date.now() - 29 * 86400e3));

  useEffect(() => {
    setLoading(true);
    Promise.all([
      AttendanceService.getAllAttendances({ startDate: todayWIB(new Date(Date.now() - 60 * 86400e3)), companyId }),
      AttendanceService.getShifts(companyId).catch(() => [] as WorkShift[]),
      AttendanceService.getShiftSwaps({ companyId, status: ['approved'], fromDate: from30 }).catch(() => [] as ShiftSwap[]),
    ])
      .then(([recs, sh, sw]) => {
        setRecords(recs);
        setShifts(sh);
        setSwaps(sw);
        setError(null);
      })
      .catch((e) => setError('Gagal memuat data grafik. (' + (e?.message || e) + ')'))
      .finally(() => setLoading(false));
  }, [companyId]);

  const data = useMemo(() => {
    const from = todayWIB(new Date(Date.now() - (range - 1) * 86400e3));
    const withSwaps = swaps.length ? users.map((u) => ({ ...u, shiftOverrides: swapOverrides(swaps, u.id) })) : users;
    return buildInsights(withSwaps, records, shifts, offices, from, today);
  }, [range, users, records, shifts, swaps, offices, today]);

  const maxDay = Math.max(1, ...data.days.map((d) => d.tepat + d.telat + d.izin + d.alpha));
  const maxDeptTelat = Math.max(1, ...data.byDept.map((d) => d.telat));
  const hovered = hover != null ? data.days[hover] : null;

  return (
    <Card
      title="Grafik Kehadiran"
      subtitle="Tren harian, divisi paling sering telat, dan karyawan yang perlu perhatian"
      icon="bar-chart-2"
      style={{ marginTop: 14 }}
      action={
        <View style={styles.rangeRow}>
          {RANGES.map((r) => (
            <TouchableOpacity key={r} onPress={() => { select(); setRange(r); setHover(null); }}
              style={[styles.rangeChip, range === r && styles.rangeChipOn]} accessibilityState={{ selected: range === r }}>
              <Text style={[styles.rangeText, range === r && { color: '#FFFFFF' }]}>{r} hari</Text>
            </TouchableOpacity>
          ))}
        </View>
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <View style={{ gap: 18 }}>
          {/* KPI */}
          <View style={styles.kpiRow}>
            <Kpi label="Tingkat kehadiran" value={data.attendanceRate + '%'} color={colors.primary} />
            <Kpi label="Telat" value={String(data.totals.telat)} color={DAY_PALETTE.telat.bg} />
            <Kpi label="Izin/Sakit" value={String(data.totals.izin)} color={DAY_PALETTE.izin.bg} />
            <Kpi label="Alpha" value={String(data.totals.alpha)} color={DAY_PALETTE.absen.bg} />
          </View>

          {/* Tren harian (batang bertumpuk) */}
          <View>
            <Text style={styles.section}>Tren harian</Text>
            <Text style={styles.hint}>
              {hovered
                ? hovered.date.slice(8) + '/' + hovered.date.slice(5, 7) + ': ' +
                  hovered.tepat + ' tepat, ' + hovered.telat + ' telat, ' + hovered.izin + ' izin, ' + hovered.alpha + ' alpha'
                : 'Ketuk batang untuk melihat angka per hari.'}
            </Text>
            <View style={styles.chart}>
              {data.days.map((d, i) => {
                const total = d.tepat + d.telat + d.izin + d.alpha;
                return (
                  <TouchableOpacity key={d.date} style={styles.barCol} activeOpacity={0.7}
                    onPress={() => setHover(hover === i ? null : i)}
                    accessibilityLabel={d.date + ': ' + d.tepat + ' tepat, ' + d.telat + ' telat, ' + d.izin + ' izin, ' + d.alpha + ' alpha'}>
                    <View style={[styles.barStack, { height: (total / maxDay) * CHART_H }, hover === i && styles.barHover]}>
                      {SERIES.map((s) => {
                        const v = d[s.key];
                        return v ? <View key={s.key} style={{ flex: v, backgroundColor: s.color }} /> : null;
                      }).reverse()}
                    </View>
                    <Text style={styles.barLabel}>
                      {i === 0 || i === data.days.length - 1 || (range > 7 ? i % 5 === 0 : true) ? Number(d.date.slice(8)) : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.legend}>
              {SERIES.map((s) => (
                <View key={s.key} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                  <Text style={styles.legendText}>{s.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Divisi paling sering telat */}
          <View>
            <Text style={styles.section}>Divisi paling sering telat</Text>
            {data.byDept.length === 0 ? (
              <Text style={styles.hint}>Belum ada data kehadiran di rentang ini.</Text>
            ) : (
              data.byDept.slice(0, 6).map((d) => (
                <View key={d.dept} style={styles.hRow}>
                  <Text style={styles.hLabel} numberOfLines={1}>{d.dept}</Text>
                  <View style={styles.hTrack}>
                    <View style={[styles.hBar, { width: `${(d.telat / maxDeptTelat) * 100}%` as `${number}%`, backgroundColor: DAY_PALETTE.telat.bg }]} />
                  </View>
                  <Text style={styles.hValue}>{d.telat}x · {d.rate}%</Text>
                </View>
              ))
            )}
            <Text style={styles.hint}>Persen = telat dibanding jumlah kehadiran divisi itu.</Text>
          </View>

          {/* Karyawan perlu perhatian */}
          <View style={styles.topRow}>
            <TopList title="Paling sering telat" items={data.topTelat} unit="x telat" color={DAY_PALETTE.telat.bg} />
            <TopList title="Paling sering alpha" items={data.topAlpha} unit="hari alpha" color={DAY_PALETTE.absen.bg} />
          </View>
        </View>
      )}
    </Card>
  );
};

const Kpi: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <View style={styles.kpi}>
    <View style={[styles.kpiBar, { backgroundColor: color }]} />
    <Text style={styles.kpiLabel}>{label}</Text>
    <Text style={[styles.kpiValue, { color }]}>{value}</Text>
  </View>
);

const TopList: React.FC<{ title: string; items: Array<{ user: UserProfile; count: number }>; unit: string; color: string }> = ({
  title, items, unit, color,
}) => (
  <View style={styles.topBox}>
    <Text style={styles.section}>{title}</Text>
    {items.length === 0 ? (
      <Text style={styles.hint}>Tidak ada. Bagus.</Text>
    ) : (
      items.map((x, i) => (
        <View key={x.user.id} style={styles.topItem}>
          <Text style={styles.topRank}>{i + 1}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.topName} numberOfLines={1}>{x.user.fullName}</Text>
            <Text style={styles.topDept} numberOfLines={1}>{x.user.department || '-'}</Text>
          </View>
          <Text style={[styles.topCount, { color }]}>{x.count} {unit}</Text>
        </View>
      ))
    )}
  </View>
);

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: fontSize.xs, fontWeight: '600' },
  rangeRow: { flexDirection: 'row', gap: 4 },
  rangeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  rangeChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rangeText: { fontSize: 11, fontWeight: '700', color: colors.ink },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: {
    flexGrow: 1, flexBasis: '22%', minWidth: 120, overflow: 'hidden', padding: 10, paddingTop: 12,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderMuted, backgroundColor: colors.surfaceSoft,
  },
  kpiBar: { position: 'absolute', left: 0, right: 0, top: 0, height: 3 },
  kpiLabel: { fontSize: 11, fontWeight: '600', color: colors.muted },
  kpiValue: { fontSize: 22, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  section: { fontSize: fontSize.sm, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  hint: { fontSize: 11, color: colors.muted, marginBottom: 6 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_H + 18, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  barStack: { width: '100%', maxWidth: 22, borderTopLeftRadius: 3, borderTopRightRadius: 3, overflow: 'hidden', minHeight: 2, backgroundColor: colors.surfaceMuted },
  barHover: { opacity: 0.75 },
  barLabel: { fontSize: 9, color: colors.faint, height: 14, marginTop: 2, fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendText: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  hLabel: { width: 96, fontSize: fontSize.xs, fontWeight: '700', color: colors.ink },
  hTrack: { flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.surfaceSoft, overflow: 'hidden' },
  hBar: { height: '100%', borderRadius: 6 },
  hValue: { width: 72, textAlign: 'right', fontSize: 11, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  topBox: { flexGrow: 1, flexBasis: 240, borderWidth: 1, borderColor: colors.borderMuted, borderRadius: radius.md, padding: 10 },
  topItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.surfaceSoft },
  topRank: { width: 18, fontSize: fontSize.xs, fontWeight: '800', color: colors.muted, textAlign: 'center' },
  topName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.ink },
  topDept: { fontSize: 11, color: colors.muted },
  topCount: { fontSize: 11, fontWeight: '800' },
});
