// E-Presensi · Timesheet & Log Kegiatan Harian Staf
// Fitur: Interactive Date Strip, Batasan Jam Kerja Reguler (s.d. Jam 17:00 / Jam Global),
// Lampiran Foto Dokumentasi (Opsional), serta Perekaman Koordinat GPS Otomatis.

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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import {
  ActivityRecord,
  DEFAULT_PROJECTS,
  createActivity,
  deleteActivity,
  fetchActivities,
} from '../../services/activityService';
import { uploadFile } from '../../lib/api';
import { select, succeed } from '../../services/feedbackService';
import { getCurrentLocation } from '../../services/locationService';
import { colors, fontSize, neoShadow, radius, spacing } from '../../theme';
import { UserProfile } from '../../types/attendance';
import { todayWIB, isWeekendDateString } from '../../utils/dates';
import { isNationalHoliday } from '../../utils/holidays';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface UserActivitiesScreenProps {
  user: UserProfile;
  workEndTime?: string; // Default '17:00'
  approvedOvertimeDates?: string[];
}

const DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS_FULL = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const dayName = DAYS_SHORT[dt.getDay()] || '';
  const monthName = MONTHS_FULL[dt.getMonth()] || '';
  return `${dayName}, ${d} ${monthName} ${y}`;
}

