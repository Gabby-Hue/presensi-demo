import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ShiftSwap, ShiftSwapStatus, UserProfile, WorkShift } from '../../types/attendance';
import { AttendanceService } from '../../services/attendanceService';
import { SelectDropdown } from '../ui/SelectDropdown';
import { colors, fontSize, neoShadow, radius } from '../../theme';
import { select, succeed, fail } from '../../services/feedbackService';
import { shiftIdFor, DAY_LABELS, weekdayOf } from '../../utils/shifts';
import { todayWIB } from '../../utils/dates';

interface Props {
  user: UserProfile;
  shifts: WorkShift[];
  /** Tukar shift yang melibatkan user (dimuat AttendanceHub). */
  swaps: ShiftSwap[];
  onChanged: () => void;
}

const STATUS: Record<ShiftSwapStatus, { label: string; color: string; bg: string }> = {
  pending_partner: { label: 'Menunggu rekan', color: '#B45309', bg: '#FEF3C7' },
  pending_admin: { label: 'Menunggu admin', color: '#6D28D9', bg: '#EDE9FE' },
  approved: { label: 'Disetujui', color: '#15803D', bg: '#DCFCE7' },
  rejected: { label: 'Ditolak', color: '#B91C1C', bg: '#FEE2E2' },
  cancelled: { label: 'Dibatalkan', color: colors.muted, bg: colors.surfaceSoft },
};

const DAYS_AHEAD = 14;
const fmtDate = (d: string) => {
  const [, m, day] = d.split('-').map(Number);
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][m - 1];
  return DAY_LABELS[weekdayOf(d)] + ', ' + day + ' ' + bulan;
};

