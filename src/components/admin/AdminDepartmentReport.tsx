import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { UserProfile, AttendanceRecord } from '../../types/attendance';
import { AttendanceService } from '../../services/attendanceService';
import { ActivityRecord, fetchActivities } from '../../services/activityService';
import { todayWIB, getInitials } from '../../utils/dates';
import {
  buildRekap,
  exportRekapCSV,
  exportRekapXLSX,
  exportActivitiesXLSX,
} from '../../services/exportService';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { AdminBackupModal } from './AdminBackupModal';
import { OfficeSettings } from '../../types/attendance';
import { colors, fontSize, neoShadow, radius } from '../../theme';
import { select, succeed } from '../../services/feedbackService';

interface AdminDepartmentReportProps {
  users: UserProfile[];
  offices?: OfficeSettings[];
  companyId?: string;
}

export const AdminDepartmentReport: React.FC<AdminDepartmentReportProps> = ({ users, offices = [], companyId }) => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [departmentList, setDepartmentList] = useState<string[]>([]);
  const [officeList, setOfficeList] = useState<OfficeSettings[]>(offices);
  const [loading, setLoading] = useState(true);

  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [backupConfig, setBackupConfig] = useState<{
    scope?: 'all' | 'office' | 'department' | 'employee';
    office?: string;
    department?: string;
    employeeId?: string;
  }>({});

  // Accordion Expand/Collapse Per Departemen
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({});

  // Modal Rekap Kegiatan Karyawan Individu
  const [selectedStaff, setSelectedStaff] = useState<UserProfile | null>(null);
  const [staffActivities, setStaffActivities] = useState<ActivityRecord[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      AttendanceService.getAllAttendances(),
      AttendanceService.getDepartments(companyId),
      AttendanceService.getOfficeList(),
    ])
      .then(([recs, depts, offs]) => {
        setRecords(recs);
        if (depts) {
          setDepartmentList(depts);
        }
        if (offs && offs.length > 0) {
          setOfficeList(offs);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Kumpulkan semua departemen: dari master data + departemen dari data users + 'None' jika ada karyawan tanpa divisi
  const allDepartments = useMemo(() => {
    const set = new Set<string>();
    departmentList.forEach((d) => set.add(d));
    users.forEach((u) => {
      if (u.role === 'employee') {
        const d = u.department?.trim();
        if (d && d.toLowerCase() !== 'none') {
          set.add(d);
        }
      }
    });

    const list = Array.from(set).sort();
    // Cek apakah ada karyawan yang belum diset atau 'None'
    const hasNoneStaff = users.some(
      (u) => u.role === 'employee' && (!u.department || u.department.trim() === '' || u.department.trim().toLowerCase() === 'none')
    );
    if (hasNoneStaff) {
      list.push('None');
    }
    return list;
  }, [departmentList, users]);

  // Buka semua departemen secara default saat pertama kali dimuat
  useEffect(() => {
    if (allDepartments.length > 0 && Object.keys(expandedDepts).length === 0) {
      const initial: Record<string, boolean> = {};
      allDepartments.forEach((d) => {
        initial[d] = true;
      });
      setExpandedDepts(initial);
    }
  }, [allDepartments]);

  const toggleDeptExpand = (dept: string) => {
    select();
    setExpandedDepts((prev) => ({
      ...prev,
      [dept]: !prev[dept],
    }));
  };

  const today = todayWIB();

  // Hitung statistik per departemen
  const deptReports = useMemo(() => {
    return allDepartments.map((department) => {
      const isNone = department === 'None';
      const staff = users.filter((u) => {
        if (u.role !== 'employee') return false;
        if (isNone) {
          return !u.department || u.department.trim() === '' || u.department.trim().toLowerCase() === 'none';
        }
        return u.department === department;
      });

      const ids = new Set(staff.map((u) => u.id));
      const todayRecs = records.filter(
        (r) => ids.has(r.userId) && (r.date || '').slice(0, 10) === today
      );
      const present = new Set(
        todayRecs
          .filter((r) => r.approvalStatus !== 'rejected' && r.sessionType !== 'izin_sakit')
          .map((r) => r.userId)
      );
      const leave = new Set(
        todayRecs
          .filter(
            (r) =>
              (r.type === 'izin_sakit' || r.sessionType === 'izin_sakit') &&
              (!r.reason || !r.reason.includes('[LEMBUR]')) &&
              r.approvalStatus === 'approved'
          )
          .map((r) => r.userId)
      );

      return {
        department,
        displayName: isNone ? 'Tanpa Departemen (None)' : department,
        staff,
        total: staff.length,
        presentCount: present.size,
        leaveCount: leave.size,
        percentage: staff.length ? Math.round((present.size / staff.length) * 100) : 0,
      };
    });
  }, [allDepartments, users, records, today]);

  const guardWeb = (label: string) => {
    select();
    if (Platform.OS !== 'web') {
      Alert.alert(label, 'Export saat ini tersedia melalui dashboard web.');
      return false;
    }
    return true;
  };

  const stamp = todayWIB();
  const fname = (scope: string, ext: string) => `laporan-absensi-${scope}-${stamp}.${ext}`;

  const openBackupModal = (
    scope: 'all' | 'office' | 'department' | 'employee' = 'all',
    target?: string
  ) => {
    select();
    if (scope === 'department') {
      setBackupConfig({ scope: 'department', department: target });
    } else if (scope === 'employee') {
      setBackupConfig({ scope: 'employee', employeeId: target });
    } else if (scope === 'office') {
      setBackupConfig({ scope: 'office', office: target });
    } else {
      setBackupConfig({ scope: 'all' });
    }
    setBackupModalVisible(true);
  };

  // Export Semua
  const exportAll = () => {
    if (!guardWeb('Export Excel')) return;
    const rows = buildRekap(users, records);
    exportRekapXLSX(rows, fname('semua-divisi', 'xlsx'));
    succeed();
  };

  const exportAllCSV = () => {
    if (!guardWeb('Export CSV')) return;
    const rows = buildRekap(users, records);
    exportRekapCSV(rows, fname('semua-divisi', 'csv'));
    succeed();
  };

  // Export Per Divisi
  const exportDepartment = (department: string) => {
    if (!guardWeb('Export Excel')) return;
    const isNone = department === 'None';
    const deptStaff = users.filter((u) => {
      if (u.role !== 'employee') return false;
      if (isNone) return !u.department || u.department.trim() === '' || u.department.trim().toLowerCase() === 'none';
      return u.department === department;
    });
    const rows = buildRekap(deptStaff, records);
    exportRekapXLSX(rows, fname(`${department.toLowerCase()}-rekap`, 'xlsx'));
    succeed();
  };

  const exportDepartmentCSV = (department: string) => {
    if (!guardWeb('Export CSV')) return;
    const isNone = department === 'None';
    const deptStaff = users.filter((u) => {
      if (u.role !== 'employee') return false;
      if (isNone) return !u.department || u.department.trim() === '' || u.department.trim().toLowerCase() === 'none';
      return u.department === department;
    });
    const rows = buildRekap(deptStaff, records);
    exportRekapCSV(rows, fname(`${department.toLowerCase()}-rekap`, 'csv'));
    succeed();
  };

  // Aksi Karyawan Individu: 1. Rekap Absensi Pribadi
  const exportUserAttendance = (user: UserProfile) => {
    if (!guardWeb('Export Absensi')) return;
    const rows = buildRekap([user], records);
    const cleanName = (user.fullName || 'karyawan').toLowerCase().replace(/\s+/g, '-');
    exportRekapXLSX(rows, `rekap-absensi-${cleanName}-${stamp}.xlsx`);
    succeed();
  };

  // Aksi Karyawan Individu: 2. Buka Modal Rekap Kegiatan Pribadi
  const openStaffActivitiesModal = async (user: UserProfile) => {
    select();
    setSelectedStaff(user);
    setLoadingActivities(true);
    try {
      const allActs = await fetchActivities();
      // Filter aktivitas untuk user ini
      const userActs = allActs.filter((a) => String(a.userId) === String(user.id));
      setStaffActivities(userActs);
    } catch (err) {
      console.warn('Gagal memuat log kegiatan staf:', err);
    } finally {
      setLoadingActivities(false);
    }
  };

  // Unduh XLSX Rekap Kegiatan Pribadi Staf
  const exportStaffActivitiesXLSX = () => {
    if (!selectedStaff || !guardWeb('Export Kegiatan')) return;
    const rows = staffActivities.map((act) => ({
      userName: selectedStaff.fullName,
      activityDate: act.activityDate,
      startTime: act.startTime,
      endTime: act.endTime,
      durationHours: Math.round(((act.durationMinutes || 0) / 60) * 10) / 10,
      description: act.description,
      photoUrl: act.photoUrl,
      locationAddress: act.locationAddress,
      latitude: act.latitude,
      longitude: act.longitude,
    }));
    const cleanName = (selectedStaff.fullName || 'karyawan').toLowerCase().replace(/\s+/g, '-');
    exportActivitiesXLSX(rows, `rekap-kegiatan-${cleanName}-${stamp}.xlsx`);
    succeed();
  };

  const openGoogleMaps = (lat?: number | null, lng?: number | null) => {
    if (!lat || !lng) return;
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      void Linking.openURL(url);
    }
  };

  return (
    <View style={styles.container}>
      <Card
        title="Rekap Laporan Per Divisi"
        subtitle="Daftar divisi kerja, jumlah staf, dan akses rekap per individu"
        icon="briefcase"
        action={
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <TouchableOpacity
              style={styles.backupHeaderBtn}
              onPress={() => openBackupModal('all')}
              activeOpacity={0.8}
            >
              <Feather name="download" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.backupHeaderBtnText}>Rekap & Ekspor Presensi</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.exportAllBtn}
              onPress={exportAll}
              activeOpacity={0.8}
            >
              <Feather name="file-text" size={14} color={colors.primaryDark} style={{ marginRight: 6 }} />
              <Text style={styles.exportAllText}>Unduh Cepat</Text>
            </TouchableOpacity>
          </View>
        }
      >
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Memuat data rekap laporan...</Text>
          </View>
        ) : deptReports.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="layers" size={32} color={colors.muted} />
            <Text style={styles.emptyTitle}>Belum Ada Departemen</Text>
            <Text style={styles.emptySub}>
              Tambahkan divisi baru di menu Departemen untuk mengelompokkan karyawan cabang.
            </Text>
          </View>
        ) : (
          deptReports.map((item) => {
            const isExpanded = !!expandedDepts[item.department];
            const unabsent = Math.max(0, item.total - item.presentCount - item.leaveCount);
            const isNoneDept = item.department === 'None';

            return (
              <View key={item.department} style={[styles.deptBlock, neoShadow.sm]}>
                {/* Header Kartu Departemen (Klik untuk Expand/Collapse) */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => toggleDeptExpand(item.department)}
                  style={styles.deptCardTop}
                >
                  <View style={styles.deptLeftInfo}>
                    <View style={[styles.deptIconBadge, isNoneDept && { backgroundColor: '#F1F5F9' }]}>
                      <Feather
                        name={isNoneDept ? 'help-circle' : 'layers'}
                        size={16}
                        color={isNoneDept ? colors.muted : colors.primaryDark}
                      />
                    </View>
                    <View>
                      <Text style={styles.deptName}>{item.displayName}</Text>
                      <Text style={styles.deptSubInfo}>
                        {item.total} Karyawan • {item.presentCount} Hadir Hari Ini ({item.percentage}%)
                      </Text>
                    </View>
                  </View>

                  <View style={styles.deptRightActions}>
                    <TouchableOpacity
                      style={[styles.deptExportBtn, { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        openBackupModal('department', item.department);
                      }}
                      hitSlop={8}
                    >
                      <Feather name="download" size={12} color={colors.primaryDark} style={{ marginRight: 4 }} />
                      <Text style={[styles.deptExportBtnText, { color: colors.primaryDark }]}>Rekap Divisi</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.deptExportBtn, { backgroundColor: colors.surfaceSoft }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        exportDepartment(item.department);
                      }}
                      hitSlop={8}
                    >
                      <Feather name="file-text" size={12} color={colors.muted} style={{ marginRight: 4 }} />
                      <Text style={[styles.deptExportBtnText, { color: colors.muted }]}>Semua</Text>
                    </TouchableOpacity>

                    <View style={styles.expandChevronWrap}>
                      <Feather
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.ink}
                      />
                    </View>
                  </View>
                </TouchableOpacity>

                {/* Progress Bar Kehadiran Divisi */}
                <View style={styles.track}>
                  <View
                    style={[
                      styles.bar,
                      {
                        width: `${Math.min(100, Math.max(0, item.percentage))}%`,
                        backgroundColor:
                          item.percentage >= 90
                            ? colors.primary
                            : item.percentage >= 70
                            ? colors.pulang
                            : colors.izin,
                      },
                    ]}
                  />
                </View>

                {/* Sub-List Karyawan Individu dalam Departemen Ini */}
                {isExpanded && (
                  <View style={styles.staffListWrap}>
                    <Text style={styles.staffListSectionTitle}>
                      Daftar Anggota Divisi ({item.staff.length}):
                    </Text>

                    {item.staff.length === 0 ? (
                      <View style={styles.emptyStaffNotice}>
                        <Text style={styles.emptyStaffText}>Belum ada karyawan yang terdaftar di divisi ini.</Text>
                      </View>
                    ) : (
                      item.staff.map((emp) => {
                        const todayLog = records.find(
                          (r) => r.userId === emp.id && (r.date || '').slice(0, 10) === today && r.approvalStatus !== 'rejected'
                        );
                        const isPresent = Boolean(todayLog && todayLog.sessionType !== 'izin_sakit');
                        const isLeave = Boolean(todayLog && (todayLog.type === 'izin_sakit' || todayLog.sessionType === 'izin_sakit'));

                        const initials = getInitials(emp.fullName);

                        return (
                          <View key={emp.id} style={styles.staffRowCard}>
                            {/* Kiri: Avatar & Info Karyawan */}
                            <View style={styles.staffLeftCol}>
                              <View style={styles.staffAvatar}>
                                <Text style={styles.staffAvatarText}>{initials}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <Text style={styles.staffName}>{emp.fullName}</Text>
                                  {isPresent ? (
                                    <View style={styles.presentPill}>
                                      <Text style={styles.presentPillText}>
                                        Hadir {todayLog?.clockInTime ? `(${todayLog.clockInTime.slice(11, 16)} WIB)` : ''}
                                      </Text>
                                    </View>
                                  ) : isLeave ? (
                                    <View style={styles.leavePill}>
                                      <Text style={styles.leavePillText}>Izin/Sakit</Text>
                                    </View>
                                  ) : (
                                    <View style={styles.unabsentPill}>
                                      <Text style={styles.unabsentPillText}>Belum Absen</Text>
                                    </View>
                                  )}
                                </View>
                                <Text style={styles.staffEmail}>{emp.email}</Text>
                              </View>
                            </View>

                            <View style={styles.staffActionButtonsRow}>
                              <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={() => openBackupModal('employee', emp.id)}
                                style={[styles.actionIndividualBtn, { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder }]}
                              >
                                <Feather name="download" size={13} color={colors.primaryDark} style={{ marginRight: 5 }} />
                                <Text style={[styles.actionIndividualBtnText, { color: colors.primaryDark }]}>Rekap Absensi (H/M/B)</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={() => openStaffActivitiesModal(emp)}
                                style={[styles.actionIndividualBtn, styles.actionKegiatanBtn]}
                              >
                                <Feather name="clock" size={13} color="#B45309" style={{ marginRight: 5 }} />
                                <Text style={[styles.actionIndividualBtnText, { color: '#B45309' }]}>
                                  Rekap Kegiatan
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </Card>

      {/* Modal Rincian Kegiatan Staf Terpilih */}
      <Modal
        visible={!!selectedStaff}
        onClose={() => setSelectedStaff(null)}
        title={selectedStaff ? `Rekap Kegiatan • ${selectedStaff.fullName}` : 'Rekap Kegiatan'}
      >
        <View style={styles.modalContentWrap}>
          {selectedStaff && (
            <View style={styles.modalStaffHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalStaffName}>{selectedStaff.fullName}</Text>
                <Text style={styles.modalStaffSub}>
                  Divisi: {selectedStaff.department || 'None'} • {selectedStaff.email}
                </Text>
              </View>
              {staffActivities.length > 0 && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={exportStaffActivitiesXLSX}
                  style={styles.modalExportBtn}
                >
                  <Feather name="download" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.modalExportBtnText}>Unduh XLSX</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {loadingActivities ? (
            <View style={styles.modalLoadingBox}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.modalLoadingText}>Memuat catatan kegiatan...</Text>
            </View>
          ) : staffActivities.length === 0 ? (
            <View style={styles.modalEmptyBox}>
              <Feather name="clipboard" size={32} color={colors.muted} />
              <Text style={styles.modalEmptyTitle}>Belum Ada Catatan Kegiatan</Text>
              <Text style={styles.modalEmptySub}>
                Karyawan ini belum mencatat progres atau aktivitas kerja harian di tab Kegiatan.
              </Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 10, paddingVertical: 4 }}>
                {staffActivities.map((act) => (
                  <View key={act.id} style={styles.activityItemCard}>
                    <View style={styles.actTopRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather name="calendar" size={12} color={colors.primary} />
                        <Text style={styles.actDateText}>{act.activityDate}</Text>
                      </View>
                      <View style={styles.actTimeBadge}>
                        <Feather name="clock" size={12} color={colors.primaryDark} style={{ marginRight: 4 }} />
                        <Text style={styles.actTimeText}>
                          {act.startTime} - {act.endTime} ({Math.round(((act.durationMinutes || 0) / 60) * 10) / 10}j)
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.actDescText}>{act.description}</Text>

                    {/* Foto Lampiran */}
                    {act.photoUrl ? (
                      <View style={styles.actPhotoWrap}>
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => setPreviewPhotoUrl(act.photoUrl || null)}
                          style={styles.actThumbBtn}
                        >
                          <Image source={{ uri: act.photoUrl }} style={styles.actThumbImg} />
                          <View style={styles.actThumbOverlay}>
                            <Feather name="maximize-2" size={10} color="#FFFFFF" style={{ marginRight: 4 }} />
                            <Text style={styles.actThumbOverlayText}>Perbesar</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    {/* Tautan Lokasi GPS */}
                    {act.latitude && act.longitude ? (
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => openGoogleMaps(act.latitude, act.longitude)}
                        style={styles.actLocationRow}
                      >
                        <Feather name="map-pin" size={12} color={colors.primary} style={{ marginRight: 4 }} />
                        <Text style={styles.actLocationText}>
                          {act.latitude.toFixed(6)}, {act.longitude.toFixed(6)} (Buka di Google Maps ↗)
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Modal Preview Foto Fullscreen */}
      <Modal
        visible={!!previewPhotoUrl}
        onClose={() => setPreviewPhotoUrl(null)}
        title="Dokumentasi Kegiatan"
      >
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>
          {previewPhotoUrl && (
            <Image
              source={{ uri: previewPhotoUrl }}
              style={{ width: '100%', height: 320, borderRadius: radius.md }}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      <AdminBackupModal
        visible={backupModalVisible}
        onClose={() => setBackupModalVisible(false)}
        users={users}
        records={records}
        departments={allDepartments}
        offices={officeList}
        initialScope={backupConfig.scope}
        initialOffice={backupConfig.office}
        initialDepartment={backupConfig.department}
        initialEmployeeId={backupConfig.employeeId}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  loading: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  muted: {
    color: colors.muted,
    fontSize: fontSize.xs,
  },
  backupHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  backupHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  exportAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  exportAllText: {
    color: colors.primaryDark,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  emptyCard: {
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 8,
  },
  emptySub: {
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 4,
  },
  deptBlock: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 12,
  },
  deptCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deptLeftInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  deptIconBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  deptName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.ink,
  },
  deptSubInfo: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '600',
  },
  deptRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deptExportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  deptExportBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  expandChevronWrap: {
    padding: 4,
    marginLeft: 4,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceSoft,
    overflow: 'hidden',
    marginTop: 10,
    marginBottom: 6,
  },
  bar: {
    height: '100%',
    borderRadius: 3,
  },
  staffListWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  staffListSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  emptyStaffNotice: {
    padding: 12,
    alignItems: 'center',
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.sm,
  },
  emptyStaffText: {
    fontSize: 11,
    color: colors.muted,
  },
  staffRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
  },
  staffLeftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  staffAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  staffAvatarText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  staffName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  staffEmail: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  presentPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  presentPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#166534',
  },
  leavePill: {
    backgroundColor: colors.izinSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  leavePillText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.izin,
  },
  unabsentPill: {
    backgroundColor: colors.pulangSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  unabsentPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.pulang,
  },
  staffActionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionIndividualBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  actionKegiatanBtn: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
  },
  actionIndividualBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  modalContentWrap: {
    gap: 12,
  },
  modalStaffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceSoft,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalStaffName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.ink,
  },
  modalStaffSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  modalExportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  modalExportBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalLoadingBox: {
    padding: 30,
    alignItems: 'center',
    gap: 8,
  },
  modalLoadingText: {
    fontSize: 12,
    color: colors.muted,
  },
  modalEmptyBox: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  modalEmptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  modalEmptySub: {
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
  },
  activityItemCard: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    gap: 6,
  },
  actTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actDateText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink,
  },
  actTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  actTimeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  actDescText: {
    fontSize: 12,
    color: colors.ink,
    lineHeight: 18,
  },
  actPhotoWrap: {
    marginTop: 4,
  },
  actThumbBtn: {
    width: 90,
    height: 60,
    borderRadius: radius.sm,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actThumbImg: {
    width: '100%',
    height: '100%',
  },
  actThumbOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actThumbOverlayText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  actLocationText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
