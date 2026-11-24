import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { UserProfile, WorkShift } from '../../types/attendance';
import { AttendanceService } from '../../services/attendanceService';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { colors, fontSize, radius } from '../../theme';
import { select, succeed, fail } from '../../services/feedbackService';
import { DAY_LABELS, ShiftSchedule, isOvernight, shiftIdFor, validateShiftTimes } from '../../utils/shifts';
import { todayWIB } from '../../utils/dates';
import { formatTimeInput, startTimeChange } from '../../utils/time';

interface Props {
  currentAdmin: UserProfile;
  users: UserProfile[];
  onChanged: () => void;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Kosong agar admin langsung mengetik; jam telat & pulang terisi otomatis dari jam masuk.
const emptyForm = { name: '', start: '', end: '', late: '' };
const TIME_PLACEHOLDER = { start: '08:00', late: '08:30', end: '16:00' } as const;

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
  // Divisi yang baru ditambahkan admin (belum punya jam shift) agar tetap tampil.
  const [addedDepts, setAddedDepts] = useState<string[]>([]);
  const [pickDeptOpen, setPickDeptOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ type: 'shift'; shift: WorkShift } | { type: 'dept'; dept: string } | null>(null);

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
      const msg = String(e?.message || e);
      setLoadError(
        /relation .*shifts.* does not exist|42P01/i.test(msg + (e?.code || ''))
          ? 'Tabel shift belum ada. Jalankan supabase_migration_shifts.sql di Supabase SQL Editor.'
          : 'Gagal memuat data shift. Periksa koneksi lalu buka menu ini lagi. (' + msg + ')'
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
      setFormOpen(false);
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

  const removeDept = async (dept: string) => {
    setBusy(true);
    setFormError(null);
    try {
      const deptShifts = shifts.filter((s) => s.department === dept);
      for (const s of deptShifts) await AttendanceService.deleteShift(s.id);
      const staff = employeesByDept[dept] || [];
      for (const u of staff) {
        if (shiftOf(u)) await AttendanceService.setUserShift(u.id, null);
        if (Object.keys(scheduleOf(u)).length) await AttendanceService.setUserShiftSchedule(u.id, null);
      }
      const ids = new Set(deptShifts.map((s) => s.id));
      setShifts((list) => list.filter((s) => !ids.has(s.id)));
      setAssigned((a) => {
        const next = { ...a };
        users.forEach((u) => {
          if (staff.includes(u) || ids.has(shiftOf(u) || '')) next[u.id] = null;
        });
        return next;
      });
      setSchedules((sc) => {
        const next = { ...sc };
        staff.forEach((u) => (next[u.id] = {}));
        return next;
      });
      staff.forEach((u) => (latest.current[u.id] = {}));
      setAddedDepts((d) => d.filter((x) => x !== dept));
      if (openDept === dept) setOpenDept(null);
      succeed();
      onChanged();
    } catch (e: any) {
      fail();
      setFormError(e?.message || 'Gagal menghapus divisi dari shift.');
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
      setAssigned((a) => (a[u.id] === shiftId ? { ...a, [u.id]: prev } : a));
      setFormError(e?.message || 'Gagal menyimpan shift karyawan.');
    }
  };

  const scheduleOf = (u: UserProfile): ShiftSchedule => schedules[u.id] ?? u.shiftSchedule ?? {};

  // value undefined = hari itu ikut shift tetap
  // Antrian simpan per karyawan agar klik cepat tidak saling menimpa di database.
  const saveQueue = useRef<Record<string, Promise<void>>>({});
  const latest = useRef<Record<string, ShiftSchedule>>({});

  const setDay = (u: UserProfile, day: number, value: string | null | undefined) => {
    select();
    const base = latest.current[u.id] ?? scheduleOf(u);
    const prevValue = base[day];
    const hadKey = String(day) in base;
    const next: ShiftSchedule = { ...base };
    if (value === undefined) delete next[day];
    else next[day] = value;
    latest.current[u.id] = next;
    setSchedules((s) => ({ ...s, [u.id]: next }));
    saveQueue.current[u.id] = (saveQueue.current[u.id] || Promise.resolve()).then(async () => {
      try {
        await AttendanceService.setUserShiftSchedule(u.id, Object.keys(next).length ? next : null);
        onChanged();
      } catch (e: any) {
        fail();
        // kembalikan hanya hari ini, perubahan hari lain yang berhasil tetap
        const cur = { ...(latest.current[u.id] ?? next) };
        if (hadKey) cur[day] = prevValue;
        else delete cur[day];
        latest.current[u.id] = cur;
        setSchedules((s) => ({ ...s, [u.id]: cur }));
        setFormError(e?.message || 'Gagal menyimpan jadwal karyawan.');
      }
    });
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
          // shift yang sudah dihapus: hari itu ikut shift tetap (di jadwal) / jam kantor (shift tetap)
          const on = o.id === (known ? current : withDefault ? undefined : null);
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

  const hasAnyShift = (u: UserProfile) => !!shiftOf(u) || Object.keys(scheduleOf(u)).length > 0;
  const visibleDepts = departments.filter(
    (d) =>
      shifts.some((s) => s.department === d) ||
      addedDepts.includes(d) ||
      (employeesByDept[d] || []).some(hasAnyShift)
  );
  const hiddenDepts = departments.filter((d) => !visibleDepts.includes(d));

  const addDept = (dept: string) => {
    select();
    setAddedDepts((d) => (d.includes(dept) ? d : [...d, dept]));
    setPickDeptOpen(false);
    setOpenDept(dept);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  };

  if (currentAdmin.role !== 'superadmin' && !currentAdmin.companyId) {
    return (
      <Card title="Shift Kerja" subtitle="Akun admin ini belum terhubung ke perusahaan." icon="clock">
        <Text style={styles.error}>Hubungi admin pusat untuk menautkan akun ini ke perusahaan sebelum mengatur shift.</Text>
      </Card>
    );
  }

  return (
    <Card title="Shift Kerja" subtitle="Tambah divisi yang memakai shift, buat jam shiftnya, lalu pilih shift tiap karyawan. Divisi lain tetap jam kantor." icon="clock">
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
      ) : loadError ? (
        <Text style={styles.error}>{loadError}</Text>
      ) : (
        <View style={{ gap: 8 }}>
          <TouchableOpacity
            style={[styles.addBtn, { marginTop: 0 }, hiddenDepts.length === 0 && { opacity: 0.5 }]}
            disabled={hiddenDepts.length === 0}
            onPress={() => { select(); setPickDeptOpen((o) => !o); }}
            accessibilityState={{ expanded: pickDeptOpen }}
          >
            <Feather name={pickDeptOpen ? 'x' : 'plus'} size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={styles.addBtnText}>
              {hiddenDepts.length === 0 ? 'Semua divisi sudah ditambahkan' : pickDeptOpen ? 'Batal' : 'Tambah Divisi'}
            </Text>
          </TouchableOpacity>

          {pickDeptOpen && (
            <View style={styles.pickBox}>
              <Text style={styles.label}>Pilih divisi yang memakai shift</Text>
              <View style={[styles.chips, { marginTop: 6 }]}>
                {hiddenDepts.map((d) => (
                  <TouchableOpacity key={d} style={styles.chip} onPress={() => addDept(d)}>
                    <Text style={styles.chipText}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {visibleDepts.length === 0 && !pickDeptOpen && (
            <View style={styles.emptyBox}>
              <Feather name="clock" size={22} color={colors.muted} />
              <Text style={styles.emptyTitle}>Belum ada divisi yang memakai shift</Text>
              <Text style={styles.deptSub}>Semua karyawan masih memakai jam kantor. Klik Tambah Divisi untuk mulai.</Text>
            </View>
          )}

          {visibleDepts.map((dept) => {
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
                    setFormOpen(false);
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.deptName}>{dept}</Text>
                    <Text style={styles.deptSub}>
                      {deptShifts.length ? `${deptShifts.length} jam shift · ${staff.length} karyawan` : `Belum ada jam shift · ${staff.length} karyawan`}
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
                        <TouchableOpacity onPress={() => { select(); setConfirm({ type: 'shift', shift: s }); }} disabled={busy} hitSlop={10} accessibilityLabel={`Hapus ${s.name}`}>
                          <Feather name="trash-2" size={17} color={busy ? colors.faint : colors.danger} />
                        </TouchableOpacity>
                      </View>
                    ))}

                    {deptShifts.length === 0 && !formOpen && (
                      <Text style={[styles.deptSub, { marginTop: 8 }]}>Belum ada jam shift. Buat jam shift pertama untuk divisi ini.</Text>
                    )}

                    {formOpen ? (
                      <View style={styles.formBox}>
                        <Text style={styles.label}>Jam shift baru</Text>
                        <TextInput style={styles.input} placeholder="Nama shift, mis. Shift Pagi" value={form.name}
                          placeholderTextColor={colors.faint} accessibilityLabel="Nama shift"
                          onChangeText={(t) => setForm((f) => ({ ...f, name: t }))} />
                        <View style={styles.row}>
                          {([['start', 'Masuk'], ['late', 'Batas telat'], ['end', 'Pulang']] as const).map(([k, lbl]) => (
                            <View key={k} style={{ flex: 1 }}>
                              <Text style={styles.label}>{lbl}</Text>
                              <TextInput style={styles.input} value={form[k]} placeholder={TIME_PLACEHOLDER[k]} placeholderTextColor={colors.faint}
                                maxLength={5} keyboardType="number-pad" accessibilityLabel={lbl}
                                onChangeText={(t) => {
                                  if (k !== 'start') return setForm((f) => ({ ...f, [k]: formatTimeInput(t) }));
                                  const p = startTimeChange(t);
                                  setForm((f) => ({ ...f, start: p.start, ...(p.late ? { late: p.late } : {}), ...(p.end ? { end: p.end } : {}) }));
                                }} />
                            </View>
                          ))}
                        </View>
                        <Text style={[styles.deptSub, { marginTop: 4 }]}>Ketik jam masuk (mis. 0800), batas telat +30 menit dan jam pulang +8 jam terisi otomatis dan bisa diubah. Jam pulang lebih kecil dari jam masuk berarti lewat tengah malam.</Text>
                        {formError ? <Text style={styles.error}>{formError}</Text> : null}
                        <View style={styles.row}>
                          <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => { select(); setFormOpen(false); setFormError(null); }}>
                            <Text style={styles.secondaryBtnText}>Batal</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.addBtn, { flex: 2 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => addShift(dept)}>
                            <Feather name="check" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                            <Text style={styles.addBtnText}>Simpan jam shift</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.secondaryBtn} onPress={() => { select(); setForm(emptyForm); setFormError(null); setFormOpen(true); }}>
                        <Feather name="plus" size={14} color={colors.primary} style={{ marginRight: 6 }} />
                        <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Tambah jam shift</Text>
                      </TouchableOpacity>
                    )}

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

                    <TouchableOpacity style={styles.deleteDeptBtn} disabled={busy} onPress={() => { select(); setConfirm({ type: 'dept', dept }); }}>
                      <Feather name="trash-2" size={13} color={colors.danger} style={{ marginRight: 6 }} />
                      <Text style={styles.deleteDeptText}>Hapus divisi dari Shift Kerja</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <ConfirmDialog
        visible={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c?.type === 'shift') removeShift(c.shift);
          else if (c?.type === 'dept') removeDept(c.dept);
        }}
        title={confirm?.type === 'dept' ? 'Hapus divisi dari Shift Kerja?' : 'Hapus jam shift?'}
        message={
          confirm?.type === 'dept'
            ? 'Semua jam shift divisi ' + confirm.dept + ' akan dihapus dan karyawannya kembali ke jam kantor. Karyawan divisi lain yang memakai shift ini juga kembali ke jam kantor.'
            : confirm?.type === 'shift'
            ? confirm.shift.name + ' (' + confirm.shift.startTime + ' - ' + confirm.shift.endTime + ') akan dihapus. Karyawan yang memakai shift ini kembali ke shift tetap atau jam kantor.'
            : ''
        }
        confirmText="Hapus"
        icon="trash-2"
        variant="danger"
      />
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
  pickBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12 },
  emptyBox: { alignItems: 'center', gap: 6, paddingVertical: 24, paddingHorizontal: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md },
  emptyTitle: { fontSize: fontSize.sm, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  formBox: { gap: 4, marginTop: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingVertical: 10, marginTop: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' },
  secondaryBtnText: { fontWeight: '700', fontSize: fontSize.sm, color: colors.ink },
  deleteDeptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.dangerSoft, backgroundColor: '#FFFFFF' },
  deleteDeptText: { color: colors.danger, fontWeight: '700', fontSize: fontSize.xs },
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
