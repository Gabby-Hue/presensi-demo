import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AttendanceRecord,
  AttendanceType,
  OfficeSettings,
  SessionType,
  UserProfile,
  WorkShift,
  ShiftSwap,
} from '../../types/attendance';
import {
  calculateDistanceMeters,
  formatDistance,
  getCurrentLocation,
} from '../../services/locationService';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { MapView } from '../ui/MapView';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CameraModal } from './CameraModal';
import { LeaveRequestForm } from './LeaveRequestForm';
import { MonthAttendanceCalendar } from './MonthAttendanceCalendar';
import { ProfileScreen } from './ProfileScreen';
import { UserActivitiesScreen } from './UserActivitiesScreen';
import { BottomNavBar, UserTabKey } from '../ui/BottomNavBar';
import { StorageService } from '../../services/storageService';
import { AttendanceService } from '../../services/attendanceService';
import { resolveMediaUrl } from '../../lib/api';
import { succeed, fail, select } from '../../services/feedbackService';
import { isWeekendDateString, isAfterTimeOfDay, todayWIB, getInitials } from '../../utils/dates';
import { resolveWorkDay, isOvernight, isLateForShift, isClockOutOpenForShift, swapOverrides } from '../../utils/shifts';
import { ShiftSwapPanel } from './ShiftSwapPanel';
import { NotificationBell } from '../ui/NotificationBell';
import { addMinutes } from '../../utils/time';
import { DEFAULT_LEAVE_QUOTA, leaveDaysUsed, lateMinutes, scheduleFor } from '../../utils/payroll';
import { getHolidayName, isNationalHoliday } from '../../utils/holidays';
import { printAttendanceSlip } from '../../services/exportService';
import { Feather } from '@expo/vector-icons';
import { colors, fontSize, neoShadow, radius, spacing } from '../../theme';

interface AttendanceHubProps {
  user: UserProfile;
  officeSettings: OfficeSettings;
  officeList: OfficeSettings[];
  userTodayStatus: AttendanceRecord | null;
  userHistory: AttendanceRecord[];
  onClockIn: (data: {
    type: AttendanceType;
    sessionType: SessionType;
    latitude?: number;
    longitude?: number;
    distanceMeters?: number;
    officeName?: string;
    officeColor?: string;
    reason?: string;
    startDate?: string;
    endDate?: string;
    photoUrl?: string;
    documentUrl?: string;
    workDate?: string;
  }) => Promise<void>;
  onLogout: () => void;
  onUpdateUser?: (updated: UserProfile) => void;
  onRefreshData?: () => Promise<void>;
}

// Awal minggu (Senin jam 00:00) untuk filter "Kehadiran Minggu Ini".
const getWeekStart = (): Date => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Senin = 0, Minggu = 6
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Awal bulan berjalan untuk filter "Absensi Bulan Ini".
const getMonthStart = (): Date => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1, 0, 0, 0, 0);
};