function addDaysToDate(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function parseTimeToMinutes(t: string): number {
  if (!t) return 0;
  const parts = String(t).split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export const UserActivitiesScreen: React.FC<UserActivitiesScreenProps> = ({
  user,
  workEndTime = '17:00',
  approvedOvertimeDates = [],
}) => {
  const today = todayWIB();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [monthActivities, setMonthActivities] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Modal Foto Preview
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  // In-App Confirm Dialog State untuk Hapus Aktivitas
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Form State
  const [selectedProject, setSelectedProject] = useState('KEGIATAN');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('10:00');
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  // Load activities for current selected month & date
  const loadData = async (date: string) => {
    setLoading(true);
    try {
      const monthPrefix = date.slice(0, 7);
      const [dayData, monthData] = await Promise.all([
        fetchActivities({ date }),
        fetchActivities({ month: monthPrefix }),
      ]);
      setActivities(dayData);
      setMonthActivities(monthData);
    } catch (err) {
      console.warn('Gagal memuat aktivitas:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(selectedDate);
  }, [selectedDate]);

  // Total jam hari ini
  const totalMinutesToday = activities.reduce((acc, curr) => acc + (curr.durationMinutes || 0), 0);
  const totalHoursToday = Math.round((totalMinutesToday / 60) * 10) / 10;

  // Day Hours Map for the 7-day strip indicators
  const dayHoursMap = useMemo(() => {
    const map: Record<string, number> = {};
    monthActivities.forEach((act) => {
      const d = act.activityDate;
      map[d] = (map[d] || 0) + (act.durationMinutes || 0);
    });
    return map;
  }, [monthActivities]);

  // 7-day strip centered around the selected date
  const dateStripList = useMemo(() => {
    const list: Array<{
      dateStr: string;
      dayShort: string;
      dayNumber: number;
      isToday: boolean;
      isSelected: boolean;
      hours: number;
    }> = [];

    for (let i = -3; i <= 3; i++) {
      const dStr = addDaysToDate(selectedDate, i);
      const [y, m, d] = dStr.split('-').map(Number);
      const dt = new Date(y, (m || 1) - 1, d || 1);
      const totalMin = dayHoursMap[dStr] || 0;
      list.push({
        dateStr: dStr,
        dayShort: DAYS_SHORT[dt.getDay()],
        dayNumber: d,
        isToday: dStr === today,
        isSelected: dStr === selectedDate,
        hours: Math.round((totalMin / 60) * 10) / 10,
      });
    }
    return list;
  }, [selectedDate, today, dayHoursMap]);

  const isDateApprovedOvertime = Boolean(
    approvedOvertimeDates && approvedOvertimeDates.includes(selectedDate)
  );
  const isDateWeekend = isWeekendDateString(selectedDate);
  const isDateHoliday = isNationalHoliday(selectedDate);
  const isOvertimeAllowed = isDateApprovedOvertime || isDateWeekend || isDateHoliday;

  const maxEndMinutes = isOvertimeAllowed ? 24 * 60 - 1 : parseTimeToMinutes(workEndTime || '17:00');
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);

  const handleOpenAddModal = () => {
    void select();
    setSelectedProject('KEGIATAN');
    setDescription('');
    setPhotoUri(null);
    setPhotoName('');
    setStartTime('08:00');
    setEndTime('10:00');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleTakePhoto = async () => {
    void select();
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Izin Kamera Diperlukan', 'Mohon izinkan akses kamera pada perangkat Anda untuk mengambil foto kegiatan.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        quality: 0.7,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        setPhotoUri(asset.uri);
        setPhotoName(asset.fileName || `kegiatan_kamera_${Date.now()}.jpg`);
      }
    } catch (err) {
      console.warn('Gagal membuka kamera:', err);
    }
  };

  const handlePickGallery = async () => {
    void select();
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        setPhotoUri(asset.uri);
        setPhotoName(asset.fileName || `kegiatan_galeri_${Date.now()}.jpg`);
      }
    } catch (err) {
      console.warn('Gagal memilih foto:', err);
    }
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      setFormError('Deskripsi kegiatan wajib diisi.');
      return;
    }

    if (endMin <= startMin) {
      setFormError('Jam selesai harus lebih besar dari jam mulai kegiatan.');
      return;
    }

    // BATASAN JAM KERJA: Hanya sampai jam pulang kantor (default 17:00 WIB), kecuali lembur / akhir pekan
    if (!isOvertimeAllowed && endMin > maxEndMinutes) {
      setFormError(
        `Jam kegiatan dibatasi maksimal hingga pukul ${workEndTime} WIB (sesuai jam kerja reguler). Untuk kegiatan lembur, pastikan pengajuan lembur Anda sudah disetujui.`
      );
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      let uploadedPhotoUrl: string | null = null;
      if (photoUri) {
        try {
          uploadedPhotoUrl = await uploadFile('photo', photoUri, photoName || 'kegiatan.jpg');
        } catch (uploadErr) {
          console.warn('Upload foto kegiatan gagal:', uploadErr);
        }
      }

      let lat: number | null = null;
      let lng: number | null = null;
      try {
        const loc = await getCurrentLocation();
        if (loc && loc.coords) {
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
        }
      } catch (locErr) {
        console.warn('GPS tidak tersedia:', locErr);
      }

      const proj = DEFAULT_PROJECTS.find((p) => p.code === selectedProject);
      await createActivity({
        projectCode: selectedProject,
        projectName: proj ? proj.name : 'Aktivitas Harian',
        activityDate: selectedDate,
        startTime,
        endTime,
        description: description.trim(),
        latitude: lat,
        longitude: lng,
        locationAddress: lat ? 'Lokasi Terkunci via GPS' : undefined,
        photoUrl: uploadedPhotoUrl,
      });

      void succeed();
      setIsModalOpen(false);
      await loadData(selectedDate);
    } catch (err: any) {
      setFormError(err?.message || 'Gagal menyimpan kegiatan.');
    } finally {
      setSubmitting(false);
    }
  };

  const promptDelete = (id: string) => {
    void select();
    setDeleteTargetId(id);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    const targetId = deleteTargetId;
    setShowDeleteConfirm(false);
    setDeleteTargetId(null);
    void succeed();
    await deleteActivity(targetId);
    await loadData(selectedDate);
  };

  const openMaps = (lat?: number | null, lng?: number | null) => {
    if (!lat || !lng) return;
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      void Linking.openURL(url);
    }
  };

  const isTodayActive = selectedDate === today;
  const isYesterdayActive = selectedDate === addDaysToDate(today, -1);

  return (
    <View style={styles.container}>
      {/* 1. Header Ringkasan & Kontrol Tanggal */}
      <View style={[styles.headerCard, neoShadow.sm]}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerSubtitle}>Laporan Kerja Harian</Text>
            <Text style={styles.headerTitle}>Log Kegiatan</Text>
          </View>
          <TouchableOpacity
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={handleOpenAddModal}
          >
            <Feather name="plus" size={15} color="#FFFFFF" style={{ marginRight: 4 }} />
            <Text style={styles.addBtnText}>Catat Kegiatan</Text>
          </TouchableOpacity>
        </View>

        {/* Stepper Tanggal */}
        <View style={styles.dateStepperRow}>
          <TouchableOpacity
            style={styles.stepDayBtn}
            onPress={() => {
              void select();
              setSelectedDate((d) => addDaysToDate(d, -1));
            }}
          >
            <Feather name="chevron-left" size={18} color={colors.ink} />
          </TouchableOpacity>

          <View style={styles.currentDateDisplay}>
            <Text style={styles.currentDateText}>{formatDisplayDate(selectedDate)}</Text>
            {isTodayActive && (
              <View style={styles.todayPill}>
                <Text style={styles.todayPillText}>Hari Ini</Text>
              </View>
            )}
            {!isTodayActive && (
              <TouchableOpacity
                onPress={() => {
                  void select();
                  setSelectedDate(today);
                }}
                style={styles.jumpTodayBtn}
              >
                <Text style={styles.jumpTodayText}>Ke Hari Ini</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={styles.stepDayBtn}
            onPress={() => {
              void select();
              setSelectedDate((d) => addDaysToDate(d, 1));
            }}
          >
            <Feather name="chevron-right" size={18} color={colors.ink} />
          </TouchableOpacity>
        </View>

        {/* 7-Day Interactive Date Ribbon */}
        <View style={styles.dateRibbonRow}>
          {dateStripList.map((item) => {
            const isDone = item.hours >= 8;
            const hasHours = item.hours > 0;
            return (
              <TouchableOpacity
                key={item.dateStr}
                activeOpacity={0.7}
                onPress={() => {
                  void select();
                  setSelectedDate(item.dateStr);
                }}
                style={[
                  styles.ribbonItem,
                  item.isSelected && styles.ribbonItemSelected,
                  item.isToday && !item.isSelected && styles.ribbonItemToday,
                ]}
              >
                <Text
                  style={[
                    styles.ribbonDayName,
                    item.isSelected && styles.ribbonTextActive,
                    item.isToday && !item.isSelected && styles.ribbonDayNameToday,
                  ]}
                >
                  {item.dayShort}
                </Text>
                <Text
                  style={[
                    styles.ribbonDayNum,
                    item.isSelected && styles.ribbonTextActive,
                    item.isToday && !item.isSelected && styles.ribbonDayNumToday,
                  ]}
                >
                  {item.dayNumber}
                </Text>
                <View
                  style={[
                    styles.ribbonDot,
                    item.isSelected && { backgroundColor: '#FFFFFF' },
                    !item.isSelected && isDone && { backgroundColor: '#16A34A' },
                    !item.isSelected && hasHours && { backgroundColor: '#D97706' },
                    !item.isSelected && !isDone && !hasHours && { backgroundColor: 'transparent' },
                  ]}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bilah Progres Jam Kerja Hari Ini */}
        <View style={styles.hoursBadgeRow}>
          <View style={styles.hoursStatBox}>
            <Feather name="clock" size={15} color={colors.primary} style={{ marginRight: 6 }} />
            <Text style={styles.hoursStatText}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{totalHoursToday} Jam </Text>
              {isTodayActive ? 'tercatat hari ini' : `tercatat pada ${formatDisplayDate(selectedDate)}`}
            </Text>
          </View>
          <View style={[styles.targetPill, totalHoursToday >= 8 ? styles.targetPillDone : styles.targetPillPending]}>
            <Text style={[styles.targetPillText, totalHoursToday >= 8 ? styles.targetTextDone : styles.targetTextPending]}>
              {totalHoursToday >= 8 ? 'Target 8 Jam Selesai' : `Sisa ${Math.max(0, 8 - totalHoursToday).toFixed(1)} Jam`}
            </Text>
          </View>
        </View>
      </View>

      {/* 3. List Aktivitas Sesuai Tanggal Terpilih */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollList}
      >
        <View style={styles.feedHeaderRow}>
          <Text style={styles.feedSectionTitle}>
            {isTodayActive
              ? 'Linimasa Hari Ini'
              : isYesterdayActive
              ? 'Linimasa Kemarin'
              : `Linimasa (${formatDisplayDate(selectedDate)})`}
          </Text>
          <Text style={styles.feedCount}>{activities.length} Kegiatan</Text>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Memuat catatan kegiatan...</Text>
          </View>
        ) : activities.length === 0 ? (
          <View style={[styles.emptyCard, neoShadow.sm]}>
            <View style={styles.emptyIconCircle}>
              <Feather name="clipboard" size={28} color={colors.muted} />
            </View>
            <Text style={styles.emptyTitle}>
              Belum Ada Kegiatan {isTodayActive ? 'Hari Ini' : `pada Tanggal Ini`}
            </Text>
            <Text style={styles.emptyDesc}>
              Catat setiap progres tugas atau pekerjaan harian Anda agar jam kerja terekap otomatis oleh sistem.
            </Text>
            <Button
              title={`+ Catat Kegiatan (${formatDisplayDate(selectedDate)})`}
              variant="outline"
              onPress={handleOpenAddModal}
              style={{ marginTop: 14 }}
            />
          </View>
        ) : (
          activities.map((item, idx) => (
            <View key={item.id || idx} style={[styles.activityCard, neoShadow.sm]}>
              <View style={styles.cardTopRow}>
                {/* Sisi Kiri: Ikon + Durasi */}
                <View style={styles.cardHeaderLeft}>
                  <View style={styles.activityIconCircle}>
                    <Feather name="check-circle" size={15} color={colors.primaryDark} />
                  </View>
                  <Text style={styles.activityTimeText}>
                    {item.startTime} - {item.endTime}
                  </Text>
                  <Text style={styles.cleanDurationText}>
                    ({Math.round((item.durationMinutes / 60) * 10) / 10} jam)
                  </Text>
                </View>

                {/* Sisi Kanan: Tombol Hapus */}
                <TouchableOpacity
                  onPress={() => promptDelete(item.id)}
                  style={styles.deleteActionBtn}
                  hitSlop={10}
                >
                  <Feather name="trash-2" size={15} color={colors.muted} />
                </TouchableOpacity>
              </View>

              {/* Uraian Pekerjaan */}
              <Text style={styles.activityDescription}>{item.description}</Text>

              {item.projectCode && item.projectCode !== 'KEGIATAN' ? (
                <View style={styles.projectTagRow}>
                  <View style={styles.projectTagPill}>
                    <Feather name="folder" size={11} color={colors.primaryDark} style={{ marginRight: 4 }} />
                    <Text style={styles.projectTagText}>
                      {item.projectCode} • {item.projectName || item.projectCode}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Lampiran Foto (Opsional) */}
              {item.photoUrl ? (
                <View style={styles.photoContainer}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setPreviewPhotoUrl(item.photoUrl || null)}
                    style={styles.photoThumbnailWrap}
                  >
                    <Image source={{ uri: item.photoUrl }} style={styles.photoThumbnail} />
                    <View style={styles.photoOverlayBadge}>
                      <Feather name="maximize-2" size={11} color="#FFFFFF" style={{ marginRight: 3 }} />
                      <Text style={styles.photoOverlayText}>Lihat Foto</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Koordinat GPS & Lokasi */}
              {item.latitude != null && item.longitude != null ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => openMaps(item.latitude, item.longitude)}
                  style={styles.locationLinkRow}
                >
                  <Feather name="map-pin" size={12} color={colors.primary} style={{ marginRight: 5 }} />
                  <Text style={styles.locationLinkText}>
                    📍 {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)} • Buka di Google Maps ↗
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>

      {/* Modal Input Catatan Kegiatan Baru */}
      <Modal
        visible={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Catat Kegiatan Baru"
      >
        <View style={styles.modalBody}>
          {formError && (
            <View style={styles.formErrorBox}>
              <Feather name="alert-circle" size={16} color={colors.danger} style={{ marginRight: 6 }} />
              <Text style={styles.formErrorText}>{formError}</Text>
            </View>
          )}

          {/* Tag Proyek / Bidang Tugas */}
          <Text style={styles.formLabel}>Proyek / Bidang Tugas</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.projectScrollRow}
          >
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                void select();
                setSelectedProject('KEGIATAN');
              }}
              style={[
                styles.projectChip,
                selectedProject === 'KEGIATAN' && styles.projectChipActive,
              ]}
            >
              <Text
                style={[
                  styles.projectChipText,
                  selectedProject === 'KEGIATAN' && styles.projectChipTextActive,
                ]}
              >
                Aktivitas Umum
              </Text>
            </TouchableOpacity>
            {DEFAULT_PROJECTS.map((p) => (
              <TouchableOpacity
                key={p.code}
                activeOpacity={0.8}
                onPress={() => {
                  void select();
                  setSelectedProject(p.code);
                }}
                style={[
                  styles.projectChip,
                  selectedProject === p.code && styles.projectChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.projectChipText,
                    selectedProject === p.code && styles.projectChipTextActive,
                  ]}
                >
                  {p.code} • {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Rentang Jam Kerja */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={styles.formLabel}>Rentang Jam Kegiatan</Text>
            <Text style={[styles.regulerLimitText, isOvertimeAllowed && { color: colors.secondary, fontWeight: '700' }]}>
              {isOvertimeAllowed ? 'Mode Lembur (s.d. 23:59 WIB)' : `Batas Kerja: s.d. ${workEndTime} WIB`}
            </Text>
          </View>

          <View style={styles.timeInputsRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.subLabel}>Jam Mulai</Text>
              <TextInput
                style={styles.timeInput}
                value={startTime}
                onChangeText={setStartTime}
                placeholder="08:00"
                placeholderTextColor={colors.faint}
              />
            </View>
            <View style={{ alignSelf: 'center', marginTop: 18, paddingHorizontal: 6 }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>—</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.subLabel}>Jam Selesai</Text>
              <TextInput
                style={styles.timeInput}
                value={endTime}
                onChangeText={setEndTime}
                placeholder="10:00"
                placeholderTextColor={colors.faint}
              />
            </View>
          </View>

          {/* Shortcut Jam Populer */}
          <View style={styles.quickTimeSlots}>
            {(isOvertimeAllowed
              ? [
                  ['08:00', '12:00'],
                  ['13:00', '17:00'],
                  ['17:00', '19:00'],
                  ['19:00', '21:00'],
                ]
              : [
                  ['08:00', '10:00'],
                  ['10:00', '12:00'],
                  ['13:00', '15:00'],
                  ['15:00', workEndTime || '17:00'],
                ]
            ).map(([s, e]) => (
              <TouchableOpacity
                key={`${s}-${e}`}
                onPress={() => {
                  void select();
                  setStartTime(s);
                  setEndTime(e);
                }}
                style={[
                  styles.quickSlotBtn,
                  startTime === s && endTime === e && styles.quickSlotBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.quickSlotText,
                    startTime === s && endTime === e && styles.quickSlotTextActive,
                  ]}
                >
                  {s} - {e}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Deskripsi Kegiatan */}
          <Text style={[styles.formLabel, { marginTop: 14 }]}>Deskripsi Kegiatan (Wajib)</Text>
          <TextInput
            style={styles.descInput}
            multiline
            numberOfLines={4}
            value={description}
            onChangeText={setDescription}
            placeholder="Jelaskan progres tugas atau aktivitas kerja yang Anda lakukan..."
            placeholderTextColor={colors.faint}
          />

          {/* Lampiran Foto (Opsional) */}
          <Text style={[styles.formLabel, { marginTop: 14 }]}>Foto Kegiatan (Opsional)</Text>
          {photoUri ? (
            <View style={styles.attachedPhotoCard}>
              <Image source={{ uri: photoUri }} style={styles.attachedPhotoPreview} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.attachedPhotoName} numberOfLines={1}>{photoName}</Text>
                <Text style={styles.attachedPhotoSub}>✓ Foto siap dilampirkan</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  void select();
                  setPhotoUri(null);
                  setPhotoName('');
                }}
                style={styles.removePhotoBtn}
              >
                <Feather name="x" size={16} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleTakePhoto}
                style={[styles.pickPhotoBtn, { flex: 1 }]}
              >
                <Feather name="camera" size={15} color={colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.pickPhotoBtnText}>Ambil Foto</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handlePickGallery}
                style={[styles.pickPhotoBtn, { flex: 1 }]}
              >
                <Feather name="image" size={15} color={colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.pickPhotoBtnText}>Pilih Galeri</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.gpsNoticeRow}>
            <Feather name="navigation" size={13} color={colors.primaryDark} style={{ marginRight: 6 }} />
            <Text style={styles.gpsNoticeText}>
              Koordinat GPS posisi saat ini otomatis terekam sebagai validasi lokasi kerja.
            </Text>
          </View>

          {/* Tombol Aksi */}
          <View style={{ marginTop: 20, flexDirection: 'row', gap: 10 }}>
            <Button
              title="Batal"
              variant="outline"
              style={{ flex: 1 }}
              onPress={() => setIsModalOpen(false)}
            />
            <Button
              title={submitting ? 'Menyimpan...' : 'Simpan Kegiatan'}
              variant="primary"
              loading={submitting}
              style={{ flex: 1 }}
              onPress={handleSubmit}
            />
          </View>
        </View>
      </Modal>

      {/* Modal Preview Foto Penuh */}
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

      {/* Confirm Dialog Hapus */}
      <ConfirmDialog
        visible={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setDeleteTargetId(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Hapus Catatan Kegiatan"
        message="Apakah Anda yakin ingin menghapus catatan kegiatan ini? Data jam kerja akan otomatis disesuaikan."
        confirmText="Hapus"
        cancelText="Batal"
        icon="trash-2"
        variant="danger"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerCard: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.ink,
    marginTop: 1,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  addBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Date Stepper Row
  dateStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 8,
  },
  stepDayBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentDateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currentDateText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  todayPill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginLeft: 6,
  },
  todayPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  jumpTodayBtn: {
    marginLeft: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  jumpTodayText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },

  // Date Ribbon
  dateRibbonRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  ribbonItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ribbonItemSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  ribbonItemToday: {
    borderColor: colors.primary,
  },
  ribbonDayName: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
  },
  ribbonDayNameToday: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  ribbonDayNum: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.ink,
    marginTop: 2,
  },
  ribbonDayNumToday: {
    color: colors.primaryDark,
  },
  ribbonTextActive: {
    color: '#FFFFFF',
  },
  ribbonDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 3,
  },

  // Hours Stat
  hoursBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hoursStatBox: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  hoursStatText: {
    fontSize: 12,
    color: colors.muted,
  },
  targetPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  targetPillDone: {
    backgroundColor: '#DCFCE7',
  },
  targetPillPending: {
    backgroundColor: '#FEF3C7',
  },
  targetPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  targetTextDone: {
    color: '#166534',
  },
  targetTextPending: {
    color: '#B45309',
  },

  // Scroll List
  scrollList: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  feedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  feedSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  feedCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  loadingBox: {
    padding: 30,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: colors.muted,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    padding: 24,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  emptyDesc: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },

  // Activity Card
  activityCard: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  activityIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTimeText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  cleanDurationText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  deleteActionBtn: {
    padding: 4,
  },
  activityDescription: {
    fontSize: 13,
    color: colors.ink,
    lineHeight: 20,
  },
  projectTagRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  projectTagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  projectTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  projectScrollRow: {
    gap: 8,
    paddingVertical: 4,
  },
  projectChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  projectChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  projectChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  photoContainer: {
    marginTop: 4,
  },
  photoThumbnailWrap: {
    position: 'relative',
    width: 120,
    height: 80,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoThumbnail: {
    width: '100%',
    height: '100%',
  },
  photoOverlayBadge: {
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
  photoOverlayText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  locationLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  locationLinkText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    textDecorationLine: 'underline',
  },

  // Modal
  modalBody: {
    gap: 10,
  },
  formErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    padding: 10,
    borderRadius: radius.sm,
  },
  formErrorText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.danger,
    flex: 1,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  regulerLimitText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
  },
  subLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 4,
  },
  timeInputsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  timeInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    backgroundColor: colors.surface,
    textAlign: 'center',
  },
  quickTimeSlots: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  quickSlotBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickSlotBtnActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  quickSlotText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  quickSlotTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  descInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 13,
    color: colors.ink,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  pickPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
    backgroundColor: colors.primarySoft + '40',
  },
  pickPhotoBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  attachedPhotoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 8,
  },
  attachedPhotoPreview: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
  },
  attachedPhotoName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  attachedPhotoSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
  removePhotoBtn: {
    padding: 6,
  },
  gpsNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSoft,
    padding: 8,
    borderRadius: radius.sm,
    marginTop: 4,
  },
  gpsNoticeText: {
    fontSize: 10,
    color: colors.muted,
    flex: 1,
  },
});
