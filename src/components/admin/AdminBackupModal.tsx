import React, { useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AttendanceRecord, OfficeSettings, UserProfile, WorkShift } from '../../types/attendance';
import { buildRekap, exportRekapCSV, exportRekapXLSX } from '../../services/exportService';
import { todayWIB } from '../../utils/dates';
import { colors, fontSize, neoShadow, radius, spacing } from '../../theme';
import { select, succeed, tap } from '../../services/feedbackService';

export interface AdminBackupModalProps {
  visible: boolean;
  onClose: () => void;
  users: UserProfile[];
  records: AttendanceRecord[];
  departments: string[];
  offices?: OfficeSettings[];
  shifts?: WorkShift[];
  initialScope?: ScopeType;
  initialOffice?: string;
  initialDepartment?: string;
  initialEmployeeId?: string;
  initialTimeRange?: TimeRangeType;
}

type TimeRangeType = 'daily' | 'weekly' | 'monthly' | 'all';
type ScopeType = 'all' | 'office' | 'department' | 'employee';
type StatusFilterType = 'all' | 'hadir' | 'izin_sakit';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const AdminBackupModal: React.FC<AdminBackupModalProps> = ({
  visible,
  onClose,
  users,
  records,
  departments,
  offices = [],
  shifts = [],
  initialScope,
  initialOffice,
  initialDepartment,
  initialEmployeeId,
  initialTimeRange,
}) => {
  const now = new Date();
  const currentToday = todayWIB(now);

  const [timeRange, setTimeRange] = useState<TimeRangeType>(initialTimeRange || 'daily');
  const [dailyDate, setDailyDate] = useState<string>(currentToday);
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());

  const [scope, setScope] = useState<ScopeType>(initialScope || 'all');
  const [selectedOffice, setSelectedOffice] = useState<string>(initialOffice || '');
  const [selectedDepartment, setSelectedDepartment] = useState<string>(initialDepartment || '');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(initialEmployeeId || '');
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState<string>('');

  React.useEffect(() => {
    if (visible) {
      if (initialScope) setScope(initialScope);
      if (initialOffice !== undefined) setSelectedOffice(initialOffice);
      if (initialDepartment !== undefined) setSelectedDepartment(initialDepartment);
      if (initialEmployeeId !== undefined) setSelectedEmployeeId(initialEmployeeId);
      if (initialTimeRange) setTimeRange(initialTimeRange);
    }
  }, [visible, initialScope, initialOffice, initialDepartment, initialEmployeeId, initialTimeRange]);

  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('all');

  const employeeList = useMemo(() => {
    return users
      .filter((u) => u.role === 'employee')
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [users]);

  const officeOptions = useMemo(() => {
    const map = new Map<string, string>();
    offices.forEach((o) => {
      if (o.officeName) map.set(o.officeName, o.color || '#2196F3');
    });
    records.forEach((r) => {
      if (r.officeName && !map.has(r.officeName)) {
        map.set(r.officeName, r.officeColor || '#2196F3');
      }
    });
    return Array.from(map.entries()).map(([name, color]) => ({ name, color }));
  }, [offices, records]);

  const past7DaysRange = useMemo(() => {
    const end = currentToday;
    const startDateObj = new Date(now.getTime() - 6 * 24 * 3600 * 1000);
    const start = todayWIB(startDateObj);
    return { start, end };
  }, [currentToday]);

  const filteredEmployees = useMemo(() => {
    if (scope === 'employee') {
      if (!selectedEmployeeId) return employeeList;
      return employeeList.filter((u) => u.id === selectedEmployeeId);
    }
    if (scope === 'department') {
      if (!selectedDepartment) return employeeList;
      const isNone = selectedDepartment === 'None';
      return employeeList.filter((u) => {
        if (isNone) {
          return !u.department || u.department.trim() === '' || u.department.trim().toLowerCase() === 'none';
        }
        return u.department === selectedDepartment;
      });
    }
    return employeeList;
  }, [scope, selectedDepartment, selectedEmployeeId, employeeList]);

  const filteredRecords = useMemo(() => {
    let result = records.filter((r) => r.approvalStatus !== 'rejected');

    if (timeRange === 'daily') {
      result = result.filter((r) => r.date === dailyDate);
    } else if (timeRange === 'weekly') {
      result = result.filter((r) => r.date >= past7DaysRange.start && r.date <= past7DaysRange.end);
    } else if (timeRange === 'monthly') {
      const monthPrefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
      result = result.filter((r) => (r.date || '').startsWith(monthPrefix));
    }

    if (statusFilter === 'hadir') {
      result = result.filter((r) => r.status === 'hadir' && r.sessionType !== 'izin_sakit');
    } else if (statusFilter === 'izin_sakit') {
      result = result.filter(
        (r) => r.status === 'izin' || r.status === 'sakit' || r.sessionType === 'izin_sakit'
      );
    }

    if (scope === 'office' && selectedOffice) {
      result = result.filter((r) => r.officeName === selectedOffice);
    }

    return result;
  }, [
    records,
    timeRange,
    dailyDate,
    past7DaysRange,
    selectedMonth,
    selectedYear,
    statusFilter,
    scope,
    selectedOffice,
  ]);

  const exportRows = useMemo(() => {
    return buildRekap(filteredEmployees, filteredRecords, undefined, { shifts, offices });
  }, [filteredEmployees, filteredRecords, shifts, offices]);

  const searchedEmployees = useMemo(() => {
    if (!employeeSearchQuery.trim()) return employeeList;
    const q = employeeSearchQuery.toLowerCase();
    return employeeList.filter(
      (u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q)
    );
  }, [employeeList, employeeSearchQuery]);

  const getExportFileName = (extension: 'xlsx' | 'csv') => {
    let periodSlug = '';
    if (timeRange === 'daily') {
      periodSlug = `harian-${dailyDate}`;
    } else if (timeRange === 'weekly') {
      periodSlug = `mingguan-${past7DaysRange.start}-sd-${past7DaysRange.end}`;
    } else if (timeRange === 'monthly') {
      const mName = MONTH_NAMES[selectedMonth].toLowerCase();
      periodSlug = `bulanan-${mName}-${selectedYear}`;
    } else {
      periodSlug = 'semua-riwayat';
    }

    let scopeSlug = '';
    if (scope === 'office') {
      scopeSlug = `kantor-${(selectedOffice || 'semua').toLowerCase().replace(/\s+/g, '-')}`;
    } else if (scope === 'department') {
      scopeSlug = `divisi-${(selectedDepartment || 'semua').toLowerCase().replace(/\s+/g, '-')}`;
    } else if (scope === 'employee') {
      const emp = employeeList.find((u) => u.id === selectedEmployeeId);
      scopeSlug = `staf-${(emp?.fullName || 'individu').toLowerCase().replace(/\s+/g, '-')}`;
    } else {
      scopeSlug = 'semua-karyawan';
    }

    return `backup-absensi-${periodSlug}-${scopeSlug}.${extension}`;
  };

  const handleExportXLSX = () => {
    if (exportRows.length === 0) return;
    tap();
    const fileName = getExportFileName('xlsx');
    exportRekapXLSX(exportRows, fileName);
    succeed();
  };

  const handleExportCSV = () => {
    if (exportRows.length === 0) return;
    tap();
    const fileName = getExportFileName('csv');
    exportRekapCSV(exportRows, fileName);
    succeed();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, neoShadow.lg]}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerIconBox}>
                <Feather name="download" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Rekap & Ekspor Presensi</Text>
                <Text style={styles.subTitle}>
                  Unduh laporan presensi Harian, Mingguan, atau Bulanan untuk seluruh perusahaan, per divisi, atau staf perorangan
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                tap();
                onClose();
              }}
              style={styles.closeBtn}
              hitSlop={12}
            >
              <Feather name="x" size={20} color={colors.ink} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Feather name="calendar" size={15} color={colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>1. Periode Waktu Absensi</Text>
              </View>

              <View style={styles.segmentedRow}>
                <TouchableOpacity
                  style={[styles.segmentBtn, timeRange === 'daily' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setTimeRange('daily');
                  }}
                >
                  <Text style={[styles.segmentBtnText, timeRange === 'daily' && styles.segmentBtnTextActive]}>
                    Harian
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, timeRange === 'weekly' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setTimeRange('weekly');
                  }}
                >
                  <Text style={[styles.segmentBtnText, timeRange === 'weekly' && styles.segmentBtnTextActive]}>
                    Mingguan (7 Hari)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, timeRange === 'monthly' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setTimeRange('monthly');
                  }}
                >
                  <Text style={[styles.segmentBtnText, timeRange === 'monthly' && styles.segmentBtnTextActive]}>
                    Bulanan
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, timeRange === 'all' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setTimeRange('all');
                  }}
                >
                  <Text style={[styles.segmentBtnText, timeRange === 'all' && styles.segmentBtnTextActive]}>
                    Semua Waktu
                  </Text>
                </TouchableOpacity>
              </View>

              {timeRange === 'daily' && (
                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>Pilih Tanggal Presensi:</Text>
                  <View style={styles.datePickerRow}>
                    <TextInput
                      style={styles.dateInput}
                      value={dailyDate}
                      onChangeText={setDailyDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.faint}
                    />
                    <TouchableOpacity
                      style={[styles.quickDateBtn, dailyDate === currentToday && styles.quickDateBtnActive]}
                      onPress={() => {
                        tap();
                        setDailyDate(currentToday);
                      }}
                    >
                      <Feather name="clock" size={13} color={dailyDate === currentToday ? '#FFFFFF' : colors.primary} style={{ marginRight: 4 }} />
                      <Text style={[styles.quickDateBtnText, dailyDate === currentToday && styles.quickDateBtnTextActive]}>
                        Hari Ini
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {timeRange === 'weekly' && (
                <View style={styles.detailBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Feather name="info" size={14} color={colors.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.detailNotice}>
                      Mencakup 7 hari kerja terakhir: <Text style={styles.boldText}>{past7DaysRange.start}</Text> s/d <Text style={styles.boldText}>{past7DaysRange.end}</Text>
                    </Text>
                  </View>
                </View>
              )}

              {timeRange === 'monthly' && (
                <View style={styles.detailBox}>
                  <View style={styles.yearRow}>
                    <Text style={styles.detailBoxLabel}>Tahun: {selectedYear}</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        style={styles.yearStepBtn}
                        onPress={() => {
                          tap();
                          setSelectedYear((y) => y - 1);
                        }}
                      >
                        <Feather name="chevron-left" size={14} color={colors.ink} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.yearStepBtn}
                        onPress={() => {
                          tap();
                          setSelectedYear((y) => y + 1);
                        }}
                      >
                        <Feather name="chevron-right" size={14} color={colors.ink} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.monthsGrid}>
                    {MONTH_NAMES.map((name, idx) => {
                      const isActive = selectedMonth === idx;
                      return (
                        <TouchableOpacity
                          key={name}
                          style={[styles.monthPill, isActive && styles.monthPillActive]}
                          onPress={() => {
                            select();
                            setSelectedMonth(idx);
                          }}
                        >
                          <Text style={[styles.monthPillText, isActive && styles.monthPillTextActive]}>
                            {name.slice(0, 3)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {timeRange === 'all' && (
                <View style={styles.detailBox}>
                  <Text style={styles.detailNotice}>
                    Mengekspor seluruh riwayat presensi yang tersimpan di sistem tanpa batas tanggal.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Feather name="filter" size={15} color={colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>2. Target / Lingkup Karyawan</Text>
              </View>

              <View style={styles.segmentedRow}>
                <TouchableOpacity
                  style={[styles.segmentBtn, scope === 'all' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setScope('all');
                  }}
                >
                  <Text style={[styles.segmentBtnText, scope === 'all' && styles.segmentBtnTextActive]}>
                    Perusahaan (Semua)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, scope === 'office' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setScope('office');
                    if (!selectedOffice && officeOptions.length > 0) {
                      setSelectedOffice(officeOptions[0].name);
                    }
                  }}
                >
                  <Text style={[styles.segmentBtnText, scope === 'office' && styles.segmentBtnTextActive]}>
                    Per Cabang
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, scope === 'department' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setScope('department');
                    if (!selectedDepartment && departments.length > 0) {
                      setSelectedDepartment(departments[0]);
                    }
                  }}
                >
                  <Text style={[styles.segmentBtnText, scope === 'department' && styles.segmentBtnTextActive]}>
                    Departemen
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, scope === 'employee' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setScope('employee');
                    if (!selectedEmployeeId && employeeList.length > 0) {
                      setSelectedEmployeeId(employeeList[0].id);
                    }
                  }}
                >
                  <Text style={[styles.segmentBtnText, scope === 'employee' && styles.segmentBtnTextActive]}>
                    Perorangan
                  </Text>
                </TouchableOpacity>
              </View>

              {scope === 'office' && (
                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>Pilih Titik Lokasi Kantor:</Text>
                  <View style={styles.chipsWrap}>
                    {officeOptions.length === 0 ? (
                      <Text style={styles.mutedText}>Belum ada data titik kantor.</Text>
                    ) : (
                      officeOptions.map((opt) => {
                        const isSel = selectedOffice === opt.name;
                        return (
                          <TouchableOpacity
                            key={opt.name}
                            style={[styles.chipItem, isSel && styles.chipItemActive]}
                            onPress={() => {
                              select();
                              setSelectedOffice(opt.name);
                            }}
                          >
                            <Text style={{ color: opt.color, marginRight: 5 }}>●</Text>
                            <Text style={[styles.chipText, isSel && styles.chipTextActive]}>{opt.name}</Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                </View>
              )}

              {scope === 'department' && (
                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>Pilih Divisi / Departemen:</Text>
                  <View style={styles.chipsWrap}>
                    {departments.map((dept) => {
                      const isSel = selectedDepartment === dept;
                      return (
                        <TouchableOpacity
                          key={dept}
                          style={[styles.chipItem, isSel && styles.chipItemActive]}
                          onPress={() => {
                            select();
                            setSelectedDepartment(dept);
                          }}
                        >
                          <Text style={[styles.chipText, isSel && styles.chipTextActive]}>{dept}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {scope === 'employee' && (
                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>Pilih Karyawan:</Text>
                  <View style={styles.searchBarBox}>
                    <Feather name="search" size={14} color={colors.faint} style={{ marginRight: 6 }} />
                    <TextInput
                      style={styles.searchInput}
                      value={employeeSearchQuery}
                      onChangeText={setEmployeeSearchQuery}
                      placeholder="Cari nama karyawan..."
                      placeholderTextColor={colors.faint}
                    />
                  </View>

                  <ScrollView style={styles.staffSelectList} nestedScrollEnabled={true}>
                    {searchedEmployees.map((emp) => {
                      const isSel = selectedEmployeeId === emp.id;
                      return (
                        <TouchableOpacity
                          key={emp.id}
                          style={[styles.staffSelectRow, isSel && styles.staffSelectRowActive]}
                          onPress={() => {
                            select();
                            setSelectedEmployeeId(emp.id);
                          }}
                        >
                          <View style={styles.staffSelectAvatar}>
                            <Text style={styles.staffSelectAvatarText}>
                              {emp.fullName.slice(0, 2).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.staffSelectName, isSel && styles.staffSelectNameActive]}>
                              {emp.fullName}
                            </Text>
                            <Text style={styles.staffSelectDept}>
                              {emp.department || 'Tanpa Divisi'} • {emp.email}
                            </Text>
                          </View>
                          {isSel && <Feather name="check" size={16} color={colors.primary} />}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Feather name="check-square" size={15} color={colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>3. Jenis Kehadiran</Text>
              </View>

              <View style={styles.segmentedRow}>
                <TouchableOpacity
                  style={[styles.segmentBtn, statusFilter === 'all' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setStatusFilter('all');
                  }}
                >
                  <Text style={[styles.segmentBtnText, statusFilter === 'all' && styles.segmentBtnTextActive]}>
                    Semua Status
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, statusFilter === 'hadir' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setStatusFilter('hadir');
                  }}
                >
                  <Text style={[styles.segmentBtnText, statusFilter === 'hadir' && styles.segmentBtnTextActive]}>
                    Hanya Hadir
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, statusFilter === 'izin_sakit' && styles.segmentBtnActive]}
                  onPress={() => {
                    select();
                    setStatusFilter('izin_sakit');
                  }}
                >
                  <Text style={[styles.segmentBtnText, statusFilter === 'izin_sakit' && styles.segmentBtnTextActive]}>
                    Hanya Izin & Sakit
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.summaryCard}>
              <View style={styles.summaryTop}>
                <Feather name="file-text" size={16} color={colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.summaryCardTitle}>Ringkasan Arsip Siap Ekspor</Text>
              </View>

              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Periode Waktu:</Text>
                  <Text style={styles.summaryVal}>
                    {timeRange === 'daily'
                      ? `Harian (${dailyDate})`
                      : timeRange === 'weekly'
                      ? `7 Hari Terakhir (${past7DaysRange.start} s/d ${past7DaysRange.end})`
                      : timeRange === 'monthly'
                      ? `Bulan ${MONTH_NAMES[selectedMonth]} ${selectedYear}`
                      : 'Seluruh Riwayat'}
                  </Text>
                </View>

                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Target Lingkup:</Text>
                  <Text style={styles.summaryVal}>
                    {scope === 'office'
                      ? `Kantor: ${selectedOffice || 'Semua'}`
                      : scope === 'department'
                      ? `Divisi: ${selectedDepartment || 'Semua'}`
                      : scope === 'employee'
                      ? `Staf: ${employeeList.find((u) => u.id === selectedEmployeeId)?.fullName || 'Terpilih'}`
                      : 'Semua Karyawan (Seluruh Cabang)'}
                  </Text>
                </View>

                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Total Baris Absensi:</Text>
                  <Text
                    style={[
                      styles.summaryVal,
                      { color: exportRows.length > 0 ? colors.success : colors.danger, fontWeight: '700' },
                    ]}
                  >
                    {exportRows.length} Baris Presensi ({filteredEmployees.length} Karyawan)
                  </Text>
                </View>
              </View>

              {exportRows.length === 0 && (
                <View style={styles.emptyNotice}>
                  <Feather name="alert-circle" size={14} color={colors.warning} style={{ marginRight: 6 }} />
                  <Text style={styles.emptyNoticeText}>
                    Tidak ada catatan presensi yang cocok dengan filter di atas. Coba ubah tanggal atau target.
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>

          <View style={styles.footerActions}>
            <TouchableOpacity
              style={[styles.exportBtn, styles.xlsxBtn, exportRows.length === 0 && styles.btnDisabled]}
              disabled={exportRows.length === 0}
              onPress={handleExportXLSX}
              activeOpacity={0.8}
            >
              <Feather name="download" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.xlsxBtnText}>Unduh Excel (.XLSX)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportBtn, styles.csvBtn, exportRows.length === 0 && styles.btnDisabled]}
              disabled={exportRows.length === 0}
              onPress={handleExportCSV}
              activeOpacity={0.8}
            >
              <Feather name="file-text" size={15} color={colors.ink} style={{ marginRight: 6 }} />
              <Text style={styles.csvBtnText}>Unduh CSV</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
    maxWidth: 620,
    maxHeight: '92%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.borderMuted,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.ink,
  },
  subTitle: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  scrollBody: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  segmentedRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentBtnActive: {
    backgroundColor: colors.surface,
    ...neoShadow.sm,
  },
  segmentBtnText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: '500',
  },
  segmentBtnTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  detailBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: 6,
  },
  detailBoxLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 6,
  },
  datePickerRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dateInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontSize: fontSize.sm,
    color: colors.ink,
  },
  quickDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primarySoft,
  },
  quickDateBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickDateBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  quickDateBtnTextActive: {
    color: '#FFFFFF',
  },
  detailNotice: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  boldText: {
    fontWeight: '700',
    color: colors.ink,
  },
  yearRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  yearStepBtn: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  monthPill: {
    width: '23%',
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  monthPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  monthPillText: {
    fontSize: fontSize.xs,
    color: colors.ink,
    fontWeight: '500',
  },
  monthPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
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
  },
  chipTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  mutedText: {
    fontSize: fontSize.xs,
    color: colors.faint,
  },
  searchBarBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.ink,
    paddingVertical: 2,
  },
  staffSelectList: {
    maxHeight: 140,
  },
  staffSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderBottomWidth: 1,
    borderColor: colors.surfaceSoft,
  },
  staffSelectRowActive: {
    backgroundColor: colors.primarySoft,
  },
  staffSelectAvatar: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  staffSelectAvatarText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.ink,
  },
  staffSelectName: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.ink,
  },
  staffSelectNameActive: {
    color: colors.primaryDark,
  },
  staffSelectDept: {
    fontSize: 10,
    color: colors.faint,
  },
  summaryCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: colors.borderMuted,
    paddingBottom: 6,
  },
  summaryCardTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  summaryGrid: {
    gap: 4,
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  summaryVal: {
    fontSize: fontSize.xs,
    color: colors.ink,
    fontWeight: '600',
  },
  emptyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    padding: 8,
    marginTop: 4,
  },
  emptyNoticeText: {
    fontSize: fontSize.xs,
    color: colors.warningInk,
    flex: 1,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    padding: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.borderMuted,
    backgroundColor: colors.surface,
  },
  exportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: radius.md,
  },
  xlsxBtn: {
    backgroundColor: colors.primary,
  },
  xlsxBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: fontSize.sm,
  },
  csvBtn: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  csvBtnText: {
    color: colors.ink,
    fontWeight: '600',
    fontSize: fontSize.sm,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
