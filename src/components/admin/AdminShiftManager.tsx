import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { UserProfile, WorkShift } from '../../types/attendance';
import { AttendanceService } from '../../services/attendanceService';
import { Card } from '../ui/Card';
import { colors, fontSize, radius } from '../../theme';
import { select, succeed, fail } from '../../services/feedbackService';
import { DAY_LABELS, ShiftSchedule, isOvernight, shiftIdFor, validateShiftTimes } from '../../utils/shifts';
import { todayWIB } from '../../utils/dates';

interface Props {
  currentAdmin: UserProfile;
  users: UserProfile[];
  onChanged: () => void;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const emptyForm = { name: '', start: '07:00', end: '15:00', late: '07:15' };

/**
 * Shift per departemen (opsional). Departemen tanpa shift (mis. HRD, Accounting) tetap ikut jam kantor.
 * Karyawan punya shift tetap + jadwal per hari (opsional) yang menimpa shift tetap pada hari itu.
 * Shift dari departemen lain boleh dipakai; shift boleh lewat tengah malam (mis. 22:00 - 06:00).
 */
export const AdminShiftManager: React.FC<Props> = ({ currentAdmin, users, onChanged }) => {
  const companyId = currentAdmin.role === 'superadmin' ? undefined : currentAdmin.companyId || undefined;
  const [departments, setDepartments] = useState<string[]>([]);
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openDept, setOpenDept] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // shift_id lokal agar pilihan langsung terlihat sebelum daftar user di-refresh
  const [assigned, setAssigned] = useState<Record<string, string | null>>({});
  const [schedules, setSchedules] = useState<Record<string, ShiftSchedule>>({});
  const [openSchedule, setOpenSchedule] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [depts, list] = await Promise.all([
        AttendanceService.getDepartments(companyId),
        AttendanceService.getShifts(companyId),
      ]);
      setDepartments(depts);
      setShifts(list);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(
        'Tabel shift belum ada. Jalankan supabase_migration_shifts.sql di Supabase SQL Editor. (' + (e?.message || e) + ')'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [companyId]);

  const shiftOf = (u: UserProfile) => (u.id in assigned ? assigned[u.id] : u.shiftId) || null;
  const employeesByDept = useMemo(() => {
    const m: Record<string, UserProfile[]> = {};
    users.filter((u) => u.role === 'employee').forEach((u) => {
      (m[u.department || 'None'] ||= []).push(u);
    });
    return m;
  }, [users]);

  const addShift = async (dept: string) => {
    const name = form.name.trim();
    if (!name) return setFormError('Nama shift wajib diisi (mis. Shift Pagi).');
    if (![form.start, form.end, form.late].every((t) => TIME_RE.test(t))) return setFormError('Format jam harus HH:MM, mis. 07:00.');
    const timeError = validateShiftTimes(form.start, form.end, form.late);
    if (timeError) return setFormError(timeError);
    setBusy(true);
    setFormError(null);
    try {
      const created = await AttendanceService.addShift({
        companyId: companyId || null,
        department: dept,
        name,
        startTime: form.start,
        endTime: form.end,
        lateDeadline: form.late,
      });
      setShifts((s) => [...s, created]);
      setForm(emptyForm);
      succeed();
    } catch (e: any) {
      fail();
      setFormError(e?.message || 'Gagal menambah shift.');
    } finally {
      setBusy(false);
    }
  };

  const removeShift = async (s: WorkShift) => {
    setBusy(true);
    try {
      await AttendanceService.deleteShift(s.id);
      setShifts((list) => list.filter((x) => x.id !== s.id));
      setAssigned((a) => {
        const next = { ...a };
        users.forEach((u) => {
          if (shiftOf(u) === s.id) next[u.id] = null;
        });
        return next;
      });
      succeed();
      onChanged();
    } catch (e: any) {
      fail();
      setFormError(e?.message || 'Gagal menghapus shift.');
    } finally {
      setBusy(false);
    }
  };

  const assign = async (u: UserProfile, shiftId: string | null) => {
    select();
    const prev = shiftOf(u);
    setAssigned((a) => ({ ...a, [u.id]: shiftId }));
    try {
      await AttendanceService.setUserShift(u.id, shiftId);
      onChanged();
    } catch (e: any) {
      fail();
      setAssigned((a) => ({ ...a, [u.id]: prev }));
      setFormError(e?.message || 'Gagal menyimpan shift karyawan.');
    }
  };

