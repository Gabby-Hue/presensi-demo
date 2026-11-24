import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { DepartmentItem, UserProfile } from '../../types/attendance';
import { AttendanceService } from '../../services/attendanceService';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SelectDropdown } from '../ui/SelectDropdown';
import { Feather } from '@expo/vector-icons';
import { colors, fontSize, radius } from '../../theme';
import { select, succeed, fail } from '../../services/feedbackService';

interface AdminDepartmentManagerProps {
  currentAdmin: UserProfile;
  users: UserProfile[];
  onChanged: () => void;
}

export const AdminDepartmentManager: React.FC<AdminDepartmentManagerProps> = ({
  currentAdmin,
  users,
  onChanged,
}) => {
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDeptName, setNewDeptName] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit (Rename) Modal State
  const [editingDept, setEditingDept] = useState<DepartmentItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Reassign Modal State
  const [reassignSource, setReassignSource] = useState<DepartmentItem | null>(null);
  const [reassignTarget, setReassignTarget] = useState<string>('');
  // Karyawan yang dicentang untuk dipindah + kata kunci pencarian
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  // Pencarian & departemen yang dibuka untuk melihat anggotanya
  const [deptQuery, setDeptQuery] = useState('');
  const [openDeptId, setOpenDeptId] = useState<string | null>(null);
  const [staffQuery, setStaffQuery] = useState('');
  const [reassigning, setReassigning] = useState(false);

  // Delete State
  const [deletingDept, setDeletingDept] = useState<DepartmentItem | null>(null);
  const [deleteMode, setDeleteMode] = useState<'unassign' | 'reassign'>('unassign');
  const [deleteFallbackDept, setDeleteFallbackDept] = useState<string>('');
  const [deleting, setDeleting] = useState(false);

  // Feedback Notification Modal
  const [feedbackDialog, setFeedbackDialog] = useState<{
    title: string;
    message: string;
    variant: 'primary' | 'danger';
  } | null>(null);

  const fetchDepartments = async () => {
    setLoading(true);
    const list = await AttendanceService.getDepartmentItems(currentAdmin.companyId || undefined);
    setDepartments(list);
    setLoading(false);
  };

  useEffect(() => {
    fetchDepartments();
  }, [currentAdmin.companyId, users]);

  const handleAddDepartment = async () => {
    const trimmed = newDeptName.trim();
    if (!trimmed) {
      setFeedbackDialog({
        title: 'Nama Kosong',
        message: 'Ketik nama departemen baru terlebih dahulu.',
        variant: 'danger',
      });
      return;
    }
    setAdding(true);
    const res = await AttendanceService.addDepartment(trimmed, currentAdmin.companyId || undefined);
    setAdding(false);
    if (!res.success) {
      fail();
      setFeedbackDialog({
        title: 'Gagal Menambah',
        message: res.message,
        variant: 'danger',
      });
      return;
    }
    succeed();
    setNewDeptName('');
    setFeedbackDialog({
      title: 'Berhasil',
      message: res.message,
      variant: 'primary',
    });
    await fetchDepartments();
    onChanged();
  };

  const openRename = (dept: DepartmentItem) => {
    select();
    setEditingDept(dept);
    setRenameValue(dept.name);
  };

  const handleSaveRename = async () => {
    if (!editingDept) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setFeedbackDialog({
        title: 'Nama Kosong',
        message: 'Nama departemen tidak boleh kosong.',
        variant: 'danger',
      });
      return;
    }
    if (trimmed.toLowerCase() === editingDept.name.toLowerCase()) {
      setEditingDept(null);
      return;
    }
    setRenaming(true);
    const res = await AttendanceService.updateDepartment(editingDept.id, trimmed);
    setRenaming(false);
    if (!res.success) {
      fail();
      setFeedbackDialog({
        title: 'Gagal Mengubah Nama',
        message: res.message,
        variant: 'danger',
      });
      return;
    }
    succeed();
    setEditingDept(null);
    setFeedbackDialog({
      title: 'Berhasil',
      message: res.message,
      variant: 'primary',
    });
    await fetchDepartments();
    onChanged();
  };

  const sourceEmployees = useMemo(() => {
    if (!reassignSource) return [];
    return users.filter(
      (u) =>
        u.role === 'employee' &&
        u.department?.trim().toLowerCase() === reassignSource.name.trim().toLowerCase()
    );
  }, [reassignSource, users]);

  const openReassign = (dept: DepartmentItem) => {
    select();
    setReassignSource(dept);
    const targets = departments.filter((d) => d.id !== dept.id);
    setReassignTarget(targets[0]?.name || '');

    const sourceStaff = users.filter(
      (u) =>
        u.role === 'employee' &&
        u.department?.trim().toLowerCase() === dept.name.trim().toLowerCase()
    );
    // 1 karyawan: langsung tercentang. Lebih dari 1: admin memilih sendiri.
    setPickedIds(sourceStaff.length === 1 ? [String(sourceStaff[0].id)] : []);
    setStaffQuery('');
  };

  const handleConfirmReassign = async () => {
    if (!reassignSource || !reassignTarget) return;

    const picked = sourceEmployees.filter((u) => pickedIds.includes(String(u.id)));
    if (picked.length === 0) {
      setFeedbackDialog({
        title: 'Karyawan Belum Dipilih',
        message: 'Centang minimal satu karyawan yang ingin dipindahkan.',
        variant: 'danger',
      });
      return;
    }

    if (picked.length < sourceEmployees.length) {
      setReassigning(true);
      const failed: string[] = [];
      for (const staff of picked) {
        const res = await AttendanceService.updateEmployeeAccount({
          id: String(staff.id),
          fullName: staff.fullName,
          department: reassignTarget,
        });
        if (!res.success) failed.push(staff.fullName);
      }
      setReassigning(false);
      const moved = picked.length - failed.length;
      if (failed.length) fail();
      else succeed();
      setReassignSource(null);
      setFeedbackDialog({
        title: failed.length ? 'Sebagian Gagal Dipindahkan' : 'Karyawan Berhasil Dipindahkan',
        message:
          (moved ? moved + ' karyawan dipindahkan ke departemen "' + reassignTarget + '".' : '') +
          (failed.length ? ' Gagal: ' + failed.join(', ') + '.' : ''),
        variant: failed.length ? 'danger' : 'primary',
      });
      await fetchDepartments();
      onChanged();
      return;
    }

    setReassigning(true);
    const res = await AttendanceService.reassignDepartment(
      reassignSource.name,
      reassignTarget,
      currentAdmin.companyId || undefined
    );
    setReassigning(false);
    if (!res.success) {
      fail();
      setFeedbackDialog({
        title: 'Gagal Memindahkan',
        message: res.message,
        variant: 'danger',
      });
      return;
    }
    succeed();
    setReassignSource(null);
    setFeedbackDialog({
      title: 'Karyawan Berhasil Dipindahkan',
      message: res.message,
      variant: 'primary',
    });
    await fetchDepartments();
    onChanged();
  };

  const openDelete = (dept: DepartmentItem) => {
    select();
    setDeletingDept(dept);
    const availableTargets = departments.filter((d) => d.id !== dept.id);
    setDeleteFallbackDept(availableTargets[0]?.name || '');
    setDeleteMode('unassign');
  };

  const handleConfirmDelete = async () => {
    const target = deletingDept;
    if (!target) return;
    setDeleting(true);
    const res = await AttendanceService.deleteDepartment(target.id, {
      action: target.employeeCount > 0 ? deleteMode : 'unassign',
      reassignTo: deleteMode === 'reassign' && target.employeeCount > 0 ? deleteFallbackDept : undefined,
    });
    setDeleting(false);
    setDeletingDept(null);
    if (!res.success) {
      fail();
      setFeedbackDialog({
        title: 'Gagal Menghapus',
        message: res.message,
        variant: 'danger',
      });
      return;
    }
    succeed();
    setFeedbackDialog({
      title: 'Departemen Dihapus',
      message: res.message,
      variant: 'primary',
    });
    await fetchDepartments();
    onChanged();
  };

  const otherDepartmentsForReassign = reassignSource
    ? departments.filter((d) => d.id !== reassignSource.id)
    : [];

  const otherDepartmentsForDelete = deletingDept
    ? departments.filter((d) => d.id !== deletingDept.id)
    : [];

  return (
    <View style={styles.container}>
      {/* 1. KARTU HEADER & FORM TAMBAH DEPARTEMEN */}
      <Card
        title="Pengaturan Departemen"
        subtitle={`Kelola struktur departemen di ${currentAdmin.companyName || 'Cabang Anda'}`}
        icon="grid"
      >
        <Text style={styles.headerNotice}>
          Struktur departemen standar awal cabang: <Text style={styles.headerNoticeBold}>HR, Engineering, dan Sales</Text>. Anda dapat menambah departemen baru, mengubah nama, memindahkan karyawan, atau menghapus departemen yang sudah tidak digunakan.
        </Text>

        <View style={styles.addFormRow}>
          <TextInput
            style={styles.addInput}
            value={newDeptName}
            onChangeText={setNewDeptName}
            placeholder="Ketik nama departemen baru (contoh: Marketing, Finance)..."
            placeholderTextColor={colors.faint}
            onSubmitEditing={handleAddDepartment}
          />
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleAddDepartment}
            disabled={adding}
            style={styles.addBtn}
          >
            {adding ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Feather name="plus" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.addBtnText}>Tambah</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Card>

      {/* 2. DAFTAR DEPARTEMEN AKTIF */}
      <Card
        title={`Daftar Departemen (${departments.length})`}
        subtitle="Daftar divisi dan jumlah karyawan yang terdaftar"
        icon="layers"
      >
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Memuat departemen...</Text>
          </View>
        ) : departments.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="folder" size={28} color={colors.faint} style={{ marginBottom: 6 }} />
            <Text style={styles.emptyText}>Belum ada departemen yang terdaftar.</Text>
          </View>
        ) : (
          <>
          <View style={[styles.searchBox, { marginBottom: 10 }]}>
            <Feather name="search" size={15} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              value={deptQuery}
              onChangeText={setDeptQuery}
              placeholder="Cari departemen atau nama karyawan"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Cari departemen"
            />
            {deptQuery ? (
              <TouchableOpacity onPress={() => setDeptQuery('')} hitSlop={8} accessibilityLabel="Hapus pencarian">
                <Feather name="x" size={15} color={colors.muted} />
              </TouchableOpacity>
            ) : null}
          </View>
          {(() => {
            const q = deptQuery.trim().toLowerCase();
            const membersOf = (name: string) =>
              users.filter((u) => u.role === 'employee' && (u.department || '').trim().toLowerCase() === name.trim().toLowerCase());
            const list = q
              ? departments.filter(
                  (d) => d.name.toLowerCase().includes(q) || membersOf(d.name).some((u) => u.fullName.toLowerCase().includes(q))
                )
              : departments;
            if (list.length === 0) return <Text style={styles.emptyText}>Tidak ada departemen yang cocok dengan "{deptQuery}".</Text>;
            return list.map((dept) => {
            const hasEmployees = dept.employeeCount > 0;
            // saat mencari nama karyawan, buka departemennya otomatis
            const matchByMember = !!q && !dept.name.toLowerCase().includes(q);
            const isOpen = openDeptId === dept.id || matchByMember;
            const members = membersOf(dept.name);
            return (
              <View key={dept.id} style={styles.deptBlock}>
              <View style={styles.deptRow}>
                <View style={styles.deptIconBadge}>
                  <Feather name="briefcase" size={18} color={colors.primary} />
                </View>

                <TouchableOpacity
                  style={{ flex: 1 }}
                  activeOpacity={0.7}
                  onPress={() => {
                    select();
                    setOpenDeptId(isOpen ? null : dept.id);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={'Lihat anggota ' + dept.name}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.deptName}>{dept.name}</Text>
                    <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color={colors.muted} />
                  </View>
                  <View style={styles.deptMetaRow}>
                    <View
                      style={[
                        styles.empCountBadge,
                        hasEmployees ? styles.empCountBadgeActive : styles.empCountBadgeEmpty,
                      ]}
                    >
                      <Feather
                        name="users"
                        size={11}
                        color={hasEmployees ? colors.primaryDark : colors.muted}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.empCountText,
                          hasEmployees ? styles.empCountTextActive : styles.empCountTextEmpty,
                        ]}
                      >
                        {hasEmployees ? `${dept.employeeCount} Karyawan` : '0 Karyawan'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>

                <View style={styles.actionsRow}>
                  {/* Tombol Reassign Karyawan */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => openReassign(dept)}
                    disabled={!hasEmployees}
                    style={[styles.actionBtn, !hasEmployees && styles.actionBtnDisabled]}
                    hitSlop={8}
                    accessibilityLabel="Pindahkan Karyawan"
                  >
                    <Feather
                      name="repeat"
                      size={15}
                      color={hasEmployees ? colors.primary : colors.faint}
                    />
                  </TouchableOpacity>

                  {/* Tombol Rename */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => openRename(dept)}
                    style={styles.actionBtn}
                    hitSlop={8}
                    accessibilityLabel="Ubah Nama Departemen"
                  >
                    <Feather name="edit-2" size={15} color={colors.primary} />
                  </TouchableOpacity>

                  {/* Tombol Hapus */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => openDelete(dept)}
                    style={styles.actionBtnDanger}
                    hitSlop={8}
                    accessibilityLabel="Hapus Departemen"
                  >
                    <Feather name="trash-2" size={15} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
              {isOpen && (
                <View style={styles.memberList}>
                  {members.length === 0 ? (
                    <Text style={styles.memberEmpty}>Belum ada karyawan di departemen ini.</Text>
                  ) : (
                    members
                      .slice()
                      .sort((a, b) => a.fullName.localeCompare(b.fullName))
                      .map((u) => {
                        const hit = !!q && u.fullName.toLowerCase().includes(q);
                        return (
                          <View key={u.id} style={[styles.memberRow, hit && styles.memberRowHit]}>
                            <View style={styles.memberAvatar}>
                              <Text style={styles.memberAvatarText}>{u.fullName.substring(0, 2).toUpperCase()}</Text>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={styles.memberName} numberOfLines={1}>{u.fullName}</Text>
                              <Text style={styles.memberEmail} numberOfLines={1}>{u.email}</Text>
                            </View>
                          </View>
                        );
                      })
                  )}
                </View>
              )}
              </View>
            );
          });
          })()}
          </>
        )}
      </Card>

      {/* 3. MODAL UBAH NAMA (RENAME) */}
      <Modal
        visible={!!editingDept}
        onClose={() => setEditingDept(null)}
        title={`Ubah Nama: ${editingDept?.name || ''}`}
      >
        <Text style={styles.modalLabel}>Nama Departemen Baru</Text>
        <TextInput
          style={styles.modalInput}
          value={renameValue}
          onChangeText={setRenameValue}
          placeholder="Nama departemen"
          placeholderTextColor={colors.faint}
          autoFocus
        />
        <Text style={styles.modalHint}>
          Seluruh karyawan yang berada di departemen ini otomatis disesuaikan dengan nama baru.
        </Text>
        <View style={styles.modalBtnRow}>
          <Button
            title="Batal"
            variant="outline"
            onPress={() => setEditingDept(null)}
            style={{ flex: 1 }}
          />
          <Button
            title={renaming ? 'Menyimpan...' : 'Simpan Nama'}
            icon="check"
            loading={renaming}
            onPress={handleSaveRename}
            style={{ flex: 1.2 }}
          />
        </View>
      </Modal>

      {/* 4. MODAL REASSIGN (PINDAHKAN KARYAWAN) */}
      <Modal
        visible={!!reassignSource}
        onClose={() => setReassignSource(null)}
        title="Pindahkan Karyawan Departemen"
      >
        <View style={styles.reassignInfoBox}>
          <Feather name="info" size={18} color={colors.primary} style={{ marginRight: 8, marginTop: 2 }} />
          <Text style={styles.reassignInfoText}>
            Departemen <Text style={{ fontWeight: '700' }}>"{reassignSource?.name}"</Text> memiliki <Text style={{ fontWeight: '700' }}>{reassignSource?.employeeCount} karyawan</Text>. Anda dapat memindahkan salah satu karyawan saja atau seluruh divisi.
          </Text>
        </View>

        {/* 1. Pilih karyawan (centang, bisa beberapa) */}
        <View style={[styles.pickHeader, { marginTop: 14 }]}>
          <Text style={styles.modalLabel}>Pilih karyawan ({pickedIds.length}/{sourceEmployees.length})</Text>
          {sourceEmployees.length > 1 && (
            <TouchableOpacity
              hitSlop={8}
              onPress={() => {
                select();
                setPickedIds(pickedIds.length === sourceEmployees.length ? [] : sourceEmployees.map((u) => String(u.id)));
              }}
            >
              <Text style={styles.pickAllText}>
                {pickedIds.length === sourceEmployees.length ? 'Batal pilih semua' : 'Pilih semua'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {sourceEmployees.length === 0 ? (
          <Text style={{ fontSize: 12, color: colors.muted, fontStyle: 'italic', marginTop: 4 }}>
            Tidak ada data karyawan terdaftar di departemen ini.
          </Text>
        ) : (
          <>
            {sourceEmployees.length > 5 && (
              <View style={styles.searchBox}>
                <Feather name="search" size={15} color={colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  value={staffQuery}
                  onChangeText={setStaffQuery}
                  placeholder="Cari nama karyawan"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Cari nama karyawan"
                />
              </View>
            )}
            <View style={styles.pickList}>
              <ScrollView nestedScrollEnabled style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
                {sourceEmployees
                  .filter((emp) => emp.fullName.toLowerCase().includes(staffQuery.trim().toLowerCase()))
                  .map((emp) => {
                    const id = String(emp.id);
                    const on = pickedIds.includes(id);
                    return (
                      <TouchableOpacity
                        key={id}
                        activeOpacity={0.7}
                        onPress={() => {
                          select();
                          setPickedIds((p) => (on ? p.filter((x) => x !== id) : [...p, id]));
                        }}
                        style={[styles.pickRow, on && styles.pickRowOn]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                      >
                        <View style={[styles.checkbox, on && styles.checkboxOn]}>
                          {on && <Feather name="check" size={13} color="#FFFFFF" />}
                        </View>
                        <Text style={[styles.pickName, on && { color: colors.primaryDark }]} numberOfLines={1}>
                          {emp.fullName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
            </View>
          </>
        )}

        {/* 2. Tujuan */}
        <Text style={[styles.modalLabel, { marginTop: 14, marginBottom: 6 }]}>Pindahkan ke departemen</Text>
        {otherDepartmentsForReassign.length === 0 ? (
          <Text style={{ fontSize: 12, color: colors.muted, fontStyle: 'italic' }}>
            Belum ada departemen lain. Tambahkan departemen tujuan terlebih dahulu.
          </Text>
        ) : (
          <SelectDropdown
            options={otherDepartmentsForReassign.map((t) => ({ value: t.name, label: t.name + ' (' + t.employeeCount + ' orang)' }))}
            value={reassignTarget}
            onChange={setReassignTarget}
            icon="briefcase"
            placeholder="Pilih departemen tujuan"
            accessibilityLabel="Departemen tujuan"
          />
        )}

        {/* 3. Ringkasan */}
        {pickedIds.length > 0 && reassignTarget ? (
          <Text style={styles.reassignSummary}>
            {pickedIds.length} karyawan akan dipindah dari "{reassignSource?.name}" ke "{reassignTarget}".
          </Text>
        ) : null}

        <View style={styles.modalBtnRow}>
          <Button
            title="Batal"
            variant="outline"
            onPress={() => setReassignSource(null)}
            style={{ flex: 1 }}
          />
          <Button
            title={reassigning ? 'Memindahkan...' : 'Pindahkan ' + (pickedIds.length || '') + ' Karyawan'}
            icon="repeat"
            loading={reassigning}
            disabled={
              !reassignTarget ||
              otherDepartmentsForReassign.length === 0 ||
              pickedIds.length === 0
            }
            onPress={handleConfirmReassign}
            style={{ flex: 1.4 }}
          />
        </View>
      </Modal>

      {/* 5. MODAL HAPUS DEPARTEMEN DENGAN PILIHAN HYBRID (UNASSIGN / REASSIGN) */}
      {deletingDept && deletingDept.employeeCount > 0 && (
        <Modal
          visible={true}
          onClose={() => setDeletingDept(null)}
          title="Departemen Masih Berisi Karyawan"
        >
          <View style={styles.deleteWarnBox}>
            <Feather name="alert-triangle" size={20} color="#B45309" style={{ marginRight: 8, marginTop: 2 }} />
            <Text style={styles.deleteWarnText}>
              Departemen <Text style={{ fontWeight: '700' }}>"{deletingDept.name}"</Text> masih memiliki <Text style={{ fontWeight: '700' }}>{deletingDept.employeeCount} karyawan aktif</Text>.
            </Text>
          </View>

          <Text style={[styles.modalLabel, { marginTop: 14 }]}>
            Pilih tindakan untuk karyawan yang tersisa:
          </Text>

          {/* Opsi 1: Lepas Karyawan jadi Unassigned (Tanpa Departemen) */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              select();
              setDeleteMode('unassign');
            }}
            style={[styles.hybridOptionCard, deleteMode === 'unassign' && styles.hybridOptionCardActive]}
          >
            <View style={[styles.radioCircle, deleteMode === 'unassign' && styles.radioCircleActive]}>
              {deleteMode === 'unassign' && <View style={styles.radioInner} />}
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[styles.hybridOptionTitle, deleteMode === 'unassign' && styles.hybridOptionTitleActive]}>
                Lepas Menjadi Tanpa Departemen (Unassigned)
              </Text>
              <Text style={styles.hybridOptionSub}>
                Karyawan tetap aktif dan otomatis masuk kategori "Tanpa Departemen". Anda dapat mengatur ulang divisi mereka kapan saja.
              </Text>
            </View>
          </TouchableOpacity>

          {/* Opsi 2: Pindahkan Karyawan ke Departemen Lain (jika ada departemen lain) */}
          {otherDepartmentsForDelete.length > 0 ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                select();
                setDeleteMode('reassign');
              }}
              style={[styles.hybridOptionCard, deleteMode === 'reassign' && styles.hybridOptionCardActive]}
            >
              <View style={[styles.radioCircle, deleteMode === 'reassign' && styles.radioCircleActive]}>
                {deleteMode === 'reassign' && <View style={styles.radioInner} />}
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.hybridOptionTitle, deleteMode === 'reassign' && styles.hybridOptionTitleActive]}>
                  Pindahkan ke Departemen Lain
                </Text>
                <Text style={styles.hybridOptionSub}>
                  Alihkan seluruh karyawan langsung ke salah satu divisi berikut:
                </Text>
                {deleteMode === 'reassign' && (
                  <View style={[styles.chipGrid, { marginTop: 8 }]}>
                    {otherDepartmentsForDelete.map((target) => {
                      const isSelected = deleteFallbackDept === target.name;
                      return (
                        <TouchableOpacity
                          key={target.id}
                          activeOpacity={0.7}
                          onPress={() => {
                            select();
                            setDeleteFallbackDept(target.name);
                          }}
                          style={[styles.chipItem, isSelected && styles.chipItemActive]}
                        >
                          <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                            {target.name}
                          </Text>
                          {isSelected && (
                            <Feather name="check" size={13} color={colors.primaryDark} style={{ marginLeft: 6 }} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.noOtherDeptsNotice}>
              <Feather name="info" size={14} color={colors.muted} style={{ marginRight: 6 }} />
              <Text style={styles.noOtherDeptsText}>
                Tidak ada divisi lain di cabang ini. Karyawan akan otomatis dilepas menjadi Tanpa Departemen.
              </Text>
            </View>
          )}

          <View style={styles.modalBtnRow}>
            <Button
              title="Batal"
              variant="outline"
              onPress={() => setDeletingDept(null)}
              style={{ flex: 1 }}
            />
            <Button
              title={deleting ? 'Memproses...' : deleteMode === 'reassign' ? 'Pindahkan & Hapus' : 'Lepas & Hapus Departemen'}
              variant="danger"
              icon="trash-2"
              loading={deleting}
              disabled={deleteMode === 'reassign' && (!deleteFallbackDept || otherDepartmentsForDelete.length === 0)}
              onPress={handleConfirmDelete}
              style={{ flex: 1.5 }}
            />
          </View>
        </Modal>
      )}

      {/* 6. CONFIRM DIALOG HAPUS KOSONG (0 KARYAWAN) */}
      {deletingDept && deletingDept.employeeCount === 0 && (
        <ConfirmDialog
          visible={true}
          onClose={() => setDeletingDept(null)}
          onConfirm={handleConfirmDelete}
          title="Hapus Departemen?"
          message={`Apakah Anda yakin ingin menghapus departemen "${deletingDept.name}"? Departemen ini tidak memiliki karyawan.`}
          confirmText={deleting ? 'Menghapus...' : 'Ya, Hapus'}
          cancelText="Batal"
          icon="trash-2"
          variant="danger"
        />
      )}

      {/* 7. DIALOG FEEDBACK */}
      <ConfirmDialog
        visible={!!feedbackDialog}
        onClose={() => setFeedbackDialog(null)}
        onConfirm={() => setFeedbackDialog(null)}
        title={feedbackDialog?.title || ''}
        message={feedbackDialog?.message || ''}
        confirmText="Tutup"
        singleButton={true}
        icon={feedbackDialog?.variant === 'primary' ? 'check-circle' : 'alert-circle'}
        variant={feedbackDialog?.variant || 'primary'}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  deptBlock: {},
  memberList: { marginLeft: 46, marginBottom: 10, borderLeftWidth: 2, borderLeftColor: colors.primarySoft, paddingLeft: 10, gap: 2 },
  memberEmpty: { fontSize: fontSize.xs, color: colors.muted, fontStyle: 'italic', paddingVertical: 6 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 6, borderRadius: radius.sm },
  memberRowHit: { backgroundColor: colors.primarySoft },
  memberAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 10, fontWeight: '800', color: colors.primaryDark },
  memberName: { fontSize: fontSize.sm, fontWeight: '600', color: colors.ink },
  memberEmail: { fontSize: 11, color: colors.muted },
  pickHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  pickAllText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 10, marginBottom: 6, backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: fontSize.sm, color: colors.ink },
  pickList: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceSoft,
  },
  pickRowOn: { backgroundColor: colors.primarySoft },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pickName: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.ink },
  reassignSummary: {
    marginTop: 12, padding: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSoft,
    fontSize: fontSize.xs, color: colors.ink, fontWeight: '600',
  },
  container: {
    paddingBottom: 24,
  },
  headerNotice: {
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 18,
    marginBottom: 14,
  },
  headerNoticeBold: {
    fontWeight: '700',
    color: colors.ink,
  },
  addFormRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    rowGap: 8,
  },
  addInput: {
    flex: 1,
    minWidth: 160,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    color: colors.ink,
    minHeight: 48,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.sm,
    minHeight: 48,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: fontSize.xs,
  },
  loadingBox: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  loadingText: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  emptyBox: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  deptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  deptIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  deptName: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  deptMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  empCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  empCountBadgeActive: {
    backgroundColor: colors.primarySoft,
  },
  empCountBadgeEmpty: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  empCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  empCountTextActive: {
    color: colors.primaryDark,
  },
  empCountTextEmpty: {
    color: colors.muted,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionBtnDanger: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    color: colors.ink,
    minHeight: 48,
  },
  modalHint: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 6,
    lineHeight: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  reassignInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primarySoft,
    padding: 12,
    borderRadius: radius.sm,
  },
  reassignInfoText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.primaryDark,
    lineHeight: 18,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    marginBottom: 8,
  },
  chipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipItemActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  deleteWarnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    padding: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  deleteWarnText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: '#92400E',
    lineHeight: 18,
  },
  hybridOptionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
  },
  hybridOptionCardActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioCircleActive: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  hybridOptionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.ink,
  },
  hybridOptionTitleActive: {
    color: colors.primaryDark,
  },
  hybridOptionSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 3,
    lineHeight: 15,
  },
  noOtherDeptsNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
  },
  noOtherDeptsText: {
    flex: 1,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 15,
  },
});
