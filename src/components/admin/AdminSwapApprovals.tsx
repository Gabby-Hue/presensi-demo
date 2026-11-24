import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ShiftSwap, UserProfile, WorkShift } from '../../types/attendance';
import { AttendanceService } from '../../services/attendanceService';
import { Card } from '../ui/Card';
import { colors, fontSize, radius } from '../../theme';
import { select, succeed, fail } from '../../services/feedbackService';
import { todayWIB } from '../../utils/dates';
import { DAY_LABELS, weekdayOf } from '../../utils/shifts';

interface Props {
  currentAdmin: UserProfile;
  users: UserProfile[];
}

const fmtDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][m - 1];
  return DAY_LABELS[weekdayOf(d)] + ', ' + day + ' ' + bulan + ' ' + y;
};

/** Persetujuan tukar shift yang sudah diterima rekan (status pending_admin). */
export const AdminSwapApprovals: React.FC<Props> = ({ currentAdmin, users }) => {
  const [swaps, setSwaps] = useState<ShiftSwap[]>([]);
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const companyId = currentAdmin.companyId || undefined;

  const load = useCallback(async () => {
    try {
      const from = todayWIB(new Date(Date.now() - 30 * 86400e3));
      const [list, sh] = await Promise.all([
        AttendanceService.getShiftSwaps({ companyId, fromDate: from, status: ['pending_admin', 'approved', 'rejected'] }),
        AttendanceService.getShifts(companyId),
      ]);
      setSwaps(list);
      setShifts(sh);
      setError(null);
    } catch (e: any) {
      setError('Gagal memuat tukar shift. (' + (e?.message || e) + ')');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const name = (id: string) => users.find((u) => u.id === id)?.fullName || 'Karyawan';
  const shiftLabel = (id?: string | null) => {
    const s = shifts.find((x) => x.id === id);
    return s ? s.name + ' ' + s.startTime + '-' + s.endTime : 'Jam kantor';
  };

  const decide = async (s: ShiftSwap, to: 'approved' | 'rejected') => {
    select();
    setBusyId(s.id);
    setError(null);
    try {
      await AttendanceService.setShiftSwapStatus(s.id, 'pending_admin', to, currentAdmin.id);
      succeed();
      await load();
    } catch (e: any) {
      fail();
      setError(e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const pending = swaps.filter((s) => s.status === 'pending_admin').sort((a, b) => a.swapDate.localeCompare(b.swapDate));
  const decided = swaps.filter((s) => s.status !== 'pending_admin').slice(0, 8);

  return (
    <Card
      title={'Tukar Shift' + (pending.length ? ' (' + pending.length + ')' : '')}
      subtitle="Pengajuan tukar shift yang sudah disepakati kedua karyawan"
      icon="repeat"
      style={{ marginTop: 14 }}
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
      ) : (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {pending.length === 0 ? (
            <Text style={styles.empty}>Tidak ada tukar shift yang menunggu persetujuan.</Text>
          ) : (
            pending.map((s) => (
              <View key={s.id} style={styles.item}>
                <Text style={styles.date}>{fmtDate(s.swapDate)}{s.department ? ' · ' + s.department : ''}</Text>
                <View style={styles.swapLine}>
                  <Text style={styles.person} numberOfLines={1}>{name(s.requesterId)}</Text>
                  <Text style={styles.shift} numberOfLines={1}>{shiftLabel(s.requesterShiftId)}</Text>
                  <Feather name="arrow-right" size={13} color={colors.muted} />
                  <Text style={styles.shiftNew} numberOfLines={1}>{shiftLabel(s.partnerShiftId)}</Text>
                </View>
                <View style={styles.swapLine}>
                  <Text style={styles.person} numberOfLines={1}>{name(s.partnerId)}</Text>
                  <Text style={styles.shift} numberOfLines={1}>{shiftLabel(s.partnerShiftId)}</Text>
                  <Feather name="arrow-right" size={13} color={colors.muted} />
                  <Text style={styles.shiftNew} numberOfLines={1}>{shiftLabel(s.requesterShiftId)}</Text>
                </View>
                {s.note ? <Text style={styles.note}>Alasan: {s.note}</Text> : null}
                <View style={styles.row}>
                  <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} disabled={busyId === s.id} onPress={() => decide(s, 'rejected')}>
                    <Text style={styles.btnGhostText}>Tolak</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, { flex: 1 }, busyId === s.id && { opacity: 0.6 }]} disabled={busyId === s.id} onPress={() => decide(s, 'approved')}>
                    {busyId === s.id ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.btnText}>Setujui</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          {decided.length > 0 && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Keputusan terakhir</Text>
              {decided.map((s) => (
                <View key={s.id} style={styles.histRow}>
                  <Text style={styles.histText} numberOfLines={1}>
                    {fmtDate(s.swapDate)} · {name(s.requesterId)} dan {name(s.partnerId)}
                  </Text>
                  <Text style={[styles.histStatus, { color: s.status === 'approved' ? colors.success : colors.danger }]}>
                    {s.status === 'approved' ? 'Disetujui' : 'Ditolak'}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: fontSize.xs, fontWeight: '600', marginBottom: 8 },
  empty: { fontSize: fontSize.sm, color: colors.muted, paddingVertical: 6 },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, marginBottom: 10, gap: 4 },
  date: { fontSize: fontSize.sm, fontWeight: '800', color: colors.ink, marginBottom: 2 },
  swapLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  person: { width: 110, fontSize: fontSize.xs, fontWeight: '700', color: colors.ink },
  shift: { flexShrink: 1, fontSize: fontSize.xs, color: colors.muted },
  shiftNew: { flexShrink: 1, fontSize: fontSize.xs, fontWeight: '700', color: colors.primaryDark },
  note: { fontSize: fontSize.xs, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: fontSize.sm },
  btnGhost: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', backgroundColor: '#FFFFFF' },
  btnGhostText: { color: colors.ink, fontWeight: '700', fontSize: fontSize.sm },
  label: { fontSize: fontSize.xs, fontWeight: '700', color: colors.muted, marginBottom: 4 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.surfaceSoft },
  histText: { flex: 1, fontSize: fontSize.xs, color: colors.ink },
  histStatus: { fontSize: 11, fontWeight: '700' },
});