  const scheduleOf = (u: UserProfile): ShiftSchedule => schedules[u.id] ?? u.shiftSchedule ?? {};

  // value undefined = hari itu ikut shift tetap
  const setDay = async (u: UserProfile, day: number, value: string | null | undefined) => {
    select();
    const prev = scheduleOf(u);
    const next: ShiftSchedule = { ...prev };
    if (value === undefined) delete next[day];
    else next[day] = value;
    setSchedules((s) => ({ ...s, [u.id]: next }));
    try {
      await AttendanceService.setUserShiftSchedule(u.id, Object.keys(next).length ? next : null);
      onChanged();
    } catch (e: any) {
      fail();
      setSchedules((s) => ({ ...s, [u.id]: prev }));
      setFormError(e?.message || 'Gagal menyimpan jadwal karyawan.');
    }
  };

  const today = todayWIB();
  const membersOf = (s: WorkShift) =>
    users.filter((u) => u.role === 'employee' && shiftIdFor({ shiftId: shiftOf(u), shiftSchedule: scheduleOf(u) }, today) === s.id);

  const shiftLabel = (s: WorkShift, dept: string) => (s.department === dept ? s.name : s.name + ' (' + s.department + ')');
  // Shift departemen sendiri dulu, lalu shift departemen lain.
  const shiftsFor = (dept: string) => [
    ...shifts.filter((s) => s.department === dept),
    ...shifts.filter((s) => s.department !== dept),
  ];

