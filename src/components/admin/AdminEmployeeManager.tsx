import React, { useEffect, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { UserProfile } from '../../types/attendance';
import { AttendanceService } from '../../services/attendanceService';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DepartmentDropdown } from '../ui/DepartmentDropdown';
import { Feather } from '@expo/vector-icons';
import { colors, fontSize, radius } from '../../theme';
import { select, succeed, fail } from '../../services/feedbackService';
import { DEFAULT_LEAVE_QUOTA } from '../../utils/payroll';
import { addMinutes } from '../../utils/time';
import { SelectDropdown } from '../ui/SelectDropdown';
import { WorkShift } from '../../types/attendance';

// Lama kerja khusus (menit). Kosong = ikut jam pulang shift / jam kantor.
const WORK_OPTIONS = [
  { value: '', label: 'Ikut shift / jam kantor' },
  ...[6, 7, 8, 9, 10, 11, 12].map((h) => ({ value: String(h * 60), label: h + ' jam' })),
];

interface AdminEmployeeManagerProps {
  currentAdmin: UserProfile;
  users: UserProfile[];
  onChanged: () => void;
  onSelectEmployee?: (u: UserProfile) => void;
}

export const AdminEmployeeManager: React.FC<AdminEmployeeManagerProps> = ({
  currentAdmin,
  users,
  onChanged,
  onSelectEmployee,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    AttendanceService.getDepartments(currentAdmin.companyId || undefined).then((list) => {
      if (list && list.length > 0) setDepartments(list);
    });
  }, [currentAdmin.companyId, users]);

  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editQuota, setEditQuota] = useState('');
  // Shift & lama kerja khusus (string kosong = tanpa shift / ikut default)
  const [editShift, setEditShift] = useState('');
  const [editWork, setEditWork] = useState('');
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [query, setQuery] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [userToResetDevice, setUserToResetDevice] = useState<UserProfile | null>(null);
  const [feedbackModal, setFeedbackModal] = useState<{
    title: string;
    message: string;
    variant: 'primary' | 'danger';
  } | null>(null);

  const toggleRevealPassword = (userId: string) => {
    select();
    setRevealedPasswords((prev) => ({ ...prev, [userId]: !prev[userId] }));
  };

  const handleCreateAccount = async () => {
    setFormError(null);
    if (!fullName.trim() || !email.trim() || !password) {
      setFormError('Lengkapi nama, email, dan kata sandi dulu.');
      return;
    }
    if (password.length < 6) {
      setFormError('Kata sandi minimal 6 karakter.');
      return;
    }
    setLoading(true);
    const { success, message } = await AttendanceService.createEmployeeAccount({
      email,
      password,
      fullName: fullName.trim(),
      department: department.trim() || 'None',
      role: 'employee',
      companyId: currentAdmin.companyId ?? null,
      createdBy: currentAdmin.id,
    });
    setLoading(false);
    if (!success) {
      fail();
      setFormError(message);
      return;
    }
    succeed();
    setFullName('');
    setEmail('');
    setPassword('');
    setDepartment('');
    setFeedbackModal({
      title: 'Berhasil',
      message,
      variant: 'primary',
    });
    onChanged();
  };

  useEffect(() => {
    AttendanceService.getShifts(currentAdmin.companyId || undefined)
      .then(setShifts)
      .catch(() => setShifts([]));
  }, [currentAdmin.companyId]);

  const shiftById = (id?: string | null) => shifts.find((s) => s.id === id) || null;

  const openEdit = (item: UserProfile) => {
    select();
    setEditing(item);
    setEditName(item.fullName);
    setEditDept(item.department || '');
    setEditPassword('');
    setEditQuota(String(item.leaveQuota ?? DEFAULT_LEAVE_QUOTA));
    setEditShift(item.shiftId || '');
    setEditWork(item.workMinutes ? String(item.workMinutes) : '');
    setShowEditPassword(false);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setEditError(null);
    if (!editName.trim()) {
      setEditError('Nama tidak boleh kosong.');
      return;
    }
    if (editPassword && editPassword.length < 6) {
      setEditError('Kata sandi baru minimal 6 karakter.');
      return;
    }
    const quota = Number(editQuota.trim());
    if (!/^\d{1,3}$/.test(editQuota.trim()) || quota > 365) {
      setEditError('Kuota cuti harus angka 0 sampai 365 hari.');
      return;
    }
    setEditSaving(true);
    const { success, message } = await AttendanceService.updateEmployeeAccount({
      id: editing.id,
      fullName: editName.trim(),
      department: editDept.trim() || 'None',
      password: editPassword.trim() || undefined,
      leaveQuota: quota,
    });
    if (success) {
      try {
        // shift hanya milik divisi baru; pindah divisi melepas shift lama
        const keepShift = shiftById(editShift)?.department === (editDept.trim() || 'None') ? editShift : '';
        if ((editing.shiftId || '') !== keepShift) await AttendanceService.setUserShift(editing.id, keepShift || null);
        const wm = editWork ? Number(editWork) : null;
        if ((editing.workMinutes ?? null) !== wm) await AttendanceService.setUserWorkMinutes(editing.id, wm);
      } catch (e: any) {
        setEditSaving(false);
        fail();
        setEditError('Data akun tersimpan, tetapi shift/lama kerja gagal disimpan: ' + (e?.message || e));
        onChanged();
        return;
      }
    }
    setEditSaving(false);
    if (!success) {
      fail();
      setEditError(message);
      return;
    }
    succeed();
    setEditing(null);
    setEditPassword('');
    setFeedbackModal({
      title: 'Berhasil',
      message,
      variant: 'primary',
    });
    onChanged();
  };

  const handleResetDevice = (item: UserProfile) => {
    select();
    setUserToResetDevice(item);
  };

  const confirmResetDevice = async () => {
    if (!userToResetDevice) return;
    const target = userToResetDevice;
    setUserToResetDevice(null);
    setResettingId(target.id);
    const { success, message } = await AttendanceService.resetEmployeeDevice(target.id);
    setResettingId(null);
    if (success) {
      succeed();
      onChanged();
    } else {
      fail();
    }
    setFeedbackModal({
      title: success ? 'Berhasil' : 'Gagal',
      message,
      variant: success ? 'primary' : 'danger',
    });
  };

  const handleDelete = (item: UserProfile) => {
    select();
    setUserToDelete(item);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    const target = userToDelete;
    setUserToDelete(null);
    setDeletingId(target.id);
    const { success, message } = await AttendanceService.deleteEmployeeAccount(target.id);
    setDeletingId(null);
    if (success) {
      succeed();
      onChanged();
    } else {
      fail();
    }
    setFeedbackModal({
      title: success ? 'Berhasil' : 'Gagal',
      message,
      variant: success ? 'primary' : 'danger',
    });
  };

  const employees = users.filter((u) => u.role === 'employee');
  const q = query.trim().toLowerCase();
  const shown = q
    ? employees.filter((u) => [u.fullName, u.email, u.department].some((v) => (v || '').toLowerCase().includes(q)))
    : employees;

  const shiftInfo = (u: UserProfile) => {
    const s = shiftById(u.shiftId);
    const end = s ? (u.workMinutes ? addMinutes(s.startTime, u.workMinutes) : s.endTime) : null;
    const parts = [s ? s.name + ' ' + s.startTime + '-' + end : 'Jam kantor'];
    if (u.workMinutes) parts.push(u.workMinutes / 60 + ' jam');
    return parts.join(' · ');
  };

  return (
    <View style={styles.container}>
      <Card
        title="Tambah akun karyawan"
        subtitle="Akun tercatat sebagai buatan Anda"
        icon="user-plus"
      >
        {formError && (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={18} color={colors.danger} style={{ marginRight: 8 }} />
            <Text style={styles.errorText}>{formError}</Text>
          </View>
        )}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Nama lengkap</Text>
          <TextInput
            style={styles.input}
            placeholder="Contoh: Budi Pratama"
            placeholderTextColor={colors.faint}
            value={fullName}
            onChangeText={setFullName}
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Departemen</Text>
          <DepartmentDropdown
            value={department}
            onChange={setDepartment}
            departments={departments}
            onDepartmentsChange={setDepartments}
            placeholder="Pilih departemen karyawan"
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="Contoh: budi@instansi.go.id"
            placeholderTextColor={colors.faint}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Kata sandi</Text>
          <View style={styles.createPasswordRow}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Minimal 6 karakter"
              placeholderTextColor={colors.faint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.createEyeBtn} hitSlop={12}>
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={20} color={colors.muted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Perangkat terkunci otomatis saat karyawan pertama kali login dari HP-nya.</Text>
        </View>
        <Button
          title={loading ? 'Mendaftarkan...' : 'Daftarkan akun'}
          icon="user-check"
          loading={loading}
          onPress={handleCreateAccount}
          style={{ marginTop: 6 }}
        />
      </Card>

      <Card
        title={`Daftar Karyawan (${employees.length})`}
        subtitle="Kelola data, reset kunci perangkat, atau hapus akun"
        icon="users"
      >
        {employees.length > 0 && (
          <View style={styles.searchBox}>
            <Feather name="search" size={15} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Cari nama, email, atau departemen"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Cari karyawan"
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Hapus pencarian">
                <Feather name="x" size={15} color={colors.muted} />
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        {employees.length === 0 ? (
          <Text style={styles.emptyText}>Belum ada akun karyawan.</Text>
        ) : shown.length === 0 ? (
          <Text style={styles.emptyText}>Tidak ada karyawan yang cocok dengan "{query}".</Text>
        ) : (
          shown.map((item) => (
            <View key={item.id} style={styles.userRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.fullName.substring(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{item.fullName}</Text>
                <Text style={styles.userEmail}>{item.email}</Text>
                <Text style={styles.userEmail}>{item.department || 'Staff'}</Text>
                <View style={styles.shiftTag}>
                  <Feather name="clock" size={11} color={colors.primaryDark} />
                  <Text style={styles.shiftTagText}>{shiftInfo(item)}</Text>
                </View>
                <View style={styles.passwordRow}>
                  <Text style={styles.passwordLabel}>Sandi: </Text>
                  <Text style={styles.passwordVal}>
                    {revealedPasswords[item.id] ? (item.plainPassword || '123456') : '••••••••'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => toggleRevealPassword(item.id)}
                    hitSlop={8}
                    style={{ marginLeft: 6 }}
                  >
                    <Feather
                      name={revealedPasswords[item.id] ? 'eye-off' : 'eye'}
                      size={14}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                </View>
                <Text style={styles.deviceText}>
                  {item.deviceModel || item.deviceId
                    ? `Terkunci: ${item.deviceModel || item.deviceId}`
                    : 'Belum ada perangkat terkunci'}
                </Text>
              </View>
              <View style={styles.userActions}>
              <TouchableOpacity
                onPress={() => {
                  select();
                  onSelectEmployee?.(item);
                }}
                style={styles.iconBtn}
                hitSlop={12}
              >
                <Feather name="calendar" size={18} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleResetDevice(item)}
                style={styles.iconBtn}
                hitSlop={12}
                disabled={resettingId === item.id || (!item.deviceId && !item.deviceModel)}
              >
                <Feather
                  name="smartphone"
                  size={18}
                  color={resettingId === item.id || (!item.deviceId && !item.deviceModel) ? colors.faint : colors.primary}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openEdit(item)} style={styles.iconBtn} hitSlop={12}>
                <Feather name="edit-2" size={18} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(item)} style={styles.iconBtn} hitSlop={12} disabled={deletingId === item.id}>
                <Feather name="trash-2" size={18} color={deletingId === item.id ? colors.faint : colors.danger} />
              </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </Card>

      <Modal visible={!!editing} onClose={() => setEditing(null)} title="Ubah data karyawan">
        {editError && (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={18} color={colors.danger} style={{ marginRight: 8 }} />
            <Text style={styles.errorText}>{editError}</Text>
          </View>
        )}
        <Text style={styles.label}>Nama lengkap</Text>
        <TextInput
          style={styles.input}
          value={editName}
          onChangeText={setEditName}
          placeholder="Nama lengkap"
          placeholderTextColor={colors.faint}
        />
        <Text style={[styles.label, { marginTop: 12 }]}>Departemen</Text>
        <DepartmentDropdown
          value={editDept}
          onChange={setEditDept}
          departments={departments}
          onDepartmentsChange={setDepartments}
          placeholder="Pilih departemen"
        />
        <Text style={[styles.label, { marginTop: 12 }]}>Shift kerja</Text>
        <SelectDropdown
          options={[
            { value: '', label: 'Tanpa shift (jam kantor)' },
            ...shifts
              .filter((s) => s.department === (editDept.trim() || 'None'))
              .map((s) => ({ value: s.id, label: s.name + ' ' + s.startTime + '-' + s.endTime })),
          ]}
          value={shiftById(editShift)?.department === (editDept.trim() || 'None') ? editShift : ''}
          onChange={setEditShift}
          icon="clock"
          placeholder="Tanpa shift (jam kantor)"
          accessibilityLabel="Shift kerja"
        />
        <Text style={styles.hint}>Hanya shift milik divisi karyawan. Buat jam shift baru di menu Shift Kerja.</Text>

        <Text style={[styles.label, { marginTop: 12 }]}>Lama kerja</Text>
        <SelectDropdown
          options={WORK_OPTIONS}
          value={editWork}
          onChange={setEditWork}
          icon="watch"
          accessibilityLabel="Lama kerja"
        />
        <Text style={styles.hint}>
          {editWork
            ? 'Jam masuk & batas telat tetap, jam pulang = jam masuk + ' + Number(editWork) / 60 + ' jam' +
              (shiftById(editShift) ? ' (pulang ' + addMinutes(shiftById(editShift)!.startTime, Number(editWork)) + ').' : '.')
            : 'Mengikuti jam pulang shift / jam kantor.'}
        </Text>

        <Text style={[styles.label, { marginTop: 12 }]}>Kuota cuti per tahun (hari)</Text>
        <TextInput
          style={styles.input}
          value={editQuota}
          onChangeText={(t) => setEditQuota(t.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          maxLength={3}
          placeholder={String(DEFAULT_LEAVE_QUOTA)}
          placeholderTextColor={colors.faint}
          accessibilityLabel="Kuota cuti per tahun"
        />
        <Text style={styles.hint}>Izin (bukan sakit) memotong kuota. Setengah hari = 0,5 hari.</Text>
        <Text style={[styles.label, { marginTop: 12 }]}>Ganti Kata Sandi (Opsional)</Text>
        <View style={styles.passwordWrap}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={editPassword}
            onChangeText={setEditPassword}
            placeholder="Biarkan kosong jika tidak diubah"
            placeholderTextColor={colors.faint}
            secureTextEntry={!showEditPassword}
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowEditPassword(!showEditPassword)}
            hitSlop={8}
          >
            <Feather name={showEditPassword ? 'eye-off' : 'eye'} size={18} color={colors.muted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Minimal 6 karakter jika ingin mengganti sandi karyawan ini.</Text>
        <Button
          title={editSaving ? 'Menyimpan...' : 'Simpan perubahan'}
          icon="check"
          loading={editSaving}
          onPress={handleSaveEdit}
          style={{ marginTop: 16 }}
        />
      </Modal>

      {/* Dialog Konfirmasi Hapus Akun Karyawan */}
      <ConfirmDialog
        visible={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={confirmDelete}
        title="Hapus Akun Karyawan?"
        message={`Akun "${userToDelete?.fullName}" (${userToDelete?.email}) akan dihapus permanen beserta seluruh riwayat presensinya. Lanjutkan?`}
        confirmText="Ya, Hapus"
        cancelText="Batal"
        icon="trash-2"
        variant="danger"
      />

      {/* Dialog Konfirmasi Buka Kunci Perangkat */}
      <ConfirmDialog
        visible={!!userToResetDevice}
        onClose={() => setUserToResetDevice(null)}
        onConfirm={confirmResetDevice}
        title="Buka Kunci Perangkat?"
        message={`Karyawan "${userToResetDevice?.fullName}" akan bisa login dari HP baru. HP baru itu otomatis tersimpan sebagai perangkat resminya.`}
        confirmText="Buka Kunci"
        cancelText="Batal"
        icon="smartphone"
        variant="primary"
      />

      {/* Dialog Notifikasi Berhasil / Gagal */}
      <ConfirmDialog
        visible={!!feedbackModal}
        onClose={() => setFeedbackModal(null)}
        onConfirm={() => setFeedbackModal(null)}
        title={feedbackModal?.title || ''}
        message={feedbackModal?.message || ''}
        confirmText="Tutup"
        singleButton={true}
        icon={feedbackModal?.variant === 'primary' ? 'check-circle' : 'alert-circle'}
        variant={feedbackModal?.variant || 'primary'}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  departmentPicker: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  departmentOption: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: colors.surface },
  departmentOptionActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  departmentOptionText: { color: colors.muted, fontWeight: '600' },
  departmentOptionTextActive: { color: colors.primaryDark },
  container: {
    paddingBottom: 20,
  },
  formGroup: {
    marginBottom: 12,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
    lineHeight: 18,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    color: colors.ink,
    minHeight: 56,
  },
  createPasswordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingRight: 4,
    minHeight: 56,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 12,
    fontSize: fontSize.sm,
    color: colors.ink,
  },
  createEyeBtn: {
    padding: 10,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.danger,
    fontWeight: '700',
    lineHeight: 20,
  },
  emptyText: {
    fontSize: fontSize.xs,
    color: colors.faint,
    textAlign: 'center',
    paddingVertical: 16,
  },
  userInfo: { flex: 1, minWidth: 170 },
  userActions: { flexDirection: 'row', marginLeft: 'auto' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 10, marginBottom: 10, backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: fontSize.sm, color: colors.ink },
  shiftTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 4,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.primarySoft,
  },
  shiftTagText: { fontSize: 11, fontWeight: '600', color: colors.primaryDark },
  userRow: {
    flexWrap: 'wrap',
    rowGap: 6,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 13,
  },
  userName: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  userEmail: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  passwordLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  passwordVal: {
    fontSize: 12,
    color: colors.ink,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deviceText: {
    fontSize: 11,
    color: colors.primaryDark,
    fontWeight: '700',
    marginTop: 2,
  },
  deptBadge: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  deptText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.muted,
  },
  iconBtn: {
    padding: 10,
  },
});
