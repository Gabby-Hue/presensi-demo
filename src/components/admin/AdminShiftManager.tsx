import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { UserProfile, WorkShift } from '../../types/attendance';
import { AttendanceService } from '../../services/attendanceService';
import { Card } from '../ui/Card';
import { colors, fontSize, radius } from '../../theme';
import { select, succeed, fail } from '../../services/feedbackService';

interface Props {
  currentAdmin: UserProfile;
  users: UserProfile[];
  onChanged: () => void;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const emptyForm = { name: '', start: '07:00', end: '15:00', late: '07:15' };

/**
 * Shift per departemen (opsional). Departemen tanpa shift (mis. HRD, Accounting) tetap ikut jam kantor.
 * Tiap karyawan dipasang ke satu shift tetap — tidak ada rotasi.
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
    if (form.end <= form.start) return setFormError('Jam pulang harus setelah jam masuk (shift lewat tengah malam belum didukung).');
    if (form.late < form.start || form.late >= form.end) return setFormError('Batas terlambat harus di antara jam masuk dan jam pulang.');
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

  return (
    <Card title="Shift Kerja per Departemen" subtitle="Opsional. Departemen tanpa shift tetap memakai jam kantor." icon="clock">
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
                            {s.startTime} - {s.endTime} WIB · telat setelah {s.lateDeadline}
                          </Text>
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

                    {deptShifts.length > 0 && (
                      <>
                        <Text style={[styles.label, { marginTop: 12 }]}>Shift tetap tiap karyawan</Text>
                        {staff.length === 0 ? (
                          <Text style={styles.deptSub}>Belum ada karyawan di departemen ini.</Text>
                        ) : (
                          staff.map((u) => {
                            const cur = shiftOf(u);
                            return (
                              <View key={u.id} style={styles.staffRow}>
                                <Text style={styles.staffName} numberOfLines={1}>{u.fullName}</Text>
                                <View style={styles.chips}>
                                  {[{ id: null as string | null, name: 'Jam kantor' }, ...deptShifts].map((s) => {
                                    const on = cur === s.id;
                                    return (
                                      <TouchableOpacity key={s.id || 'none'} onPress={() => assign(u, s.id)}
                                        style={[styles.chip, on && styles.chipOn]} accessibilityState={{ selected: on }}>
                                        <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>{s.name}</Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
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
  staffRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 6 },
  staffName: { flexBasis: 140, flexGrow: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.ink },
});