  const renderChips = (
    dept: string,
    current: string | null | undefined,
    onPick: (id: string | null | undefined) => void,
    withDefault: boolean
  ) => {
    const known = current == null || shifts.some((s) => s.id === current);
    const opts: { id: string | null | undefined; name: string }[] = [
      ...(withDefault ? [{ id: undefined, name: 'Ikut shift tetap' }] : []),
      { id: null, name: 'Jam kantor' },
      ...shiftsFor(dept).map((s) => ({ id: s.id, name: shiftLabel(s, dept) })),
    ];
    return (
      <View style={styles.chips}>
        {opts.map((o) => {
          // shift yang sudah dihapus dianggap jam kantor
          const on = o.id === (known ? current : null);
          return (
            <TouchableOpacity key={o.id === undefined ? 'default' : o.id || 'none'} onPress={() => onPick(o.id)}
              style={[styles.chip, on && styles.chipOn]} accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>{o.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <Card title="Shift Kerja" subtitle="Buka departemen untuk membuat shift dan memilih shift tiap karyawan. Tanpa shift = jam kantor." icon="clock">
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
      ) : loadError ? (
        <Text style={styles.error}>{loadError}</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {departments.map((dept) => {
            const deptShifts = shifts.filter((s) => s.department === dept);
            const staff = employeesByDept[dept] || [];
            const open = openDept === dept;
            return (
              <View key={dept} style={styles.dept}>
                <TouchableOpacity
                  style={styles.deptHead}
                  activeOpacity={0.8}
                  onPress={() => {
                    select();
                    setOpenDept(open ? null : dept);
                    setForm(emptyForm);
                    setFormError(null);
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.deptName}>{dept}</Text>
                    <Text style={styles.deptSub}>
                      {deptShifts.length ? `${deptShifts.length} shift · ${staff.length} karyawan` : `Tanpa shift (jam kantor) · ${staff.length} karyawan`}
                    </Text>
                  </View>
                  <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
                </TouchableOpacity>

                {open && (
                  <View style={styles.body}>
                    {deptShifts.map((s) => (
                      <View key={s.id} style={styles.shiftRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.shiftName}>{s.name}</Text>
                          <Text style={styles.deptSub}>
                            {s.startTime} - {s.endTime} WIB{isOvernight(s) ? ' (lewat tengah malam)' : ''} · telat setelah {s.lateDeadline}
                          </Text>
                          {(() => {
                            const mem = membersOf(s);
                            return (
                              <Text style={styles.members} numberOfLines={2}>
                                {mem.length ? 'Hari ini ' + mem.length + ' orang: ' + mem.map((u) => u.fullName).join(', ') : 'Hari ini belum ada karyawan'}
                              </Text>
                            );
                          })()}
                        </View>
                        <TouchableOpacity onPress={() => removeShift(s)} disabled={busy} hitSlop={10} accessibilityLabel={`Hapus ${s.name}`}>
                          <Feather name="trash-2" size={17} color={busy ? colors.faint : colors.danger} />
                        </TouchableOpacity>
                      </View>
                    ))}

                    <Text style={styles.label}>Tambah shift</Text>
                    <TextInput style={styles.input} placeholder="Nama shift, mis. Shift Pagi" value={form.name}
                      onChangeText={(t) => setForm((f) => ({ ...f, name: t }))} />
                    <View style={styles.row}>
                      {([['start', 'Masuk'], ['end', 'Pulang'], ['late', 'Batas telat']] as const).map(([k, lbl]) => (
                        <View key={k} style={{ flex: 1 }}>
                          <Text style={styles.label}>{lbl}</Text>
                          <TextInput style={styles.input} value={form[k]} placeholder="HH:MM" maxLength={5} accessibilityLabel={lbl}
                            onChangeText={(t) => setForm((f) => ({ ...f, [k]: t }))} />
                        </View>
                      ))}
                    </View>
                    {formError ? <Text style={styles.error}>{formError}</Text> : null}
                    <TouchableOpacity style={[styles.addBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => addShift(dept)}>
                      <Feather name="plus" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.addBtnText}>Tambah Shift {dept}</Text>
                    </TouchableOpacity>

                    {shifts.length > 0 && (
                      <>
                        <Text style={[styles.label, { marginTop: 12 }]}>Shift tiap karyawan</Text>
                        {staff.length === 0 ? (
                          <Text style={styles.deptSub}>Belum ada karyawan di departemen ini.</Text>
                        ) : (
                          staff.map((u) => {
                            const sched = scheduleOf(u);
                            const customDays = Object.keys(sched).length;
                            const schedOpen = openSchedule === u.id;
                            return (
                              <View key={u.id} style={styles.staffBlock}>
                                <View style={styles.staffRow}>
                                  <Text style={styles.staffName} numberOfLines={1}>{u.fullName}</Text>
                                  {renderChips(dept, shiftOf(u), (id) => assign(u, id ?? null), false)}
                                </View>
                                <TouchableOpacity onPress={() => { select(); setOpenSchedule(schedOpen ? null : u.id); }}
                                  style={styles.schedToggle} accessibilityState={{ expanded: schedOpen }}>
                                  <Feather name="calendar" size={13} color={colors.primary} />
                                  <Text style={styles.schedToggleText}>
                                    {'Jadwal per hari' + (customDays ? ' · ' + customDays + ' hari diatur' : '')}
                                  </Text>
                                  <Feather name={schedOpen ? 'chevron-up' : 'chevron-down'} size={13} color={colors.primary} />
                                </TouchableOpacity>
                                {schedOpen &&
                                  [1, 2, 3, 4, 5, 6, 0].map((d) => (
                                    <View key={d} style={styles.dayRow}>
                                      <Text style={styles.dayLabel}>{DAY_LABELS[d]}</Text>
                                      <View style={{ flex: 1 }}>
                                        {renderChips(dept, String(d) in sched ? sched[d] : undefined, (id) => setDay(u, d, id), true)}
                                      </View>
                                    </View>
                                  ))}
                              </View>
                            );
                          })
                        )}
                      </>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  dept: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  deptHead: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  deptName: { fontSize: fontSize.md, fontWeight: '800', color: colors.ink },
  deptSub: { fontSize: fontSize.xs, color: colors.muted, marginTop: 2 },
  body: { paddingHorizontal: 12, paddingBottom: 12, gap: 6, borderTopWidth: 1, borderTopColor: colors.border },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  shiftName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.ink },
  label: { fontSize: fontSize.xs, fontWeight: '700', color: colors.muted, marginTop: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: fontSize.sm, color: colors.ink, backgroundColor: '#FFFFFF', marginTop: 4 },
  row: { flexDirection: 'row', gap: 8 },
  error: { color: colors.danger, fontSize: fontSize.xs, fontWeight: '600', marginTop: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10, marginTop: 8 },
  addBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: fontSize.sm },
  members: { fontSize: fontSize.xs, color: colors.ink, marginTop: 2 },
  staffBlock: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  schedToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, alignSelf: 'flex-start' },
  schedToggleText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  dayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  dayLabel: { width: 32, fontSize: fontSize.xs, fontWeight: '700', color: colors.muted, paddingTop: 6 },
  staffRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 6 },
  staffName: { flexBasis: 140, flexGrow: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.ink },
});