export const ShiftSwapPanel: React.FC<Props> = ({ user, shifts, swaps, onChanged }) => {
  const [colleagues, setColleagues] = useState<UserProfile[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [date, setDate] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AttendanceService.getAllUsers(user.companyId || undefined)
      .then((list) =>
        setColleagues(list.filter((u) => u.role === 'employee' && u.id !== user.id && (u.department || '') === (user.department || '')))
      )
      .catch(() => setColleagues([]));
  }, [user.id, user.companyId, user.department]);

  const shiftById = (id?: string | null) => shifts.find((s) => s.id === id) || null;
  const label = (id?: string | null) => {
    const s = shiftById(id);
    return s ? s.name + ' ' + s.startTime + '-' + s.endTime : 'Jam kantor';
  };
  const nameOf = (id: string) => (id === user.id ? 'Anda' : colleagues.find((u) => u.id === id)?.fullName || 'Rekan');

  // Tanggal yang bisa ditukar: 14 hari ke depan, saya punya shift di hari itu
  const dates = useMemo(() => {
    const out: { date: string; shiftId: string }[] = [];
    const base = Date.parse(todayWIB() + 'T00:00:00Z');
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(base + i * 86400e3).toISOString().slice(0, 10);
      const sid = shiftIdFor(user, d, shifts);
      if (sid) out.push({ date: d, shiftId: sid });
    }
    return out;
  }, [user, shifts]);

  const myShiftOnDate = dates.find((d) => d.date === date)?.shiftId || null;
  const partnerOptions = useMemo(() => {
    if (!date || !myShiftOnDate) return [];
    return colleagues
      .map((u) => ({ u, sid: shiftIdFor(u, date, shifts) }))
      .filter((x) => x.sid && x.sid !== myShiftOnDate)
      .map((x) => ({ value: x.u.id, label: x.u.fullName + ' · ' + label(x.sid) }));
  }, [date, myShiftOnDate, colleagues, shifts]);

  const partner = colleagues.find((u) => u.id === partnerId) || null;
  const incoming = swaps.filter((s) => s.partnerId === user.id && s.status === 'pending_partner');
  const history = swaps.filter((s) => !(s.partnerId === user.id && s.status === 'pending_partner')).slice(0, 10);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      succeed();
      onChanged();
    } catch (e: any) {
      fail();
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (!date || !myShiftOnDate) throw new Error('Pilih tanggal dulu.');
      if (!partner) throw new Error('Pilih rekan yang diajak tukar.');
      await AttendanceService.createShiftSwap({
        companyId: user.companyId,
        department: user.department,
        requesterId: user.id,
        partnerId,
        swapDate: date,
        requesterShiftId: myShiftOnDate,
        partnerShiftId: shiftIdFor(partner, date, shifts),
        note,
      });
      setFormOpen(false);
      setDate('');
      setPartnerId('');
      setNote('');
    });

  return (
    <View style={[styles.card, neoShadow.sm]}>
      <View style={styles.head}>
        <View style={styles.iconBox}>
          <Feather name="repeat" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tukar Shift</Text>
          <Text style={styles.sub}>Tukar shift dengan rekan satu divisi untuk satu hari. Perlu persetujuan rekan dan admin.</Text>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {incoming.map((s) => (
        <View key={s.id} style={styles.incoming}>
          <Text style={styles.incomingTitle}>{nameOf(s.requesterId)} mengajak tukar shift</Text>
          <Text style={styles.line}>{fmtDate(s.swapDate)}</Text>
          <Text style={styles.line}>Anda: {label(s.partnerShiftId)} menjadi {label(s.requesterShiftId)}</Text>
          {s.note ? <Text style={styles.note}>"{s.note}"</Text> : null}
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} disabled={busy}
              onPress={() => { select(); run(() => AttendanceService.setShiftSwapStatus(s.id, 'pending_partner', 'rejected')); }}>
              <Text style={styles.btnGhostText}>Tolak</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { flex: 1 }, busy && { opacity: 0.6 }]} disabled={busy}
              onPress={() => { select(); run(() => AttendanceService.setShiftSwapStatus(s.id, 'pending_partner', 'pending_admin')); }}>
              <Text style={styles.btnText}>Terima</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {formOpen ? (
        <View style={styles.form}>
          <Text style={styles.label}>Tanggal (14 hari ke depan)</Text>
          {dates.length === 0 ? (
            <Text style={styles.sub}>Anda belum punya jadwal shift di 14 hari ke depan.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
              {dates.map((d) => {
                const on = d.date === date;
                return (
                  <TouchableOpacity key={d.date} onPress={() => { select(); setDate(d.date); setPartnerId(''); }}
                    style={[styles.dateChip, on && styles.dateChipOn]} accessibilityState={{ selected: on }}>
                    <Text style={[styles.dateChipDay, on && { color: '#FFFFFF' }]}>{fmtDate(d.date)}</Text>
                    <Text style={[styles.dateChipShift, on && { color: '#FFFFFF' }]} numberOfLines={1}>{shiftById(d.shiftId)?.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {date ? (
            <>
              <Text style={[styles.label, { marginTop: 10 }]}>Tukar dengan</Text>
              <SelectDropdown
                options={partnerOptions}
                value={partnerId}
                onChange={setPartnerId}
                icon="user"
                placeholder="Pilih rekan yang shiftnya berbeda"
                emptyText="Tidak ada rekan satu divisi dengan shift berbeda di tanggal ini."
                accessibilityLabel="Rekan tukar shift"
              />
              {partner ? (
                <Text style={styles.summary}>
                  {fmtDate(date)}: Anda masuk {label(shiftIdFor(partner, date, shifts))}, {partner.fullName} masuk {label(myShiftOnDate)}.
                </Text>
              ) : null}
            </>
          ) : null}

          <Text style={[styles.label, { marginTop: 10 }]}>Alasan (opsional)</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="mis. ada acara keluarga pagi hari"
            placeholderTextColor={colors.faint} accessibilityLabel="Alasan tukar shift" />

          <View style={styles.row}>
            <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => { select(); setFormOpen(false); setError(null); }}>
              <Text style={styles.btnGhostText}>Batal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { flex: 2 }, (busy || !partnerId) && { opacity: 0.6 }]} disabled={busy || !partnerId} onPress={submit}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.btnText}>Kirim ke rekan</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.btnOutline} onPress={() => { select(); setFormOpen(true); setError(null); }}>
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={styles.btnOutlineText}>Ajukan tukar shift</Text>
        </TouchableOpacity>
      )}

      {history.length > 0 && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>Riwayat</Text>
          {history.map((s) => {
            const mine = s.requesterId === user.id;
            const st = STATUS[s.status];
            const canCancel = mine && (s.status === 'pending_partner' || s.status === 'pending_admin');
            return (
              <View key={s.id} style={styles.histRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.histTitle} numberOfLines={1}>
                    {fmtDate(s.swapDate)} · dengan {nameOf(mine ? s.partnerId : s.requesterId)}
                  </Text>
                  <Text style={styles.line} numberOfLines={1}>
                    Anda: {label(mine ? s.requesterShiftId : s.partnerShiftId)} menjadi {label(mine ? s.partnerShiftId : s.requesterShiftId)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
                  </View>
                  {canCancel && (
                    <TouchableOpacity hitSlop={8} disabled={busy}
                      onPress={() => { select(); run(() => AttendanceService.setShiftSwapStatus(s.id, s.status, 'cancelled')); }}>
                      <Text style={styles.cancelText}>Batalkan</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  head: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  iconBox: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.md, fontWeight: '800', color: colors.ink },
  sub: { fontSize: fontSize.xs, color: colors.muted, marginTop: 2, lineHeight: 17 },
  error: { color: colors.danger, fontSize: fontSize.xs, fontWeight: '600', marginBottom: 8 },
  incoming: { borderWidth: 1, borderColor: '#C4B5FD', backgroundColor: '#F5F3FF', borderRadius: radius.md, padding: 10, marginBottom: 10, gap: 2 },
  incomingTitle: { fontSize: fontSize.sm, fontWeight: '800', color: '#5B21B6' },
  line: { fontSize: fontSize.xs, color: colors.ink },
  note: { fontSize: fontSize.xs, color: colors.muted, fontStyle: 'italic' },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  form: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, backgroundColor: colors.surfaceSoft },
  label: { fontSize: fontSize.xs, fontWeight: '700', color: colors.muted, marginBottom: 4 },
  dateChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF', minWidth: 92 },
  dateChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateChipDay: { fontSize: fontSize.xs, fontWeight: '800', color: colors.ink },
  dateChipShift: { fontSize: 11, color: colors.muted, marginTop: 1 },
  summary: { marginTop: 8, fontSize: fontSize.xs, fontWeight: '600', color: colors.primaryDark, backgroundColor: colors.primarySoft, padding: 8, borderRadius: radius.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: fontSize.sm, color: colors.ink, backgroundColor: '#FFFFFF' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: fontSize.sm },
  btnGhost: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', backgroundColor: '#FFFFFF' },
  btnGhostText: { color: colors.ink, fontWeight: '700', fontSize: fontSize.sm },
  btnOutline: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryBorder, borderRadius: radius.md, paddingVertical: 10 },
  btnOutlineText: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm },
  histRow: { flexDirection: 'row', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surfaceSoft },
  histTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.ink },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  cancelText: { fontSize: 11, fontWeight: '700', color: colors.danger },
});