const safeParseDate = (v?: any): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim().replace(' ', 'T');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const formatLogDate = (iso?: string | null): string => {
  const d = safeParseDate(iso);
  if (!d) return '-';
  try {
    return d.toLocaleDateString('id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '-';
  }
};

const formatLogTime = (iso?: string | null): string => {
  const d = safeParseDate(iso);
  if (!d) return '--:--';
  try {
    return d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '--:--';
  }
};

export const AttendanceHub: React.FC<AttendanceHubProps> = ({
  user,
  officeSettings,
  officeList,
  userTodayStatus,
  userHistory,
  onClockIn,
  onLogout,
  onUpdateUser,
  onRefreshData,
}) => {
  const offices = officeList;
  const hasNoOffice = offices.length === 0;
  const [activeTab, setActiveTab] = useState<UserTabKey | 'izin'>('presensi');
  const [leaveViewMode, setLeaveViewMode] = useState<'list' | 'create'>('list');
  const [mode, setMode] = useState<'masuk' | 'pulang'>('masuk');
  const [place, setPlace] = useState<'kantor' | 'luar'>('kantor');
  const [currentDistance, setCurrentDistance] = useState<number | null>(null);
  const [companyShifts, setCompanyShifts] = useState<WorkShift[]>([]);
  // Absen masuk paling cepat N menit sebelum jam masuk (diatur admin, default 30)
  const [earlyMin, setEarlyMin] = useState<number | null>(30);
  useEffect(() => {
    AttendanceService.getEarlyCheckinMinutes(user.companyId)
      .then(setEarlyMin)
      .catch(() => setEarlyMin(30));
  }, [user.companyId]);
  const hasAnyShift = !!user.shiftId || Object.keys(user.shiftSchedule || {}).length > 0;

  useEffect(() => {
    let alive = true;
    if (!hasAnyShift) {
      setCompanyShifts([]);
      return;
    }
    AttendanceService.getShifts(user.companyId || undefined)
      .then((list) => alive && setCompanyShifts(list))
      .catch(() => alive && setCompanyShifts([]));
    return () => {
      alive = false;
    };
  }, [hasAnyShift, user.companyId]);

  // Tukar shift yang melibatkan karyawan ini (yang disetujui menimpa jadwal pada tanggalnya)
  const [mySwaps, setMySwaps] = useState<ShiftSwap[]>([]);
  const loadSwaps = useCallback(() => {
    if (!hasAnyShift) return setMySwaps([]);
    const from = todayWIB(new Date(Date.now() - 40 * 86400e3));
    AttendanceService.getShiftSwaps({ userId: user.id, fromDate: from })
      .then(setMySwaps)
      .catch(() => setMySwaps([]));
  }, [hasAnyShift, user.id]);
  useEffect(() => {
    loadSwaps();
  }, [loadSwaps]);
  const schedUser = useMemo(() => ({ ...user, shiftOverrides: swapOverrides(mySwaps, user.id) }), [user, mySwaps]);
  const [nearestOffice, setNearestOffice] = useState<OfficeSettings | null>(offices[0] || null);
  const [currentCoords, setCurrentCoords] = useState<{ latitude: number; longitude: number }>({
    latitude: offices[0]?.latitude ?? -7.23707,
    longitude: offices[0]?.longitude ?? 112.6346,
  });
  const [locLoading, setLocLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const reasonInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [reasonCardY, setReasonCardY] = useState(0);
  const [pendingLeaveData, setPendingLeaveData] = useState<{
    startDate: string;
    endDate: string;
    reason: string;
    documentUrl?: string;
  } | null>(null);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [gpsStale, setGpsStale] = useState(false);

  // Modern Dynamic In-App Dialog (Menggantikan Alert.alert jelek & dialog kaku)
  const [dialogConfig, setDialogConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: keyof typeof Feather.glyphMap;
    variant: 'danger' | 'primary';
    confirmText?: string;
    cancelText?: string;
    singleButton?: boolean;
    onConfirm?: () => void;
  }>({
    visible: false,
    title: '',
    message: '',
    icon: 'alert-circle',
    variant: 'danger',
    confirmText: 'Tutup',
    singleButton: true,
  });

  const openAppDialog = (config: {
    title: string;
    message: string;
    icon?: keyof typeof Feather.glyphMap;
    variant?: 'danger' | 'primary';
    confirmText?: string;
    cancelText?: string;
    singleButton?: boolean;
    onConfirm?: () => void;
  }) => {
    setDialogConfig({
      visible: true,
      title: config.title,
      message: config.message,
      icon: config.icon || 'alert-circle',
      variant: config.variant || 'danger',
      confirmText: config.confirmText || 'Tutup',
      cancelText: config.cancelText || 'Batal',
      singleButton: config.singleButton ?? true,
      onConfirm: config.onConfirm,
    });
  };

  const closeAppDialog = () => {
    setDialogConfig((prev) => ({ ...prev, visible: false }));
  };

  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [leaveCategoryFilter, setLeaveCategoryFilter] = useState<'izin' | 'sakit' | 'lembur' | 'telat'>('izin');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AttendanceRecord | null>(null);
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calDay, setCalDay] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    // Sinkronisasi waktu setiap 30 detik untuk efisiensi render & hemat baterai perangkat
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Toast "belum absen" — muncul sesaat menggantung dari atas, oranye, bisa disilang.
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastSlide = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    if (offices.length > 0) {
      setNearestOffice(offices[0]);
    } else {
      setNearestOffice(null);
    }
    fetchLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeSettings?.id, offices.length]);

  const dismissToast = () => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    Animated.timing(toastSlide, { toValue: -80, duration: 250, useNativeDriver: true }).start(() => {
      setToastVisible(false);
    });
  };

  const fetchLocation = async () => {
    setLocLoading(true);
    setLocError(null);
    setGpsStale(false);
    const { coords, errorMsg } = await getCurrentLocation();
    setCurrentCoords(coords);

    if (errorMsg) {
      setLocError(errorMsg);
      setGpsStale(true);
      setNearestOffice(offices[0] || null);
      setCurrentDistance(null); // Jarak dinonaktifkan agar tidak muncul kontradiksi 0m saat GPS mati
      setLocLoading(false);
      return;
    }

    if (offices.length === 0) {
      setNearestOffice(null);
      setCurrentDistance(null);
      setLocLoading(false);
      return;
    }

    // Cari titik kantor terdekat dari posisi user
    let best = offices[0];
    let bestDist = calculateDistanceMeters(coords.latitude, coords.longitude, best.latitude, best.longitude);
    for (const office of offices.slice(1)) {
      const d = calculateDistanceMeters(coords.latitude, coords.longitude, office.latitude, office.longitude);
      if (d < bestDist) {
        best = office;
        bestDist = d;
      }
    }
    setNearestOffice(best);
    setCurrentDistance(bestDist);
    setLocLoading(false);
  };

  const isWithinRadius =
    !locError && !gpsStale && currentDistance !== null && nearestOffice
      ? currentDistance <= nearestOffice.radiusMeters
      : false;

  const blockReason =
    hasNoOffice
      ? 'Titik kantor cabang belum dikonfigurasi oleh admin cabang.'
      : locLoading
      ? 'Sedang mencari koordinat GPS perangkat...'
      : locError || gpsStale || currentDistance === null
      ? (locError || 'Izin akses lokasi belum aktif. Aktifkan GPS pada perangkat Anda lalu tekan tombol Perbarui.')
      : place === 'kantor' && nearestOffice && currentDistance > nearestOffice.radiusMeters
        ? `Anda berada ${formatDistance(currentDistance)} dari ${nearestOffice.officeName} (batas radius: ${nearestOffice.radiusMeters} m). Silakan mendekat ke area kantor atau pilih opsi presensi Di Luar.`
        : null;
  const firstName = user.fullName.split(' ')[0];
  const todayLabel = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Waktu real-time & salam
  const curHour = currentTime.getHours();
  const curMin = currentTime.getMinutes();

  const getGreeting = (h: number) => {
    if (h >= 4 && h < 11) return 'Selamat Pagi';
    if (h >= 11 && h < 15) return 'Selamat Siang';
    if (h >= 15 && h < 18) return 'Selamat Sore';
    return 'Selamat Malam';
  };
  const greeting = getGreeting(curHour);

  const parseHourMinute = (timeStr?: string, defH = 8, defM = 0) => {
    if (!timeStr) return { h: defH, m: defM };
    const parts = timeStr.split(':').map((p) => parseInt(p, 10));
    return {
      h: !isNaN(parts[0]) ? parts[0] : defH,
      m: !isNaN(parts[1]) ? parts[1] : defM,
    };
  };

  // Shift hari ini (jadwal mingguan > shift tetap). Shift malam: setelah tengah malam masih tanggal kemarin.
  // Sesi masuk tanpa pulang pada tanggal tsb (untuk masa tenggang shift malam).
  const hasOpenSession = (date: string) =>
    userHistory.some((r) => r.date === date && r.sessionType === 'masuk') &&
    !userHistory.some((r) => r.date === date && r.sessionType === 'pulang');
  const workDay = resolveWorkDay(schedUser, companyShifts, currentTime, hasOpenSession);
  const myShift = workDay.shift;
  const nightShift = myShift && isOvernight(myShift) ? myShift : null;
  const sinceStart = (d: Date) => resolveWorkDay(schedUser, companyShifts, d, hasOpenSession).minutesSinceStart ?? 0;

  // Karyawan dengan shift memakai jam shift; selain itu jam kantor terdekat.
  const workStartStr = myShift?.startTime || nearestOffice?.workStartTime || '08:00';
  const workEndStr =
    myShift?.endTime ||
    (user.workMinutes ? addMinutes(nearestOffice?.workStartTime || '08:00', user.workMinutes) : nearestOffice?.workEndTime) ||
    '17:00';
  const lateDeadStr = myShift?.lateDeadline || nearestOffice?.lateDeadline || '10:00';

  const { h: lateH, m: lateM } = parseHourMinute(lateDeadStr, 10, 0);

  // Menit sejak jam masuk (negatif = belum jam masuk), WIB
  const minutesFromStart = (d: Date) => {
    if (myShift) return sinceStart(d);
    const w = new Date(d.getTime() + 7 * 3600e3);
    const { h, m } = parseHourMinute(workStartStr, 8, 0);
    return w.getUTCHours() * 60 + w.getUTCMinutes() - (h * 60 + m);
  };
  const checkInOpensAt = earlyMin != null ? addMinutes(workStartStr, -earlyMin) : null;
  const { h: endH, m: endM } = parseHourMinute(workEndStr, 17, 0);

  // ---- Data untuk tombol & logs (sesi masuk, pulang, dan izin) ----
  const todayStr = workDay.date;
  const todayMasuk = userHistory.find(
    (r) => (r.date || '').slice(0, 10) === todayStr && r.sessionType === 'masuk'
  );
  const todayPulang = userHistory.find(
    (r) => (r.date || '').slice(0, 10) === todayStr && r.sessionType === 'pulang'
  );

  // Izin / sakit yang mencakup hari ini (TIDAK termasuk pengajuan lembur & izin telat)
  const todayLeave = userHistory.find((r) => {
    if (r.type !== 'izin_sakit' && r.sessionType !== 'izin_sakit') return false;
    if (r.reason && r.reason.includes('[LEMBUR]')) return false;
    if (r.reason && r.reason.includes('[TELAT')) return false;
    const start = (r.startDate || r.date || '').slice(0, 10);
    const end = (r.endDate || r.date || '').slice(0, 10);
    return !!(start && end && todayStr >= start && todayStr <= end);
  });

  const todayTelatNotice = userHistory.some(
    (r) => (r.date || '').slice(0, 10) === todayStr && !!r.reason?.includes('[TELAT') && r.approvalStatus !== 'rejected'
  );

  // Deteksi akhir pekan / hari libur nasional (otomatis mode lembur)
  const isTodayWeekend = isWeekendDateString(todayStr);
  const isTodayHoliday = isNationalHoliday(todayStr);
  // Shift yang dijadwalkan eksplisit di akhir pekan/libur = hari kerja biasa, bukan lembur.
  const isLemburDay = !scheduleFor(schedUser, todayStr, companyShifts).workday;

  // Status izin aktif hari ini (termasuk deteksi spesifik sesi setengah hari pagi / siang)
  const isHalfDayLeave = !!todayLeave?.reason && /setengah\s*hari/i.test(todayLeave.reason);
  const isHalfDayPagi = isHalfDayLeave && /pagi/i.test(todayLeave?.reason || '');
  const isHalfDaySiang = isHalfDayLeave && /siang/i.test(todayLeave?.reason || '');
  const isLeaveApproved = todayLeave?.approvalStatus === 'approved';
  const isFullLeaveActive = !!todayLeave && todayLeave.approvalStatus !== 'rejected' && !isHalfDayLeave;

  // Jam tengah hari untuk izin setengah hari siang (pulang dibuka mulai 11:30 WIB)
  const halfDayOutH = 11;
  const halfDayOutM = 30;

  // Jam pulang efektif: jika izin setengah hari siang disetujui, pulang dibuka mulai 11:30 WIB
  const effectiveEndH = isHalfDaySiang && isLeaveApproved ? halfDayOutH : endH;
  const effectiveEndM = isHalfDaySiang && isLeaveApproved ? halfDayOutM : endM;

  // Aturan jam datang: dinamis mengikuti batas terlambat kantor (libur/weekend = lembur bebas batas terlambat)
  // shortcut: shift malam tidak mendukung izin setengah hari, upgrade bila ada kebutuhan.
  const isLateCheckIn = isLemburDay
    ? false
    : nightShift
    ? isLateForShift(nightShift, sinceStart(currentTime))
    : isHalfDayPagi && isLeaveApproved
    ? isAfterTimeOfDay(currentTime, 13, 0)
    : isAfterTimeOfDay(currentTime, lateH, lateM);

  // Absen masuk terlalu awal (lembur di hari libur tidak dibatasi)
  const isTooEarlyCheckIn = (d: Date) =>
    !isLemburDay && earlyMin != null && !todayMasuk && minutesFromStart(d) < -earlyMin;
  const tooEarlyNow = isTooEarlyCheckIn(currentTime);

  // Aturan jam pulang: lembur weekend/libur dibuka begitu sudah masuk; hari biasa ikuti jam kantor atau izin siang
  const isClockOutUnlocked = isLemburDay
    ? !!todayMasuk
    : nightShift
    ? isClockOutOpenForShift(nightShift, sinceStart(currentTime))
    : currentTime.getTime() >= Date.parse(todayStr + 'T00:00:00+07:00') + (effectiveEndH * 60 + effectiveEndM) * 60e3;

  // Countdown jam pulang menuju jam pulang kantor atau jam pulang izin setengah hari
  const getClockOutCountdown = () => {
    if (isClockOutUnlocked || isLemburDay) return '';
    // Jam pulang dalam WIB pada tanggal kerja (shift malam: keesokan harinya).
    let target = new Date(Date.parse(todayStr + 'T00:00:00+07:00') + (effectiveEndH * 60 + effectiveEndM) * 60e3);
    if (nightShift && target <= currentTime) target = new Date(target.getTime() + 24 * 3600e3);
    const diffMs = Math.max(0, target.getTime() - currentTime.getTime());
    const h = Math.floor(diffMs / (1000 * 60 * 60));
    const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (h > 0) return `${h} jam ${m} mnt lagi`;
    return `${m} mnt lagi`;
  };
  const clockOutCountdownText = getClockOutCountdown();

  // Inisial foto profil bersih (kebal simbol kurung e.g. "Neil (Karyawan)" -> "NE")
  const initials = getInitials(user.fullName);

  // Rekap Presensi Bulan Ini (ala Stitch Enterprise: Hadir Tepat, Terlambat, Izin/Cuti)
  const currentMonthStart = getMonthStart();
  const currentMonthName = new Date().toLocaleDateString('id-ID', { month: 'long' });
  const monthAllRecords = userHistory.filter((r) => {
    const d = safeParseDate(r.clockInTime || r.createdAt || r.date);
    return d ? d >= currentMonthStart : false;
  });

  const onTimeCount = monthAllRecords.filter((r) => {
    if (r.sessionType !== 'masuk') return false;
    if (!r.clockInTime) return false;
    return lateMinutes(r.clockInTime, r.date, scheduleFor(schedUser, r.date, companyShifts, nearestOffice || undefined)) === 0;
  }).length;

  const lateCount = monthAllRecords.filter((r) => {
    if (r.sessionType !== 'masuk') return false;
    if (!r.clockInTime) return false;
    return lateMinutes(r.clockInTime, r.date, scheduleFor(schedUser, r.date, companyShifts, nearestOffice || undefined)) > 0;
  }).length;

  const leaveCount = monthAllRecords.filter((r) => {
    if (r.type !== 'izin_sakit' && r.sessionType !== 'izin_sakit') return false;
    if (r.reason && r.reason.includes('[LEMBUR]')) return false;
    if (r.reason && r.reason.includes('[TELAT')) return false;
    return r.approvalStatus !== 'rejected';
  }).length;

  // Smart Auto-Switch Mode Presensi:
  // Jika sudah absen masuk dan belum absen pulang, arahkan konsol langsung ke 'pulang'
  useEffect(() => {
    if (todayMasuk && !todayPulang) {
      setMode('pulang');
    } else if (!todayMasuk) {
      setMode('masuk');
    }
  }, [todayMasuk?.id, todayPulang?.id]);

  // Tampilkan toast pengingat HANYA jika benar-benar belum absen (bukan weekend, bukan izin, dan belum masuk)
  useEffect(() => {
    const isWeekend = isWeekendDateString(todayStr);
    const hasActiveLeave = !!todayLeave && todayLeave.approvalStatus !== 'rejected';
    const alreadyAttended = !!todayMasuk || !!todayPulang || !!userTodayStatus;

    if (!alreadyAttended && !isWeekend && !hasActiveLeave) {
      setToastVisible(true);
      Animated.spring(toastSlide, { toValue: 0, useNativeDriver: true }).start();
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => dismissToast(), 5000);
    } else {
      dismissToast();
    }
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayMasuk?.id, todayPulang?.id, userTodayStatus?.id, todayLeave?.id, todayStr]);

  // Semua riwayat izin/sakit pengguna
  const userLeaves = userHistory
    .filter((r) => r.type === 'izin_sakit' || r.sessionType === 'izin_sakit')
    .sort((a, b) => {
      const tA = safeParseDate(a.createdAt || a.clockInTime || a.date)?.getTime() || 0;
      const tB = safeParseDate(b.createdAt || b.clockInTime || b.date)?.getTime() || 0;
      return tB - tA;
    });

  // Log kehadiran lengkap (masuk, pulang, dan izin/sakit)
  const allLogs = [...userHistory].sort((a, b) => {
    const tA = safeParseDate(a.clockInTime || a.createdAt || a.date)?.getTime() || 0;
    const tB = safeParseDate(b.clockInTime || b.createdAt || b.date)?.getTime() || 0;
    return tB - tA;
  });

  const weekStart = getWeekStart();
  const monthStart = getMonthStart();
  const weekLogs = allLogs.filter((r) => {
    const d = safeParseDate(r.clockInTime || r.createdAt || r.date);
    return d ? d >= weekStart : false;
  });
  const monthLogs = allLogs.filter((r) => {
    const d = safeParseDate(r.clockInTime || r.createdAt || r.date);
    return d ? d >= monthStart : false;
  });

  // (Status izin aktif hari ini sudah didefinisikan secara komprehensif di bagian atas)

  const handleCancelLeaveAndClockIn = async (leaveId: string) => {
    closeAppDialog();
    setSubmitting(true);
    try {
      const res = await AttendanceService.cancelLeave(leaveId, todayStr, { full: true });
      if (res.success) {
        if (onRefreshData) await onRefreshData();
        else if (onUpdateUser) onUpdateUser(user);
        succeed();
        const hasMasuk = !!todayMasuk;
        openAppDialog({
          title: 'Izin Berhasil Disesuaikan',
          message: hasMasuk
            ? `Izin setengah hari telah dibatalkan. Anda tercatat bekerja penuh hari ini, jam kepulangan mengikuti jadwal normal kantor (${workEndStr} WIB).`
            : 'Sisa hari izin telah dicabut. Anda sekarang dapat melanjutkan presensi masuk.',
          icon: 'check-circle',
          variant: 'primary',
          confirmText: hasMasuk ? 'Mengerti' : 'Lanjut Presensi Masuk',
          onConfirm: () => {
            closeAppDialog();
            if (!hasMasuk) {
              setCameraVisible(true);
            }
          },
        });
      } else {
        fail();
        openAppDialog({
          title: 'Gagal Mencabut Izin',
          message: res.message,
          icon: 'alert-triangle',
          variant: 'danger',
        });
      }
    } catch (err: any) {
      fail();
      openAppDialog({
        title: 'Gagal Mencabut Izin',
        message: err?.message || 'Terjadi kesalahan pada sistem.',
        icon: 'alert-triangle',
        variant: 'danger',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTriggerAttendance = (targetMode: 'masuk' | 'pulang') => {
    select();
    setMode(targetMode);

    // 1. Jika ada izin seharian aktif (misal izin 4 hari, tapi masuk di hari ke-2/3): tawarkan cabut izin
    if (isFullLeaveActive && todayLeave) {
      openAppDialog({
        title: 'Izin Sedang Berjalan',
        message: `Anda tercatat memiliki izin aktif hingga ${todayLeave.endDate || todayLeave.date} (${todayLeave.approvalStatus === 'approved' ? 'sudah disetujui' : 'menunggu persetujuan'}). Apakah Anda sudah kembali bekerja dan ingin mencabut izin mulai hari ini?`,
        icon: 'calendar',
        variant: 'primary',
        singleButton: false,
        confirmText: 'Cabut Izin & Presensi',
        cancelText: 'Tetap Izin',
        onConfirm: () => handleCancelLeaveAndClockIn(todayLeave.id),
      });
      return;
    }

    // 2. Anti duplikat: sudah masuk/pulang hari ini -> cegah
    if (targetMode === 'masuk' && todayMasuk) {
      openAppDialog({
        title: 'Presensi Masuk Selesai',
        message: `Presensi masuk Anda untuk hari ini sudah tersimpan pada jam ${formatLogTime(todayMasuk.clockInTime)} WIB.`,
        icon: 'check-circle',
        variant: 'primary',
        confirmText: 'Mengerti',
      });
      return;
    }
    if (targetMode === 'masuk' && isTooEarlyCheckIn(new Date())) {
      openAppDialog({
        title: 'Belum Waktunya Absen Masuk',
        message: 'Absen masuk dibuka pukul ' + checkInOpensAt + ' WIB (' + earlyMin + ' menit sebelum jam masuk ' + workStartStr + ' WIB).',
        icon: 'clock',
        variant: 'primary',
        confirmText: 'Mengerti',
      });
      return;
    }
    if (targetMode === 'pulang' && todayPulang) {
      openAppDialog({
        title: 'Presensi Pulang Selesai',
        message: `Presensi pulang Anda untuk hari ini sudah tersimpan pada jam ${formatLogTime(todayPulang.clockInTime)} WIB.`,
        icon: 'check-circle',
        variant: 'primary',
        confirmText: 'Mengerti',
      });
      return;
    }

    // 2.B Sesi pulang memerlukan sesi masuk terlebih dahulu (kecuali izin setengah hari siang yang sudah disetujui)
    if (targetMode === 'pulang' && !todayMasuk && !isFullLeaveActive && !(isHalfDaySiang && isLeaveApproved)) {
      openAppDialog({
        title: 'Belum Absen Masuk',
        message: 'Silakan lakukan presensi Masuk terlebih dahulu sebelum melakukan presensi Pulang hari ini.',
        icon: 'sunrise',
        variant: 'primary',
        confirmText: 'Mengerti',
      });
      return;
    }

    // 3. Jika memilih mode pulang dan belum jam pulang
    if (targetMode === 'pulang' && !isClockOutUnlocked) {
      const targetTimeStr = isHalfDaySiang && isLeaveApproved
        ? `${String(halfDayOutH).padStart(2, '0')}:${String(halfDayOutM).padStart(2, '0')}`
        : workEndStr;
      openAppDialog({
        title: 'Belum Waktunya Pulang',
        message: `Presensi pulang dibuka ${clockOutCountdownText || `pukul ${targetTimeStr} WIB`}. Silakan tunggu hingga jam kepulangan${isHalfDaySiang && isLeaveApproved ? ' izin setengah hari' : ' kantor'}.`,
        icon: 'clock',
        variant: 'primary',
        confirmText: 'Tutup',
      });
      return;
    }

    // 4. Validasi berdasarkan opsi lokasi yang dipilih user di layar (Di Kantor vs Di Luar)
    if (place === 'kantor') {
      if (locError || gpsStale || currentDistance === null) {
        openAppDialog({
          title: 'Izin Lokasi Belum Aktif',
          message: 'Sistem memerlukan koordinat GPS untuk memvalidasi posisi Anda di kantor. Silakan aktifkan izin lokasi di browser/HP Anda lalu tekan Perbarui.',
          icon: 'map-pin',
          variant: 'danger',
          confirmText: 'Perbarui GPS Sekarang',
          onConfirm: fetchLocation,
        });
        return;
      }
      if (!isWithinRadius) {
        openAppDialog({
          title: 'Di Luar Radius Kantor',
          message: `Sistem mendeteksi Anda berjarak ${currentDistance !== null ? formatDistance(currentDistance) : 'jauh'} dari kantor (batas radius ${nearestOffice?.radiusMeters ?? 150} meter).

Apakah Anda sedang dinas luar atau tugas lapangan?`,
          icon: 'navigation',
          variant: 'primary',
          singleButton: false,
          confirmText: 'Beralih ke Presensi Di Luar',
          cancelText: 'Batal',
          onConfirm: () => {
            select();
            setPlace('luar');
            setTimeout(() => {
              reasonInputRef.current?.focus();
            }, 300);
          },
        });
        return;
      }
      setReason('');
      setCameraVisible(true);
      return;
    }

    // 5. Jika memilih 'Di Luar'
    if (place === 'luar') {
      if (!reason.trim()) {
        setReasonTouched(true);
        openAppDialog({
          title: 'Alasan Wajib Diisi',
          message: 'Silakan isi alasan presensi di luar kantor (contoh: meeting klien / dinas luar / kerja lapangan) pada kolom yang tersedia.',
          icon: 'alert-circle',
          variant: 'danger',
          confirmText: 'Isi Alasan',
        });
        return;
      }
      setCameraVisible(true);
      return;
    }
  };

  const handleMainAction = () => {
    handleTriggerAttendance(mode);
  };
  const handleLeaveFormSubmit = async (data: {
    startDate: string;
    endDate: string;
    reason: string;
    documentUrl?: string;
  }) => {
    setSubmitting(true);
    try {
      let publicDocUrl: string | undefined = undefined;
      const localDoc = data.documentUrl;
      if (localDoc && !localDoc.startsWith('http')) {
        const fileName = localDoc.split('/').pop() || 'dokumen';
        publicDocUrl = await StorageService.uploadDocument(user.id, fileName, localDoc);
      } else if (localDoc) {
        publicDocUrl = localDoc;
      }

      await onClockIn({
        type: 'izin_sakit',
        sessionType: 'izin_sakit',
        latitude: currentCoords.latitude,
        longitude: currentCoords.longitude,
        reason: data.reason,
        startDate: data.startDate,
        endDate: data.endDate,
        documentUrl: publicDocUrl,
      });

      const isTelatRequest = data.reason.includes('[TELAT');
      succeed();
      openAppDialog({
        title: isTelatRequest ? 'Izin Telat Terkirim' : 'Pengajuan Terkirim',
        message: isTelatRequest
          ? 'Pemberitahuan terlambat berhasil dikirim dan menunggu persetujuan admin. Anda tetap dapat melakukan presensi masuk.'
          : 'Pengajuan izin/sakit berhasil dikirim dan menunggu persetujuan admin.',
        icon: 'check-circle',
        variant: 'primary',
        confirmText: 'Selesai',
      });
      if (!isTelatRequest) setActiveTab('presensi');
    } catch (e: any) {
      fail();
      openAppDialog({
        title: 'Gagal Mengajukan',
        message: e?.message || 'Pengajuan gagal dikirim. Silakan coba lagi.',
        icon: 'alert-triangle',
        variant: 'danger',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPhotoSubmit = async (photoUri: string) => {
    setSubmitting(true);
    try {
      // 1. Upload swafoto ke Storage dulu -> dapat URL publik.
      const publicPhotoUrl = await StorageService.uploadAttendancePhoto(user.id, photoUri);

      if (pendingLeaveData) {
        // Dokumen izin selama ini cuma path lokal HP -> upload juga bila ada.
        let publicDocUrl: string | undefined = undefined;
        const localDoc = pendingLeaveData.documentUrl;
        if (localDoc && !localDoc.startsWith('http')) {
          const fileName = localDoc.split('/').pop() || 'dokumen';
          publicDocUrl = await StorageService.uploadDocument(user.id, fileName, localDoc);
        } else if (localDoc) {
          publicDocUrl = localDoc;
        }

        await onClockIn({
          type: 'izin_sakit',
          sessionType: 'izin_sakit',
          reason: pendingLeaveData.reason,
          startDate: pendingLeaveData.startDate,
          endDate: pendingLeaveData.endDate,
          documentUrl: publicDocUrl,
          photoUrl: publicPhotoUrl,
        });
        setPendingLeaveData(null);
      } else {
        const now = new Date();
        const isLate =
          mode === 'masuk' &&
          (nightShift ? isLateForShift(nightShift, sinceStart(now)) : isAfterTimeOfDay(now, lateH, lateM));
        let finalReason = place === 'luar' ? reason.trim() : undefined;
        if (isLate) {
          finalReason = finalReason ? `${finalReason} (Terlambat: Masuk > ${lateDeadStr})` : `Terlambat (> ${lateDeadStr} WIB)`;
        }

        await onClockIn({
          type: place === 'kantor' ? 'luring' : 'daring',
          sessionType: mode,
          latitude: currentCoords.latitude,
          longitude: currentCoords.longitude,
          distanceMeters: place === 'kantor' ? (currentDistance || 0) : 0,
          officeName: place === 'kantor' ? nearestOffice?.officeName : 'Di Luar Kantor',
          officeColor: place === 'kantor' ? nearestOffice?.color : undefined,
          reason: finalReason,
          photoUrl: publicPhotoUrl,
          workDate: todayStr,
        });
        setReason('');
      }
      setLastSavedAt(new Date().toISOString());
      succeed();
      setCameraVisible(false);

      // Smooth auto-redirect scroll ke paling atas dashboard
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }, 150);

      const sesiLabel = mode === 'masuk' ? 'masuk' : 'pulang';
      openAppDialog({
        title: 'Presensi Berhasil Dicatat!',
        message: pendingLeaveData
          ? 'Pengajuan izin berhasil dikirim dan menunggu persetujuan admin.'
          : `Presensi ${sesiLabel} Anda (${place === 'kantor' ? 'Di Kantor' : 'Di Luar Kantor'}) berhasil disimpan di sistem.`,
        icon: 'check-circle',
        variant: 'primary',
        confirmText: 'Selesai',
        onConfirm: () => {
          closeAppDialog();
          if (mode === 'masuk') {
            setMode('pulang');
          }
        },
      });
    } catch (e: any) {
      fail();
      openAppDialog({
        title: 'Gagal Menyimpan',
        message: e?.message || 'Upload foto atau simpan presensi gagal. Silakan coba lagi.',
        icon: 'x-circle',
        variant: 'danger',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const isSessionDone = !!
    ((mode === 'masuk' && todayMasuk) || (mode === 'pulang' && todayPulang));

  const mainButtonTitle =
    isFullLeaveActive && todayLeave
      ? `Masuk Kerja (Cabut Izin & Absen Masuk)`
      : isHalfDayLeave && todayLeave
      ? `Presensi ${mode === 'masuk' ? 'Masuk' : 'Pulang'} (Izin Setengah Hari)`
      : isSessionDone
      ? `Presensi ${mode === 'masuk' ? 'Masuk' : 'Pulang'} Sudah Selesai`
      : mode === 'masuk'
        ? isLateCheckIn
          ? 'Ambil Foto & Absen Masuk (Terlambat)'
          : 'Ambil Foto & Absen Masuk'
        : !isClockOutUnlocked
          ? `Presensi Pulang Terkunci (${clockOutCountdownText || 'Buka 17:00'})`
          : 'Ambil Foto & Absen Pulang';

  const renderLogRow = (item: AttendanceRecord) => {
    const isLemburReason = !!item.reason && item.reason.includes('[LEMBUR]');
    const isTelatReason = !isLemburReason && !!item.reason && item.reason.includes('[TELAT');
    const isLeave =
      (item.type === 'izin_sakit' || item.sessionType === 'izin_sakit') &&
      !isLemburReason &&
      !isTelatReason;
    const isMasuk = item.sessionType === 'masuk';
    // Absen di Sabtu/Minggu atau Hari Libur Nasional = lembur (override tanggal merah)
    const isLemburWeekend =
      !isLeave &&
      !isLemburReason &&
      !isTelatReason &&
      (isWeekendDateString(item.date) || isNationalHoliday(item.date)) &&
      (item.sessionType === 'masuk' || item.sessionType === 'pulang');

    const logTitleText = isLemburReason || isLemburWeekend
      ? (isLemburReason ? 'Pengajuan Lembur' : 'Lembur')
      : isTelatReason
      ? 'Izin Telat'
      : isLeave
      ? (item.status === 'sakit' ? 'Sakit' : 'Izin')
      : isMasuk
      ? 'Masuk'
      : 'Pulang';

    return (
      <TouchableOpacity
        key={item.id}
        activeOpacity={0.7}
        onPress={() => setSelectedLog(item)}
        style={styles.logRow}
      >
        {item.photoUrl ? (
          <Image
            source={{ uri: resolveMediaUrl(item.photoUrl) || item.photoUrl }}
            style={styles.logThumb}
          />
        ) : (
          <View style={styles.logFallback}>
            <Feather
              name={
                isLemburReason
                  ? 'zap'
                  : isTelatReason
                  ? 'clock'
                  : isLeave
                  ? (item.status === 'sakit' ? 'activity' : 'calendar')
                  : 'camera'
              }
              size={20}
              color={isLemburReason ? '#D97706' : isTelatReason ? '#B45309' : colors.faint}
            />
          </View>
        )}
        <View style={styles.logInfo}>
          <Text style={styles.logTitle}>
            {logTitleText}
            {' • '}
            {formatLogDate(item.clockInTime || item.createdAt || item.date)}
          </Text>
          <Text style={styles.logSub}>
            {isLeave || isLemburReason || isTelatReason
              ? `Pengajuan: ${item.startDate || item.date} s.d. ${item.endDate || item.date}`
              : `${formatLogTime(item.clockInTime)} WIB${item.distanceMeters ? ` • ${item.distanceMeters} m` : ''}`}
            {item.officeName && !isLeave && !isLemburReason && !isTelatReason ? (
              <>
                {' • '}
                {item.officeColor ? <Text style={{ color: item.officeColor }}>● </Text> : null}
                {item.officeName}
              </>
            ) : ''}
          </Text>
        </View>
        {isLemburReason ? (
          item.approvalStatus === 'pending' ? (
            <Badge type="menunggu" size="sm" label="Lembur (Menunggu)" />
          ) : item.approvalStatus === 'rejected' ? (
            <Badge type="ditolak" size="sm" label="Lembur (Ditolak)" />
          ) : (
            <Badge type="lembur" size="sm" />
          )
        ) : isTelatReason ? (
          item.approvalStatus === 'pending' ? (
            <Badge type="menunggu" size="sm" label="Telat (Menunggu)" />
          ) : item.approvalStatus === 'rejected' ? (
            <Badge type="ditolak" size="sm" label="Telat (Ditolak)" />
          ) : (
            <Badge type="telat" size="sm" />
          )
        ) : item.type === 'izin_sakit' && item.approvalStatus === 'pending' ? (
          <Badge type="menunggu" size="sm" />
        ) : item.type === 'izin_sakit' && item.approvalStatus === 'rejected' ? (
          <Badge type="ditolak" size="sm" />
        ) : (
          <Badge type={item.type} size="sm" />
        )}
      </TouchableOpacity>
    );
  };

  const confirmLogout = () => {
    setShowLogoutDialog(true);
  };

  const renderEmptyLogs = () => (
    <View style={styles.emptyBox}>
      <Feather name="calendar" size={32} color={colors.faint} />
      <Text style={styles.emptyText}>Tidak ada data</Text>
    </View>
  );

  const renderPresensiTab = () => (
    <View style={{ flex: 1 }}>
      {/* Toast "belum absen" */}
      {toastVisible && (
        <Animated.View style={[styles.toast, neoShadow.md, { transform: [{ translateY: toastSlide }] }]}>
          <Feather name="alert-circle" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.toastText}>Anda belum melakukan presensi hari ini.</Text>
          <TouchableOpacity onPress={dismissToast} hitSlop={12} style={styles.toastClose}>
            <Feather name="x" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>
      )}

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. Header Profil Ramah */}
        <View style={[styles.welcomeCard, neoShadow.sm]}>
          <View style={styles.welcomeTopRow}>
            <Image
              source={require('../../../assets/logo-cakra.png')}
              style={styles.welcomeLogo}
              resizeMode="contain"
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.welcomeAppSubtitle}>PresensiPro</Text>
              <Text style={styles.welcomeGreeting} numberOfLines={1}>
                Selamat datang, {firstName}
              </Text>
            </View>
            <NotificationBell userId={user.id} />
            <View style={styles.dateBadgeMini}>
              <Text style={styles.dateBadgeMiniText}>
                {String(curHour).padStart(2, '0')}:{String(curMin).padStart(2, '0')} WIB
              </Text>
            </View>
          </View>

          <View style={styles.welcomeDivider} />

          <View style={styles.welcomeBottomRow}>
            <View style={styles.welcomeShiftWrap}>
              <Feather name="clock" size={12} color={colors.primaryDark} style={{ marginRight: 4 }} />
              <Text style={styles.welcomeShiftText}>
                {isLemburDay
                  ? `${getHolidayName(todayStr) || (isTodayWeekend ? 'Akhir Pekan' : 'Hari Libur')} (Lembur)`
                  : `${myShift ? myShift.name + ' · ' : ''}${workStartStr} - ${workEndStr} WIB`}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                select();
                setActiveTab('kalender');
              }}
              style={styles.welcomeRecapLink}
            >
              <Text style={styles.welcomeRecapText}>
                {onTimeCount} Hadir • {leaveCount} Izin
              </Text>
              <Feather name="chevron-right" size={13} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Banner Status Presensi Hari Ini (Jika sudah pernah absen) */}
        {(todayMasuk || todayPulang) && (
          <View style={[styles.todaySuccessBanner, neoShadow.sm]}>
            <Feather name="check-circle" size={18} color={colors.successInk} style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.todaySuccessTitle}>
                {todayMasuk && todayPulang
                  ? `Presensi hari ini lengkap: Masuk (${formatLogTime(todayMasuk.clockInTime)}) • Pulang (${formatLogTime(todayPulang.clockInTime)}) WIB`
                  : todayMasuk
                  ? `Presensi masuk sudah tercatat jam ${formatLogTime(todayMasuk.clockInTime)} WIB`
                  : `Presensi pulang sudah tercatat jam ${formatLogTime(todayPulang!.clockInTime)} WIB`}
              </Text>
              {lastSavedAt && (
                <Text style={styles.todaySuccessSub}>
                  Tersimpan di server: {formatLogTime(lastSavedAt)} WIB
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Banner Status Izin / Sakit Hari Ini */}
        {todayLeave && (
          <View style={[styles.todayLeaveBanner, neoShadow.sm]}>
            <View style={styles.todayLeaveTopRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <View style={[
                  styles.leaveCategoryIconWrap,
                  { backgroundColor: todayLeave.status === 'sakit' ? colors.izinSoft : colors.primarySoft }
                ]}>
                  <Feather
                    name={todayLeave.status === 'sakit' ? 'activity' : 'calendar'}
                    size={15}
                    color={todayLeave.status === 'sakit' ? colors.izin : colors.primary}
                  />
                </View>
                <View>
                  <Text style={styles.todayLeaveTitle}>
                    Status Hari Ini: Pengajuan {todayLeave.status === 'sakit' ? 'Sakit' : 'Izin'}
                  </Text>
                  <Text style={styles.todayLeaveSub}>
                    Periode: {todayLeave.startDate || todayLeave.date} s.d. {todayLeave.endDate || todayLeave.date}
                  </Text>
                </View>
              </View>
              <View style={[
                styles.leaveApprovalBadge,
                todayLeave.approvalStatus === 'approved' && { backgroundColor: colors.successSoft },
                todayLeave.approvalStatus === 'rejected' && { backgroundColor: colors.dangerSoft },
                todayLeave.approvalStatus === 'pending' && { backgroundColor: colors.pulangSoft },
              ]}>
                <Feather
                  name={
                    todayLeave.approvalStatus === 'approved'
                      ? 'check-circle'
                      : todayLeave.approvalStatus === 'rejected'
                      ? 'x-circle'
                      : 'clock'
                  }
                  size={12}
                  color={
                    todayLeave.approvalStatus === 'approved'
                      ? colors.successInk
                      : todayLeave.approvalStatus === 'rejected'
                      ? colors.danger
                      : colors.pulang
                  }
                  style={{ marginRight: 4 }}
                />
                <Text style={[
                  styles.leaveApprovalBadgeText,
                  todayLeave.approvalStatus === 'approved' && { color: colors.successInk },
                  todayLeave.approvalStatus === 'rejected' && { color: colors.danger },
                  todayLeave.approvalStatus === 'pending' && { color: colors.pulang },
                ]}>
                  {todayLeave.approvalStatus === 'approved'
                    ? 'Disetujui'
                    : todayLeave.approvalStatus === 'rejected'
                    ? 'Ditolak'
                    : 'Menunggu Persetujuan'}
                </Text>
              </View>
            </View>

            {todayLeave.reason ? (
              <Text style={styles.todayLeaveReasonText}>Alasan: "{todayLeave.reason}"</Text>
            ) : null}

            {todayLeave.reviewNote ? (
              <View style={styles.todayLeaveNoteBox}>
                <Text style={styles.todayLeaveNoteText}>
                  Catatan Admin: {todayLeave.reviewNote}
                </Text>
              </View>
            ) : null}

            {todayLeave.approvalStatus !== 'rejected' && !todayPulang && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  select();
                  const isSiang = isHalfDaySiang;
                  const promptMsg = isSiang
                    ? `Apakah Anda ingin membatalkan izin setengah hari ini dan bekerja penuh sampai jam kerja normal kantor (${workEndStr} WIB)?`
                    : `Apakah Anda ingin mencabut izin untuk hari ini (${todayStr}) karena sudah kembali masuk kerja? Anda akan dapat langsung melakukan presensi masuk.`;
                  openAppDialog({
                    title: isSiang ? 'Batal Izin Setengah Hari?' : 'Cabut Izin Hari Ini?',
                    message: promptMsg,
                    icon: 'calendar',
                    variant: 'primary',
                    singleButton: false,
                    confirmText: isSiang ? 'Ya, Kerja Penuh' : 'Ya, Cabut Izin',
                    cancelText: 'Batal',
                    onConfirm: () => handleCancelLeaveAndClockIn(todayLeave.id),
                  });
                }}
                style={styles.cancelLeaveBannerBtn}
              >
                <Feather name="user-check" size={14} color={colors.primaryDark} style={{ marginRight: 6 }} />
                <Text style={styles.cancelLeaveBannerBtnText}>
                  {isHalfDaySiang ? 'Batalkan Izin Siang (Kerja Penuh)' : 'Cabut Izin Hari Ini (Masuk Kerja)'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 2. SECTION: Lokasimu Saat Ini */}
        <View style={styles.sectionHeaderWrap}>
          <Text style={styles.sectionTitleMain}>Lokasimu Saat Ini</Text>
          <Text style={styles.sectionSubtitleMain}>Pastikan lokasi perangkat sudah sesuai.</Text>
        </View>

        <View style={[styles.modernMapCard, neoShadow.sm]}>
          <MapView
            userLat={currentCoords.latitude}
            userLng={currentCoords.longitude}
            officeLat={nearestOffice?.latitude ?? -7.23707}
            officeLng={nearestOffice?.longitude ?? 112.6346}
            radiusMeters={nearestOffice?.radiusMeters ?? 150}
            offices={offices}
            activeOfficeId={nearestOffice?.id}
            mainColor={nearestOffice?.color ?? colors.primary}
            height={165}
          />

          {/* Bottom-Left Overlay Floating Pill (Lokasi Terdeteksi) */}
          <View style={[styles.mapFloatingPill, neoShadow.sm]}>
            <View
              style={[
                styles.mapPillDot,
                {
                  backgroundColor:
                    locError || gpsStale || currentDistance === null
                      ? colors.warning
                      : isWithinRadius
                      ? '#16A34A'
                      : colors.warning,
                },
              ]}
            />
            <Text style={styles.mapFloatingPillText} numberOfLines={1}>
              {locLoading
                ? 'Mendeteksi GPS...'
                : locError || gpsStale || currentDistance === null
                ? 'Izin GPS belum aktif'
                : isWithinRadius
                ? `Lokasi terdeteksi • ${currentDistance !== null ? formatDistance(currentDistance) : ''}`
                : `Di luar radius (${currentDistance !== null ? formatDistance(currentDistance) : ''})`}
            </Text>
          </View>

          {/* Bottom-Right Floating Target Button (FAB Refresh) */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={fetchLocation}
            style={[styles.mapFloatingFab, neoShadow.sm]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Perbarui GPS"
          >
            <Feather name="crosshair" size={18} color={colors.primaryDark} />
          </TouchableOpacity>
        </View>

        {/* Pilihan Lokasi Kehadiran: Di Kantor vs Di Luar */}
        <View style={styles.placeSelectorContainer}>
          <View style={styles.placePillSwitchBar}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                select();
                setPlace('kantor');
              }}
              style={[styles.placePillOption, place === 'kantor' && styles.placePillOptionActiveKantor]}
            >
              <Feather
                name="briefcase"
                size={15}
                color={place === 'kantor' ? '#FFFFFF' : '#0066FF'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.placePillOptionText, place === 'kantor' && styles.placePillOptionTextActive]}>
                Di Kantor
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                select();
                setPlace('luar');
              }}
              style={[styles.placePillOption, place === 'luar' && styles.placePillOptionActiveLuar]}
            >
              <Feather
                name="navigation"
                size={15}
                color={place === 'luar' ? '#FFFFFF' : '#FF6B00'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.placePillOptionText, place === 'luar' && styles.placePillOptionTextActive]}>
                Di Luar
              </Text>
            </TouchableOpacity>
          </View>

          {place === 'luar' && (
            <View style={styles.reasonCardInlineModern}>
              <Text style={[styles.reasonLabel, reasonTouched && !reason.trim() && { color: colors.danger }]}>
                Alasan Presensi di Luar Kantor (Wajib)
              </Text>
              <TextInput
                ref={reasonInputRef}
                style={[
                  styles.reasonInput,
                  reasonTouched && !reason.trim() && styles.reasonInputError,
                ]}
                placeholder="Contoh: Dinas meeting klien / kunjungan proyek lapangan"
                placeholderTextColor={colors.faint}
                value={reason}
                onChangeText={(text) => {
                  setReason(text);
                  if (text.trim() && reasonTouched) setReasonTouched(false);
                }}
              />
              {reasonTouched && !reason.trim() && (
                <Text style={styles.fieldError}>Isi alasan sebelum melakukan presensi.</Text>
              )}
            </View>
          )}
        </View>

        {/* Banner peringatan: sudah lewat batas terlambat kantor tapi belum absen masuk */}
        {isLateCheckIn && !todayMasuk && !isFullLeaveActive && (
          <View style={styles.lateAlert} accessibilityRole="alert">
            <Feather name="alert-triangle" size={18} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.lateAlertTitle}>Anda melewati batas terlambat ({lateDeadStr} WIB)</Text>
              <Text style={styles.lateAlertSub}>
                {todayTelatNotice
                  ? 'Pemberitahuan terlambat Anda sudah terkirim. Segera lakukan absen masuk, presensi akan tercatat Terlambat.'
                  : 'Absen masuk tetap bisa dilakukan, tetapi akan tercatat Terlambat.'}
              </Text>
            </View>
          </View>
        )}

        {/* 3. SECTION: Pilih Kehadiran */}
        <View style={styles.sectionHeaderWrap}>
          <Text style={styles.sectionTitleMain}>Pilih Kehadiran</Text>
          <Text style={styles.sectionSubtitleMain}>Silakan pilih Masuk atau Pulang.</Text>
        </View>

        <View style={styles.colourCardsDuoRow}>
          {/* KARTU HIJAU SOLID: MASUK */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => handleTriggerAttendance('masuk')}
            style={[
              styles.colourCard,
              styles.masukCardBg,
              todayMasuk && styles.masukCardDoneBg,
              neoShadow.sm,
            ]}
          >
            <View style={styles.colourCardTopRow}>
              <View style={styles.colourIconBox}>
                <Feather
                  name={todayMasuk ? 'check-circle' : 'sun'}
                  size={20}
                  color="#FFFFFF"
                />
              </View>
              {todayMasuk ? (
                <View style={styles.donePillTag}>
                  <Text style={styles.donePillTagText}>Terekan</Text>
                </View>
              ) : tooEarlyNow ? (
                <View style={styles.lockPillTag}>
                  <Text style={styles.lockPillTagText}>Kunci</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.colourCardContent}>
              <Text style={styles.colourCardActionText}>Masuk</Text>
              <Text style={styles.colourCardSubText} numberOfLines={1}>
                {todayMasuk
                  ? `✓ Jam ${formatLogTime(todayMasuk.clockInTime)} WIB`
                  : isLemburDay
                  ? 'Presensi Lembur'
                  : tooEarlyNow
                  ? 'Buka ' + checkInOpensAt + ' WIB'
                  : 'Presensi Pagi'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* KARTU ORANYE SOLID: PULANG */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => handleTriggerAttendance('pulang')}
            style={[
              styles.colourCard,
              styles.pulangCardBg,
              todayPulang && styles.pulangCardDoneBg,
              !isClockOutUnlocked && !todayPulang && styles.pulangCardLockedBg,
              neoShadow.sm,
            ]}
          >
            <View style={styles.colourCardTopRow}>
              <View style={styles.colourIconBox}>
                <Feather
                  name={todayPulang ? 'check-circle' : !isClockOutUnlocked && !todayPulang ? 'lock' : 'sunset'}
                  size={20}
                  color="#FFFFFF"
                />
              </View>
              {todayPulang ? (
                <View style={styles.donePillTag}>
                  <Text style={styles.donePillTagText}>Terekan</Text>
                </View>
              ) : !isClockOutUnlocked ? (
                <View style={styles.lockPillTag}>
                  <Text style={styles.lockPillTagText}>Kunci</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.colourCardContent}>
              <Text style={styles.colourCardActionText}>Pulang</Text>
              <Text style={styles.colourCardSubText} numberOfLines={1}>
                {todayPulang
                  ? `✓ Jam ${formatLogTime(todayPulang.clockInTime)} WIB`
                  : !isClockOutUnlocked
                  ? (clockOutCountdownText ? `Buka dlm ${clockOutCountdownText}` : `Buka ${workEndStr} WIB`)
                  : 'Presensi Sore'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {!todayMasuk && !isLemburDay && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              select();
              setLeaveCategoryFilter('telat');
              setLeaveViewMode('create');
              setActiveTab('izin');
            }}
            style={[styles.lateQuickBtn, neoShadow.sm]}
          >
            <View style={styles.lateQuickIcon}>
              <Feather name="clock" size={16} color="#B45309" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.lateQuickTitle}>Terlambat datang?</Text>
              <Text style={styles.lateQuickSub}>
                Beri tahu admin (macet, tambal ban, keperluan mendadak)
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color="#B45309" />
          </TouchableOpacity>
        )}

        {/* 4. SECTION: Kehadiran Minggu Ini */}
        <View style={styles.historySectionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitleMain}>Kehadiran Minggu Ini</Text>
            <Text style={styles.sectionSubtitleMain}>{weekLogs.length} riwayat presensi</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              select();
              setActiveTab('kalender');
            }}
            style={styles.showAllLinkBtn}
          >
            <Text style={styles.showAllLinkBtnText}>Tampilkan Semua</Text>
            <Feather name="chevron-right" size={13} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={[styles.modernLedgerCard, neoShadow.sm]}>
          {weekLogs.length === 0 ? renderEmptyLogs() : weekLogs.map(renderLogRow)}
        </View>
      </ScrollView>
    </View>
  );

  const renderKalenderTab = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
    >
      <View style={styles.tabHeaderRow}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.greeting}>Kalender Absensi</Text>
          <Text style={styles.date}>Pantau rekap kehadiran dan status bulanan Anda</Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => {
            select();
            printAttendanceSlip({
              user,
              year: calYear,
              month: calMonth,
              records: userHistory,
            });
          }}
          style={styles.printSlipBtn}
          accessibilityRole="button"
          accessibilityLabel="Cetak Slip Presensi"
        >
          <Feather name="printer" size={15} color={colors.primaryDark} style={{ marginRight: 6 }} />
          <Text style={styles.printSlipText}>Cetak Slip (PDF)</Text>
        </TouchableOpacity>
      </View>

      <Card style={styles.logCard}>
        <MonthAttendanceCalendar
          attendances={userHistory}
          year={calYear}
          month={calMonth}
          userCreatedAt={user.createdAt}
          onMonthChange={(y, m) => {
            setCalYear(y);
            setCalMonth(m);
            setCalDay(null);
          }}
          selectedDay={calDay}
          onSelectDay={(d) => setCalDay((prev) => (prev === d ? null : d))}
        />
        {calDay !== null && (
          <View style={styles.calDetailBox}>
            <Text style={styles.calDetailTitle}>
              {calDay}{' '}
              {new Date(calYear, calMonth, 1).toLocaleDateString('id-ID', {
                month: 'long',
                year: 'numeric',
              })}
            </Text>
            {(() => {
              const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(calDay).padStart(2, '0')}`;
              const dayLogs = userHistory.filter((r) => r.date === key);
              const holidayName = getHolidayName(key);
              if (dayLogs.length === 0) {
                if (holidayName) {
                  return (
                    <View style={styles.holidayBannerBox}>
                      <Feather name="flag" size={16} color={colors.danger} style={{ marginRight: 8 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.holidayBannerTitle}>Libur Nasional</Text>
                        <Text style={styles.holidayBannerSub}>{holidayName}</Text>
                      </View>
                    </View>
                  );
                }
                const isWeekend = isWeekendDateString(key);
                if (isWeekend) {
                  return <Text style={styles.calDetailEmpty}>Hari libur akhir pekan (Sabtu/Minggu).</Text>;
                }
                const joinDate = user.createdAt ? user.createdAt.slice(0, 10) : null;
                if (joinDate && key < joinDate) {
                  return <Text style={[styles.calDetailEmpty, { color: colors.muted }]}>Belum terdaftar sebagai karyawan pada tanggal ini.</Text>;
                }
                return <Text style={styles.calDetailEmpty}>Tidak ada absen di tanggal ini.</Text>;
              }
              return dayLogs.map(renderLogRow);
            })()}
          </View>
        )}
      </Card>
    </ScrollView>
  );

  const renderIzinTab = () => {
    if (leaveViewMode === 'create') {
      return (
        <View style={{ flex: 1 }}>
          <LeaveRequestForm
            initialCategory={leaveCategoryFilter}
            onSubmit={async (data) => {
              await handleLeaveFormSubmit(data);
              setLeaveViewMode('list');
            }}
            onBack={() => setLeaveViewMode('list')}
            loading={submitting}
            leaveQuota={user.leaveQuota ?? DEFAULT_LEAVE_QUOTA}
            leaveUsedFor={(year) => leaveDaysUsed(userHistory, user.id, year, true)}
          />
        </View>
      );
    }

    const filteredUserLeaves = userLeaves.filter((item) => {
      const isLembur = Boolean(item.reason && item.reason.includes('[LEMBUR]'));
      const isTelat = !isLembur && Boolean(item.reason && item.reason.includes('[TELAT'));
      const isSakit = !isLembur && !isTelat && (item.status === 'sakit' || Boolean(item.reason && item.reason.includes('[SAKIT]')));
      if (leaveCategoryFilter === 'lembur') return isLembur;
      if (leaveCategoryFilter === 'telat') return isTelat;
      if (leaveCategoryFilter === 'sakit') return isSakit;
      if (leaveCategoryFilter === 'izin') return !isLembur && !isSakit && !isTelat;
      return true;
    });

    const filterOptions: Array<{
      key: 'izin' | 'sakit' | 'lembur' | 'telat';
      label: string;
      icon: keyof typeof Feather.glyphMap;
      color: string;
    }> = [
      { key: 'izin', label: 'Izin (Penuh / 1/2 Hari)', icon: 'calendar', color: colors.primary },
      { key: 'sakit', label: 'Sakit', icon: 'activity', color: colors.izin },
      { key: 'telat', label: 'Izin Telat', icon: 'clock', color: '#B45309' },
      { key: 'lembur', label: 'Lembur', icon: 'zap', color: '#D97706' },
    ];
    const currentFilterOpt = filterOptions.find((o) => o.key === leaveCategoryFilter) || filterOptions[0];

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* Header Bersih Tanpa Tombol + Ajukan Baru */}
        <View style={styles.tabHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Pengajuan Keperluan</Text>
            <Text style={styles.date}>Pantau status izin, sakit, izin telat, dan penugasan lembur dari admin cabang</Text>
          </View>
        </View>

        {hasAnyShift && (
          <ShiftSwapPanel user={user} shifts={companyShifts} swaps={mySwaps} onChanged={loadSwaps} />
        )}

        {/* Dropdown Kategori Pengajuan (Izin, Sakit, Izin Telat, Lembur — Tanpa Opsi Semua) */}
        <View style={styles.dropdownSectionWrap}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              select();
              setShowCategoryDropdown((prev) => !prev);
            }}
            style={[styles.dropdownTriggerBtn, neoShadow.sm]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
              <View style={[styles.dropdownIconCircle, { backgroundColor: currentFilterOpt.color + '1A' }]}>
                <Feather name={currentFilterOpt.icon} size={16} color={currentFilterOpt.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dropdownSubLabel}>Kategori Keperluan</Text>
                <Text style={styles.dropdownActiveLabel}>{currentFilterOpt.label}</Text>
              </View>
            </View>
            <Feather
              name={showCategoryDropdown ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.ink}
            />
          </TouchableOpacity>

          {showCategoryDropdown && (
            <View style={[styles.dropdownMenuCard, neoShadow.md]}>
              {filterOptions.map((opt) => {
                const isSelected = leaveCategoryFilter === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    activeOpacity={0.7}
                    onPress={() => {
                      select();
                      setLeaveCategoryFilter(opt.key);
                      setShowCategoryDropdown(false);
                    }}
                    style={[
                      styles.dropdownMenuItem,
                      isSelected && styles.dropdownMenuItemActive,
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <Feather name={opt.icon} size={16} color={opt.color} />
                      <Text
                        style={[
                          styles.dropdownMenuItemText,
                          isSelected && styles.dropdownMenuItemTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </View>
                    {isSelected && (
                      <Feather name="check" size={16} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {filteredUserLeaves.length === 0 ? (
          <View style={[styles.emptyLeaveCard, neoShadow.sm]}>
            <View style={styles.emptyLeaveIconWrap}>
              <Feather name={currentFilterOpt.icon} size={32} color={currentFilterOpt.color} />
            </View>
            <Text style={styles.emptyLeaveTitle}>Belum Ada Pengajuan {currentFilterOpt.label.split(' ')[0]}</Text>
            <Text style={styles.emptyLeaveSub}>
              {leaveCategoryFilter === 'lembur'
                ? 'Belum ada catatan tugas lembur. Tekan tombol di bawah untuk membuat penugasan lembur baru.'
                : leaveCategoryFilter === 'telat'
                ? 'Belum ada pemberitahuan terlambat. Tekan tombol di bawah bila Anda terlambat datang karena keperluan mendadak.'
                : leaveCategoryFilter === 'sakit'
                ? 'Belum ada surat izin sakit yang diajukan ke admin cabang.'
                : 'Belum ada permohonan izin cuti atau keperluan mendesak yang diajukan.'}
            </Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                select();
                setLeaveViewMode('create');
              }}
              style={styles.emptyActionBtn}
            >
              <Feather name="plus" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.emptyActionBtnText}>Buat Pengajuan Sekarang</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {filteredUserLeaves.map((item) => {
              const isLembur = Boolean(item.reason && item.reason.includes('[LEMBUR]'));
              const isTelat = !isLembur && Boolean(item.reason && item.reason.includes('[TELAT'));
              const isSakit = !isLembur && !isTelat && (item.status === 'sakit' || Boolean(item.reason && item.reason.includes('[SAKIT]')));
              const isApproved = item.approvalStatus === 'approved';
              const isRejected = item.approvalStatus === 'rejected';
              const isPending = item.approvalStatus === 'pending';

              const badgeBg = isApproved
                ? colors.successSoft
                : isRejected
                ? colors.dangerSoft
                : colors.pulangSoft;

              const badgeText = isApproved
                ? colors.successInk
                : isRejected
                ? colors.danger
                : colors.pulang;

              const statusLabel = isApproved
                ? 'Disetujui Admin'
                : isRejected
                ? 'Ditolak'
                : 'Menunggu Persetujuan';

              return (
                <View key={item.id} style={[styles.leaveHistoryCard, neoShadow.sm]}>
                  <View style={styles.leaveHistoryTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <View style={[
                        styles.leaveHistoryIconWrap,
                        {
                          backgroundColor: isLembur
                            ? '#FEF3C7'
                            : isTelat
                            ? '#FEF3C7'
                            : isSakit
                            ? colors.izinSoft
                            : colors.primarySoft,
                        }
                      ]}>
                        <Feather
                          name={isLembur ? 'zap' : isTelat ? 'clock' : isSakit ? 'activity' : 'calendar'}
                          size={18}
                          color={isLembur ? '#D97706' : isTelat ? '#B45309' : isSakit ? colors.izin : colors.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.leaveHistoryTitle}>
                          {isLembur
                            ? 'Penugasan Lembur'
                            : isTelat
                            ? 'Izin Terlambat'
                            : isSakit
                            ? 'Surat Sakit'
                            : item.reason && item.reason.includes('SETENGAH HARI')
                            ? 'Izin Setengah Hari'
                            : 'Pengajuan Izin'}
                        </Text>
                        <Text style={styles.leaveHistoryDates}>
                          {item.startDate || item.date} s.d. {item.endDate || item.date}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.leaveStatusPill, { backgroundColor: badgeBg }]}>
                      <Feather
                        name={isApproved ? 'check-circle' : isRejected ? 'x-circle' : 'clock'}
                        size={12}
                        color={badgeText}
                        style={{ marginRight: 4 }}
                      />
                      <Text style={[styles.leaveStatusPillText, { color: badgeText }]}>
                        {statusLabel}
                      </Text>
                    </View>
                  </View>

                  {item.reason ? (
                    <View style={styles.leaveReasonBox}>
                      <Text style={styles.leaveReasonLabel}>Keterangan Alasan:</Text>
                      <Text style={styles.leaveReasonContent}>"{item.reason}"</Text>
                    </View>
                  ) : null}

                  {item.reviewNote ? (
                    <View style={styles.leaveAdminNoteBox}>
                      <Text style={styles.leaveAdminNoteLabel}>Catatan dari Admin Cabang:</Text>
                      <Text style={styles.leaveAdminNoteContent}>"{item.reviewNote}"</Text>
                    </View>
                  ) : null}

                  {(item.documentUrl || item.photoUrl) ? (
                    <View style={styles.leaveAttachmentRow}>
                      {item.documentUrl ? (
                        <TouchableOpacity
                          style={styles.attachmentChip}
                          onPress={() => setSelectedLog(item)}
                          activeOpacity={0.7}
                        >
                          <Feather name="paperclip" size={13} color={colors.primaryDark} style={{ marginRight: 4 }} />
                          <Text style={styles.attachmentChipText}>Dokumen Surat</Text>
                        </TouchableOpacity>
                      ) : null}
                      {item.photoUrl ? (
                        <TouchableOpacity
                          style={styles.attachmentChip}
                          onPress={() => setSelectedLog(item)}
                          activeOpacity={0.7}
                        >
                          <Feather name="image" size={13} color={colors.primaryDark} style={{ marginRight: 4 }} />
                          <Text style={styles.attachmentChipText}>Foto Bukti</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.leaveCardFooter}>
                    <Text style={styles.leaveCardFooterText}>
                      Diajukan: {formatLogDate(item.createdAt || item.clockInTime)} • {formatLogTime(item.createdAt || item.clockInTime)} WIB
                    </Text>

                    {(item.endDate || item.date) >= todayStr && item.approvalStatus !== 'rejected' && !isTelat && (
                      <TouchableOpacity
                        style={styles.cancelLeaveCardBtn}
                        onPress={() => {
                          openAppDialog({
                            title: 'Cabut Izin Ini?',
                            message: `Apakah Anda ingin mencabut izin ini mulai hari ini (${todayStr}) karena sudah masuk kerja? Hari sebelum ini tetap sah tercatat sebagai izin.`,
                            icon: 'calendar',
                            variant: 'primary',
                            singleButton: false,
                            confirmText: 'Ya, Cabut Izin',
                            cancelText: 'Batal',
                            onConfirm: () => handleCancelLeaveAndClockIn(item.id),
                          });
                        }}
                      >
                        <Feather name="user-check" size={13} color={colors.primaryDark} style={{ marginRight: 4 }} />
                        <Text style={styles.cancelLeaveCardBtnText}>Cabut Izin (Masuk Kerja)</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}

            {/* Tombol Buat Pengajuan Baru di bawah list */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                select();
                setLeaveViewMode('create');
              }}
              style={[styles.bottomCreateLeaveBtn, neoShadow.sm]}
            >
              <Feather name="plus" size={16} color={colors.primaryDark} style={{ marginRight: 6 }} />
              <Text style={styles.bottomCreateLeaveBtnText}>
                + Ajukan {currentFilterOpt.label.split(' ')[0]} Baru
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    );
  };

  const approvedOvertimeDates = useMemo(() => {
    const set = new Set<string>();
    userLeaves.forEach((l) => {
      if (l.approvalStatus === 'approved' && l.reason && l.reason.includes('[LEMBUR]')) {
        set.add((l.startDate || l.date).slice(0, 10));
      }
    });
    return Array.from(set);
  }, [userLeaves]);

  const renderKegiatanTab = () => (
    <View style={{ flex: 1 }}>
      <UserActivitiesScreen
        user={user}
        workEndTime={workEndStr}
        approvedOvertimeDates={approvedOvertimeDates}
      />
    </View>
  );

  const renderProfilTab = () => (
    <View style={{ flex: 1 }}>
      <ProfileScreen
        user={user}
        onBack={() => setActiveTab('presensi')}
        onLogout={confirmLogout}
        onUpdateUser={onUpdateUser}
      />
    </View>
  );

  return (
    <View style={styles.outer}>
      {activeTab === 'presensi' && renderPresensiTab()}
      {activeTab === 'kegiatan' && renderKegiatanTab()}
      {activeTab === 'kalender' && renderKalenderTab()}
      {activeTab === 'izin' && renderIzinTab()}

      {/* Persistent Bottom Navbar (5 Tabs with Real User Avatar) */}
      <BottomNavBar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setShowProfileDrawer(false);
          setActiveTab(tab);
        }}
        userAvatarUrl={user.avatarUrl}
        userName={user.fullName}
        isProfileOpen={showProfileDrawer}
        onProfilePress={() => setShowProfileDrawer((prev) => !prev)}
      />

      {/* 3/4 Height Profile Bottom Sheet with Darkened Backdrop */}
      {showProfileDrawer && (
        <View style={styles.profileDrawerBackdrop}>
          <TouchableOpacity
            activeOpacity={1}
            style={StyleSheet.absoluteFill}
            onPress={() => setShowProfileDrawer(false)}
          />
          <View style={[styles.profileDrawerSheet, neoShadow.lg]}>
            {/* Top Drag Handle */}
            <View style={styles.drawerHandleBar} />

            {/* Drawer Header */}
            <View style={styles.drawerHeaderRow}>
              <Text style={styles.drawerTitle}>Profil Pengguna</Text>
              <TouchableOpacity
                onPress={() => setShowProfileDrawer(false)}
                hitSlop={12}
                style={styles.drawerCloseBtn}
              >
                <Feather name="x" size={20} color={colors.ink} />
              </TouchableOpacity>
            </View>

            {/* Profile Content */}
            <View style={{ flex: 1 }}>
              <ProfileScreen
                user={user}
                onBack={() => setShowProfileDrawer(false)}
                onLogout={confirmLogout}
                onUpdateUser={onUpdateUser}
                isBottomSheet={true}
              />
            </View>
          </View>
        </View>
      )}

      <CameraModal
        visible={cameraVisible}
        onClose={() => {
          setCameraVisible(false);
          setPendingLeaveData(null);
        }}
        onConfirmPhoto={handleConfirmPhotoSubmit}
        attendanceTypeLabel={`${mode === 'masuk' ? 'Masuk' : 'Pulang'} (${place === 'kantor' ? (nearestOffice?.officeName || 'Kantor') : 'Di Luar'})`}
        metadata={{
          userName: user.fullName,
          department: user.department || 'Operasional',
          companyName: user?.companyName || 'PresensiPro',
          sessionLabel: mode === 'masuk' ? 'PRESENSI MASUK' : 'PRESENSI PULANG',
          statusLabel: mode === 'masuk' ? (isLateCheckIn ? 'Terlambat' : 'Tepat Waktu') : 'Selesai',
          officeName: place === 'kantor' ? (nearestOffice?.officeName || 'Kantor Cabang') : 'Presensi Di Luar',
          distanceText:
            place === 'kantor'
              ? currentDistance !== null
                ? `${formatDistance(currentDistance)} (${isWithinRadius ? 'Dalam Radius' : 'Di Luar Radius'})`
                : 'Jarak Terdeteksi'
              : '',
          latitude: currentCoords.latitude,
          longitude: currentCoords.longitude,
          deviceModel: user.deviceModel,
        }}
      />

      <ConfirmDialog
        visible={showLogoutDialog}
        onClose={() => setShowLogoutDialog(false)}
        onConfirm={onLogout}
        title="Konfirmasi Keluar"
        message="Apakah Anda yakin ingin keluar dari akun ini?"
        confirmText="Ya, Keluar"
        cancelText="Batal"
        icon="log-out"
        variant="danger"
      />

      <ConfirmDialog
        visible={dialogConfig.visible}
        onClose={closeAppDialog}
        onConfirm={() => {
          if (dialogConfig.onConfirm) {
            dialogConfig.onConfirm();
          } else {
            closeAppDialog();
          }
        }}
        title={dialogConfig.title}
        message={dialogConfig.message}
        confirmText={dialogConfig.confirmText}
        cancelText={dialogConfig.cancelText}
        icon={dialogConfig.icon}
        variant={dialogConfig.variant}
        singleButton={dialogConfig.singleButton}
      />

      {/* Detail log + foto bukti */}
      <Modal visible={!!selectedLog} onClose={() => setSelectedLog(null)} title="Bukti Kehadiran">
        {selectedLog && (
          <ScrollView showsVerticalScrollIndicator={false}>
          <View>
            <View style={styles.modalHeaderRow}>
              {selectedLog.reason && selectedLog.reason.includes('[TELAT') ? (
                selectedLog.approvalStatus === 'pending' ? (
                  <Badge type="menunggu" label="Telat (Menunggu)" />
                ) : selectedLog.approvalStatus === 'rejected' ? (
                  <Badge type="ditolak" label="Telat (Ditolak)" />
                ) : (
                  <Badge type="telat" />
                )
              ) : selectedLog.type === 'izin_sakit' && selectedLog.approvalStatus === 'pending' ? (
                <Badge type="menunggu" />
              ) : selectedLog.type === 'izin_sakit' && selectedLog.approvalStatus === 'rejected' ? (
                <Badge type="ditolak" />
              ) : (
                <Badge type={selectedLog.type} />
              )}
              <Text style={styles.modalDate}>{formatLogDate(selectedLog.clockInTime)}</Text>
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                {selectedLog.reason && selectedLog.reason.includes('[TELAT')
                  ? 'Izin Telat'
                  : selectedLog.sessionType === 'izin_sakit'
                  ? 'Izin/Sakit'
                  : isWeekendDateString(selectedLog.date)
                    ? `Lembur (${selectedLog.sessionType === 'pulang' ? 'pulang' : 'masuk'})`
                    : selectedLog.sessionType === 'pulang'
                      ? 'Pulang'
                      : 'Masuk'}
                : {formatLogTime(selectedLog.clockInTime)} WIB
              </Text>
              {selectedLog.officeName ? (
                <Text style={styles.infoText}>
                  Kantor: {selectedLog.officeName}
                </Text>
              ) : null}
              {selectedLog.distanceMeters ? (
                <Text style={styles.infoText}>
                  Jarak ke kantor: {selectedLog.distanceMeters} meter
                </Text>
              ) : null}
              {selectedLog.reason ? (
                <Text style={styles.infoText}>Catatan: {selectedLog.reason}</Text>
              ) : null}
              {selectedLog.latitude != null && selectedLog.longitude != null ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => Linking.openURL(`https://www.google.com/maps?q=${selectedLog.latitude},${selectedLog.longitude}`).catch(() => {})}
                  style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}
                >
                  <Text style={styles.infoText}>Koordinat: </Text>
                  <Text style={{ color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' }}>
                    {selectedLog.latitude.toFixed(6)}, {selectedLog.longitude.toFixed(6)} (Buka di Google Maps ↗)
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {selectedLog.photoUrl ? (
              <View style={styles.photoSection}>
                <View style={styles.photoHeaderRow}>
                  <Text style={styles.photoTitle}>Foto bukti presensi:</Text>
                  {resolveMediaUrl(selectedLog.photoUrl) ? (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(resolveMediaUrl(selectedLog.photoUrl)!).catch(() => {})}
                      hitSlop={8}
                    >
                      <Text style={styles.photoOpenLink}>Buka Foto Penuh ↗</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={styles.photoFrame}>
                  <Image
                    source={{ uri: resolveMediaUrl(selectedLog.photoUrl) || selectedLog.photoUrl }}
                    style={styles.fullPhoto}
                    resizeMode="cover"
                  />
                </View>
              </View>
            ) : (
              <Text style={styles.noPhotoText}>Tidak ada foto bukti untuk catatan ini.</Text>
            )}
            {selectedLog.documentUrl ? (
              <View style={styles.photoSection}>
                <Text style={styles.photoTitle}>Dokumen surat izin/sakit:</Text>
                {/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(selectedLog.documentUrl) ? (
                  <Image source={{ uri: selectedLog.documentUrl }} style={styles.fullPhoto} resizeMode="contain" />
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.docOpenBtn}
                    onPress={() => Linking.openURL(selectedLog.documentUrl as string).catch(() => {
                      Alert.alert('Gagal', 'Tidak bisa membuka dokumen.');
                    })}
                  >
                    <Feather name="file-text" size={18} color={colors.primaryDark} style={{ marginRight: 8 }} />
                    <Text style={styles.docOpenText}>Buka Dokumen Surat</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

            {(selectedLog.type === 'izin_sakit' || selectedLog.sessionType === 'izin_sakit') && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  select();
                  const targetId = selectedLog.id;
                  setSelectedLog(null);
                  openAppDialog({
                    title: 'Batalkan Pengajuan Izin?',
                    message: 'Apakah Anda yakin ingin membatalkan/mencabut pengajuan izin ini? Data izin akan dihapus sehingga Anda dapat melakukan presensi kerja kembali.',
                    icon: 'alert-triangle',
                    variant: 'danger',
                    singleButton: false,
                    confirmText: 'Ya, Batalkan Izin',
                    cancelText: 'Kembali',
                    onConfirm: () => handleCancelLeaveAndClockIn(targetId),
                  });
                }}
                style={styles.cancelLeaveModalBtn}
              >
                <Feather name="trash-2" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.cancelLeaveModalBtnText}>Batalkan / Cabut Izin Ini</Text>
              </TouchableOpacity>
            )}
          </View>
          </ScrollView>
        )}
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Toast "belum absen" — menggantung dari atas, oranye
  toast: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.secondaryBorder,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  toastText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 22,
  },
  toastClose: {
    padding: 6,
    marginLeft: 8,
  },
  scroll: {
    padding: 12,
    paddingBottom: 110,
  },
  greeting: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.ink,
  },
  date: {
    fontSize: fontSize.md,
    color: colors.muted,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  tabHeader: {
    marginBottom: spacing.md,
  },
  tabHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  printSlipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  printSlipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  statusCard: {
    backgroundColor: colors.surface,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  statusTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 24,
  },
  statusSub: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: 2,
  },
  savedNote: {
    fontSize: fontSize.xs,
    color: colors.successInk,
    marginTop: 4,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  // --- Masuk & Pulang sejajar ---
  duoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 62,
    justifyContent: 'center',
  },
  actionText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 4,
  },
  actionSub: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 1,
  },
  actionTextActive: {
    color: '#FFFFFF',
  },
  // --- Div terpisah izin/sakit ---
  izinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  izinIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.izinSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.izinBorder,
  },
  izinTextWrap: {
    flex: 1,
  },
  izinTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  izinSub: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.muted,
    marginTop: 2,
  },
  izinArrow: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  // --- Lokasi kantor/rumah ---
  placeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  placeBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  placeText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
  },
  label: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: fontSize.md,
    color: colors.ink,
    minHeight: 56,
  },
  inputError: {
    borderColor: colors.danger,
  },
  fieldError: {
    fontSize: fontSize.xs,
    color: colors.danger,
    fontWeight: '700',
    marginTop: 6,
  },
  // --- Lokasi + peta ---
  officeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  officeBadgeText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  locText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
  },
  refresh: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
  },
  refreshText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primary,
  },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  warnText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.danger,
    fontWeight: '700',
    lineHeight: 20,
  },
  blockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  blockText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.ink,
    fontWeight: '600',
    lineHeight: 20,
  },
  dialogBody: {
    paddingBottom: spacing.sm,
  },
  dialogText: {
    fontSize: fontSize.md,
    color: colors.ink,
    lineHeight: 26,
  },
  locBadge: {
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  inBadge: {
    backgroundColor: colors.successSoft,
  },
  outBadge: {
    backgroundColor: colors.dangerSoft,
  },
  locBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  mainBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  // --- Logs mingguan & bulanan ---
  logCard: {
    paddingVertical: spacing.sm,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.surfaceMuted,
  },
  logThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    marginRight: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
  logFallback: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    marginRight: 12,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logInfo: {
    flex: 1,
    marginRight: 8,
  },
  logTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
  },
  logSub: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 3,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: 10,
    fontWeight: '600',
  },
  floatingScrollTopBtn: {
    position: 'absolute',
    bottom: 76,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: colors.ink,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 4 },
      web: { boxShadow: '0 2px 8px rgba(15, 23, 42, 0.08)' },
    }),
    zIndex: 40,
  },
  // --- Modal detail log ---
  calDetailBox: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  calDetailTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 4,
  },
  calDetailEmpty: {
    fontSize: fontSize.sm,
    color: colors.muted,
    fontWeight: '600',
    paddingVertical: 8,
  },
  holidayBannerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.izinSoft,
    borderWidth: 1,
    borderColor: colors.izinBorder,
    borderRadius: radius.md,
    padding: 12,
    marginVertical: 6,
  },
  holidayBannerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.dangerInk,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  holidayBannerSub: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 2,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalDate: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
  },
  infoBox: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    borderRadius: radius.md,
    marginBottom: 16,
  },
  infoText: {
    fontSize: fontSize.sm,
    color: colors.ink,
    marginBottom: 6,
    fontWeight: '600',
  },
  photoSection: {
    marginTop: 8,
  },
  photoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  photoOpenLink: {
    fontSize: fontSize.xs,
    color: colors.primaryDark,
    fontWeight: '700',
  },
  photoTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  photoFrame: {
    width: '100%',
    height: 260,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fullPhoto: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
  },
  docOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  docOpenText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  noPhotoText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 12,
  },
  // Modern Colorful Mobile Style
  welcomeCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    marginBottom: 12,
  },
  welcomeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  welcomeLogo: {
    width: 44,
    height: 44,
  },
  welcomeAppSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primaryDark,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  welcomeGreeting: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F2942',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  dateBadgeMini: {
    backgroundColor: '#EBF3FF',
    borderRadius: radius.md,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: '#99C2FF',
  },
  dateBadgeMiniText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0066FF',
  },
  welcomeDivider: {
    height: 1,
    backgroundColor: colors.borderMuted,
    marginVertical: 10,
  },
  welcomeBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  welcomeShiftWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  welcomeShiftText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink,
  },
  welcomeRecapLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  welcomeRecapText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },

  // Section Headers
  sectionHeaderWrap: {
    marginBottom: 8,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  sectionTitleMain: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F2942',
    letterSpacing: -0.2,
  },
  sectionSubtitleMain: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.muted,
    marginTop: 1,
  },

  // Modern Map Card with Overlays
  modernMapCard: {
    position: 'relative',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: 8,
  },
  mapFloatingPill: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    maxWidth: '75%',
    zIndex: 10,
  },
  mapPillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  mapFloatingPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink,
  },
  mapFloatingFab: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.borderMuted,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  // Place Switcher
  placeSelectorContainer: {
    marginBottom: 14,
  },
  placePillSwitchBar: {
    flexDirection: 'row',
    gap: 8,
  },
  placePillOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  placePillOptionActiveKantor: {
    backgroundColor: '#0066FF', // Vibrant crisp bright royal blue (sangat cerah & tajam)
    borderColor: '#0066FF',
  },
  placePillOptionActiveLuar: {
    backgroundColor: '#FF6B00', // Vibrant warm sunset orange (sangat cerah, hangat, tidak pudar)
    borderColor: '#FF6B00',
  },
  placePillOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  placePillOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  reasonCardInlineModern: {
    marginTop: 8,
    padding: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Colour Action Cards Duo (Masuk Hijau, Pulang Oranye)
  colourCardsDuoRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  lateAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  lateAlertTitle: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.danger,
  },
  lateAlertSub: {
    fontSize: fontSize.xs,
    color: '#7F1D1D',
    marginTop: 2,
    fontWeight: '600',
    lineHeight: 17,
  },
  lateQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  lateQuickIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lateQuickTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: '#92400E',
  },
  lateQuickSub: {
    fontSize: fontSize.xs,
    color: '#B45309',
    marginTop: 1,
    fontWeight: '600',
  },
  colourCard: {
    flex: 1,
    minHeight: 115,
    borderRadius: 18,
    padding: 14,
    justifyContent: 'space-between',
  },
  masukCardBg: {
    backgroundColor: '#16A34A', // Vibrant Emerald Green
  },
  masukCardDoneBg: {
    backgroundColor: '#15803D',
  },
  pulangCardBg: {
    backgroundColor: '#FF6B00', // Crisp vibrant bright sunset orange
  },
  pulangCardDoneBg: {
    backgroundColor: '#E05A00',
  },
  pulangCardLockedBg: {
    backgroundColor: '#64748B', // Soft slate gray when locked (no clash with orange warning banner)
    opacity: 0.9,
  },
  colourCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  colourIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  donePillTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  donePillTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  lockPillTag: {
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  lockPillTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  colourCardContent: {
    marginTop: 10,
  },
  colourCardActionText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  colourCardSubText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 2,
  },

  // History Section
  historySectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  showAllLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  showAllLinkBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  modernLedgerCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 32,
  },

  // Modern Clean Dashboard Header (Kompak & Zero-Scroll)
  masthead: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  mastheadTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  employeeInfo: {
    flex: 1,
    marginRight: 8,
  },
  greetingText: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '600',
  },
  employeeName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  deptMiniPill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: radius.sm,
  },
  deptMiniPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  dateBadge: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.sm,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignItems: 'flex-end',
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  dateBadgeDay: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
  },
  dateBadgeTime: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  mastheadDivider: {
    height: 1,
    backgroundColor: colors.borderMuted,
    marginVertical: 8,
  },
  mastheadBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shiftCol: {
    flex: 1,
  },
  bottomRowLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '500',
    marginBottom: 2,
  },
  shiftValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  shiftTimeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink,
  },
  onTimeStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.success,
  },
  lateStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.danger,
  },
  recapLink: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recapValueText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },

  // Banner status jika sudah absen
  todaySuccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 10,
  },
  todaySuccessTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.successInk,
  },
  todaySuccessSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '500',
  },

  // Konsol Presensi
  consoleCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 14,
  },
  stepTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  sessionSection: {
    marginBottom: 10,
  },
  segmentedConsole: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 62,
  },
  segmentBtnActiveMasuk: {
    backgroundColor: colors.masukSoft,
    borderColor: colors.masukBorder,
  },
  segmentBtnActivePulang: {
    backgroundColor: colors.pulangSoft,
    borderColor: colors.pulangBorder,
  },
  segmentBtnLocked: {
    opacity: 0.55,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.muted,
  },
  segmentTextActiveMasuk: {
    color: colors.primaryDark,
    fontWeight: '800',
  },
  segmentTextActivePulang: {
    color: colors.secondaryDark,
    fontWeight: '800',
  },
  segmentSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '600',
  },
  locationToggleWrap: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  locationSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  largeLocationRow: {
    flexDirection: 'row',
    gap: 8,
  },
  largeLocationBtn: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    flexDirection: 'row',
    alignItems: 'center',
  },
  largeLocationBtnActiveKantor: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  largeLocationBtnActiveLuar: {
    backgroundColor: colors.secondaryDark,
    borderColor: colors.secondaryDark,
  },
  largeLocationIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  largeLocationIconActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  largeLocationTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.ink,
  },
  largeLocationTextActive: {
    color: '#FFFFFF',
  },
  largeLocationSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 1,
  },
  largeLocationSubActive: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  reasonCardInline: {
    marginTop: 10,
    padding: 10,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationSection: {
    marginBottom: 8,
  },
  locationToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  locationPillSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  locationPillActive: {
    backgroundColor: colors.primary,
  },
  locationPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  locationPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  reasonContainer: {
    marginBottom: 10,
    padding: 10,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  reasonInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.ink,
    minHeight: 44,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as any) : {}),
  },
  reasonInputError: {
    borderColor: colors.danger,
  },
  mapSectionWrap: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderMuted,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  mapHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  mapHeaderSub: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.faint,
  },
  mapContainer: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 10,
  },
  locationStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  statusIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  locationStatusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  locationStatusSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
    fontWeight: '500',
  },
  refreshLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  refreshLocationText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  consoleActionBtn: {
    marginTop: 10,
    minHeight: 48,
    borderRadius: radius.md,
  },

  // Riwayat List
  ledgerContainer: {
    marginBottom: 32,
  },
  ledgerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  ledgerSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  ledgerCount: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.muted,
  },
  ledgerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  todayLeaveBanner: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 14,
  },
  todayLeaveTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  leaveCategoryIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayLeaveTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.ink,
  },
  todayLeaveSub: {
    fontSize: 11,
    color: colors.muted,
  },
  leaveApprovalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  leaveApprovalBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  todayLeaveReasonText: {
    fontSize: fontSize.xs,
    color: colors.ink,
    fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 18,
  },
  todayLeaveNoteBox: {
    backgroundColor: colors.surfaceSoft,
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
  },
  todayLeaveNoteText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  newLeaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  newLeaveBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dropdownSectionWrap: {
    marginBottom: 14,
    position: 'relative',
    zIndex: 20,
  },
  dropdownTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dropdownIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownSubLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  dropdownActiveLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 1,
  },
  dropdownMenuCard: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 4,
    gap: 2,
  },
  dropdownMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  dropdownMenuItemActive: {
    backgroundColor: colors.primarySoft,
  },
  dropdownMenuItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  dropdownMenuItemTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  emptyLeaveCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  bottomCreateLeaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primaryBorder,
    borderRadius: radius.md,
    paddingVertical: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  bottomCreateLeaveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  emptyLeaveIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyLeaveTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
  },
  emptyLeaveSub: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
    lineHeight: 18,
  },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  emptyActionBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  leaveHistoryCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
  },
  leaveHistoryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  leaveHistoryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveHistoryTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  leaveHistoryDates: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '500',
  },
  leaveStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  leaveStatusPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  leaveReasonBox: {
    backgroundColor: colors.surfaceSoft,
    padding: 10,
    borderRadius: radius.sm,
    marginBottom: 8,
  },
  leaveReasonLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  leaveReasonContent: {
    fontSize: fontSize.xs,
    color: colors.ink,
    marginTop: 2,
    lineHeight: 18,
  },
  leaveAdminNoteBox: {
    backgroundColor: colors.dangerSoft,
    padding: 10,
    borderRadius: radius.sm,
    marginBottom: 8,
  },
  leaveAdminNoteLabel: {
    fontSize: 10,
    color: colors.danger,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  leaveAdminNoteContent: {
    fontSize: fontSize.xs,
    color: colors.danger,
    marginTop: 2,
    lineHeight: 18,
  },
  leaveAttachmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  attachmentChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  leaveCardFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  leaveCardFooterText: {
    fontSize: 10,
    color: colors.muted,
  },
  cancelLeaveCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  cancelLeaveCardBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  cancelLeaveBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  cancelLeaveBannerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  cancelLeaveModalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  cancelLeaveModalBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  // 3/4 Height Profile Bottom Sheet Drawer
  profileDrawerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    zIndex: 120,
    justifyContent: 'flex-end',
  },
  profileDrawerSheet: {
    height: '78%',
    maxHeight: 740,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  drawerHandleBar: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  drawerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
  },
  drawerCloseBtn: {
    padding: 4,
  },
});
