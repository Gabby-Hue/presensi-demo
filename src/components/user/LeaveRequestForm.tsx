import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Feather } from '@expo/vector-icons';
import { colors, fontSize, radius, spacing } from '../../theme';
import { select } from '../../services/feedbackService';
import { todayWIB } from '../../utils/dates';
import { DEFAULT_PROJECTS } from '../../services/activityService';

const CAL_MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const CAL_MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

const toDateKey = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const parseDateKey = (key: string): { y: number; m: number; d: number } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key || '');
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
};

const formatDisplayDate = (key: string): string => {
  const p = parseDateKey(key);
  if (!p) return key;
  return `${p.d} ${CAL_MONTH_SHORT[p.m]} ${p.y}`;
};

interface LeaveRequestFormProps {
  initialCategory?: 'izin' | 'sakit' | 'lembur';
  onSubmit: (data: {
    startDate: string;
    endDate: string;
    reason: string;
    documentUrl?: string;
  }) => void;
  onBack: () => void;
  loading?: boolean;
}

export const LeaveRequestForm: React.FC<LeaveRequestFormProps> = ({
  initialCategory = 'izin',
  onSubmit,
  onBack,
  loading = false,
}) => {
  const today = todayWIB();
  const [leaveCategory, setLeaveCategory] = useState<'izin' | 'sakit' | 'lembur'>(initialCategory);
  const [durationMode, setDurationMode] = useState<'full' | 'half'>('full');
  const [halfDaySession, setHalfDaySession] = useState<'pagi' | 'siang'>('pagi');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [overtimeStart, setOvertimeStart] = useState('17:00');
  const [overtimeEnd, setOvertimeEnd] = useState('20:00');
  const [reason, setReason] = useState('');
  const [attachedUri, setAttachedUri] = useState<string | undefined>(undefined);
  const [attachedName, setAttachedName] = useState<string>('');
  const [pickerFor, setPickerFor] = useState<'start' | 'end' | null>(null);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState(() => new Date().getMonth());

  const openPicker = (which: 'start' | 'end') => {
    select();
    const current = which === 'start' ? startDate : endDate;
    const p = parseDateKey(current);
    const now = new Date();
    setPickerYear(p ? p.y : now.getFullYear());
    setPickerMonth(p ? p.m : now.getMonth());
    setPickerFor(which);
  };

  const handlePickDay = (day: number) => {
    select();
    const picked = toDateKey(pickerYear, pickerMonth, day);
    if (durationMode === 'half') {
      setStartDate(picked);
      setEndDate(picked);
    } else if (pickerFor === 'start') {
      setStartDate(picked);
      // Kalau tanggal mulai melewati tanggal sampai, geser tanggal sampai ikut maju.
      if (picked > endDate) setEndDate(picked);
    } else if (pickerFor === 'end') {
      setEndDate(picked);
      // Kalau tanggal sampai mundur melewati tanggal mulai, geser tanggal mulai ikut mundur.
      if (picked < startDate) setStartDate(picked);
    }
    setPickerFor(null);
  };

  const handlePickDocument = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        setAttachedUri(asset.uri);
        setAttachedName(asset.name);
      }
    } catch {
      const imgRes = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });

      if (!imgRes.canceled && imgRes.assets[0]?.uri) {
        setAttachedUri(imgRes.assets[0].uri);
        setAttachedName('Surat_Keterangan.jpg');
      }
    }
  };

  const handleSubmit = () => {
    if (!reason.trim()) {
      Alert.alert(
        leaveCategory === 'lembur' ? 'Uraian Lembur Diperlukan' : 'Alasan Diperlukan',
        leaveCategory === 'lembur'
          ? 'Mohon isi target tugas atau alasan lembur secara jelas.'
          : 'Mohon isi keterangan atau alasan pengajuan secara jelas.'
      );
      return;
    }

    if (leaveCategory === 'lembur') {
      const partsS = overtimeStart.split(':').map(Number);
      const partsE = overtimeEnd.split(':').map(Number);
      const minS = (partsS[0] || 0) * 60 + (partsS[1] || 0);
      const minE = (partsE[0] || 0) * 60 + (partsE[1] || 0);
      if (minE <= minS) {
        Alert.alert('Jam Tidak Valid', 'Jam selesai lembur harus lebih besar dari jam mulai.');
        return;
      }
      const hours = Math.max(0.5, Math.round(((minE - minS) / 60) * 10) / 10);
      const fullReason = `[LEMBUR] ${overtimeStart} - ${overtimeEnd} (${hours} Jam) | ${reason.trim()}`;

      onSubmit({
        startDate,
        endDate: startDate,
        reason: fullReason,
        documentUrl: undefined,
      });
      return;
    }

    if (durationMode === 'full' && endDate < startDate) {
      Alert.alert('Tanggal Tidak Valid', 'Tanggal selesai izin tidak boleh lebih awal dari tanggal mulai.');
      return;
    }

    const tag = durationMode === 'half'
      ? `[${leaveCategory.toUpperCase()} - SETENGAH HARI (${halfDaySession.toUpperCase()})]`
      : `[${leaveCategory.toUpperCase()}]`;

    const fullReason = `${tag} ${reason.trim()}`;

    onSubmit({
      startDate,
      endDate: durationMode === 'half' ? startDate : endDate,
      reason: fullReason,
      documentUrl: attachedUri,
    });
  };

  return (
    <View style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {/* Top App Bar Header */}
        <View style={styles.topBar}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onBack}
            style={styles.backButton}
            hitSlop={12}
          >
            <Feather name="arrow-left" size={22} color={colors.ink} />
          </TouchableOpacity>
          <View style={styles.topBarTextWrap}>
            <Text style={styles.topBarTitle}>
              {leaveCategory === 'lembur'
                ? 'Formulir Lembur'
                : leaveCategory === 'sakit'
                ? 'Surat Izin Sakit'
                : 'Pengajuan Izin / Cuti'}
            </Text>
            <Text style={styles.topBarSubtitle}>
              {leaveCategory === 'lembur'
                ? 'Pengajuan Jam Kerja Lembur'
                : leaveCategory === 'sakit'
                ? 'Formulir Izin Sakit Karyawan'
                : 'Formulir Permohonan Izin Karyawan'}
            </Text>
          </View>
          <View style={{ width: 42 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {leaveCategory === 'lembur' ? (
            <>
              {/* Card 1: Tanggal & Jam Lembur */}
              <View style={styles.sectionCard}>
                <Text style={styles.label}>Tanggal & Jam Pelaksanaan Lembur</Text>

                <Text style={styles.subLabel}>Tanggal Lembur</Text>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => openPicker('start')}
                  style={[styles.inputWrap, { marginBottom: 14 }]}
                >
                  <Feather name="calendar" size={16} color={colors.primary} style={styles.inputIcon} />
                  <Text style={styles.dateValue}>{formatDisplayDate(startDate)}</Text>
                  <Feather name="chevron-down" size={16} color={colors.faint} />
                </TouchableOpacity>

                <Text style={styles.subLabel}>Rentang Jam Lembur</Text>
                <View style={styles.otTimeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.otTimeLabel}>Mulai</Text>
                    <TextInput
                      style={styles.otTimeInput}
                      value={overtimeStart}
                      onChangeText={setOvertimeStart}
                      placeholder="17:00"
                      placeholderTextColor={colors.faint}
                    />
                  </View>
                  <View style={{ alignSelf: 'center', marginTop: 14, paddingHorizontal: 6 }}>
                    <Text style={{ color: colors.muted, fontWeight: '700' }}>—</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.otTimeLabel}>Selesai</Text>
                    <TextInput
                      style={styles.otTimeInput}
                      value={overtimeEnd}
                      onChangeText={setOvertimeEnd}
                      placeholder="20:00"
                      placeholderTextColor={colors.faint}
                    />
                  </View>
                </View>

                {/* Shortcut Jam Lembur */}
                <View style={styles.otQuickSlotsRow}>
                  {[
                    ['17:00', '19:00', '2 Jam'],
                    ['17:00', '20:00', '3 Jam'],
                    ['17:00', '21:00', '4 Jam'],
                    ['18:00', '21:00', '3 Jam'],
                  ].map(([s, e, lbl]) => (
                    <TouchableOpacity
                      key={`${s}-${e}`}
                      onPress={() => {
                        select();
                        setOvertimeStart(s);
                        setOvertimeEnd(e);
                      }}
                      style={[
                        styles.otQuickSlotBtn,
                        overtimeStart === s && overtimeEnd === e && styles.otQuickSlotBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.otQuickSlotText,
                          overtimeStart === s && overtimeEnd === e && styles.otQuickSlotTextActive,
                        ]}
                      >
                        {s}-{e} ({lbl})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Badge Estimasi Jam */}
                {(() => {
                  const partsS = overtimeStart.split(':').map(Number);
                  const partsE = overtimeEnd.split(':').map(Number);
                  const minS = (partsS[0] || 0) * 60 + (partsS[1] || 0);
                  const minE = (partsE[0] || 0) * 60 + (partsE[1] || 0);
                  const estHours = Math.max(0, Math.round(((minE - minS) / 60) * 10) / 10);
                  return (
                    <View style={styles.otEstimateBanner}>
                      <Feather name="zap" size={14} color="#B45309" style={{ marginRight: 6 }} />
                      <Text style={styles.otEstimateText}>
                        Estimasi Penugasan: <Text style={{ fontWeight: '800' }}>{estHours} Jam Lembur</Text>
                      </Text>
                    </View>
                  );
                })()}
              </View>

              {/* Card 2: Uraian Tugas Lembur */}
              <View style={styles.sectionCard}>
                <Text style={styles.label}>
                  Uraian Tugas Lembur <Text style={styles.requiredStar}>*</Text>
                </Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  numberOfLines={4}
                  placeholder="Contoh: Menyelesaikan revisi comment sheet piping / pengawasan cor plat beton..."
                  placeholderTextColor={colors.faint}
                  textAlignVertical="top"
                />
              </View>
            </>
          ) : (
            <>
              {/* Card 1: Durasi Pengajuan (Penuh vs Setengah Hari) */}
              <View style={styles.sectionCard}>
                <Text style={styles.label}>{leaveCategory === 'sakit' ? 'Durasi Sakit' : 'Durasi Izin'}</Text>
                <View style={styles.durationRow}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      select();
                      setDurationMode('full');
                    }}
                    style={[
                      styles.durationBtn,
                      durationMode === 'full' && styles.durationBtnActive,
                    ]}
                  >
                    <Feather
                      name="calendar"
                      size={15}
                      color={durationMode === 'full' ? colors.primary : colors.muted}
                    />
                    <Text
                      style={[
                        styles.durationBtnText,
                        durationMode === 'full' && styles.durationBtnTextActive,
                      ]}
                    >
                      Seharian Penuh
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      select();
                      setDurationMode('half');
                      setEndDate(startDate);
                    }}
                    style={[
                      styles.durationBtn,
                      durationMode === 'half' && styles.durationBtnActive,
                    ]}
                  >
                    <Feather
                      name="clock"
                      size={15}
                      color={durationMode === 'half' ? colors.primary : colors.muted}
                    />
                    <Text
                      style={[
                        styles.durationBtnText,
                        durationMode === 'half' && styles.durationBtnTextActive,
                      ]}
                    >
                      Setengah Hari
                    </Text>
                  </TouchableOpacity>
                </View>

                {durationMode === 'half' && (
                  <View style={styles.halfDayBox}>
                    <Text style={styles.subLabel}>Pilih Sesi Setengah Hari</Text>
                    <View style={styles.sessionPillsRow}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => {
                          select();
                          setHalfDaySession('pagi');
                        }}
                        style={[
                          styles.sessionPill,
                          halfDaySession === 'pagi' && styles.sessionPillActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.sessionPillText,
                            halfDaySession === 'pagi' && styles.sessionPillTextActive,
                          ]}
                        >
                          Pagi (Izin pagi, masuk siang)
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => {
                          select();
                          setHalfDaySession('siang');
                        }}
                        style={[
                          styles.sessionPill,
                          halfDaySession === 'siang' && styles.sessionPillActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.sessionPillText,
                            halfDaySession === 'siang' && styles.sessionPillTextActive,
                          ]}
                        >
                          Siang (Masuk pagi, izin siang)
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.halfDayNote}>
                      Setelah disetujui, tombol presensi tetap dibuka untuk sesi kerja yang Anda hadiri.
                    </Text>
                  </View>
                )}
              </View>

              {/* Card 2: Periode Tanggal */}
              <View style={styles.sectionCard}>
                <Text style={styles.label}>{durationMode === 'half' ? 'Tanggal Izin' : 'Periode Tanggal'}</Text>
                {durationMode === 'half' ? (
                  <View>
                    <Text style={styles.subLabel}>Hari & Tanggal</Text>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => openPicker('start')}
                      style={styles.inputWrap}
                    >
                      <Feather name="calendar" size={16} color={colors.primary} style={styles.inputIcon} />
                      <Text style={styles.dateValue}>{formatDisplayDate(startDate)}</Text>
                      <Feather name="chevron-down" size={16} color={colors.faint} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.dateRow}>
                    <View style={[styles.dateCol, { marginRight: 8 }]}>
                      <Text style={styles.subLabel}>Mulai Tanggal</Text>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => openPicker('start')}
                        style={styles.inputWrap}
                      >
                        <Feather name="calendar" size={16} color={colors.primary} style={styles.inputIcon} />
                        <Text style={styles.dateValue}>{formatDisplayDate(startDate)}</Text>
                        <Feather name="chevron-down" size={16} color={colors.faint} />
                      </TouchableOpacity>
                    </View>

                    <View style={[styles.dateCol, { marginLeft: 8 }]}>
                      <Text style={styles.subLabel}>Sampai Tanggal</Text>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => openPicker('end')}
                        style={styles.inputWrap}
                      >
                        <Feather name="calendar" size={16} color={colors.primary} style={styles.inputIcon} />
                        <Text style={styles.dateValue}>{formatDisplayDate(endDate)}</Text>
                        <Feather name="chevron-down" size={16} color={colors.faint} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {/* Card 3: Keterangan / Alasan */}
              <View style={styles.sectionCard}>
                <Text style={styles.label}>
                  Keterangan Alasan <Text style={styles.requiredStar}>*</Text>
                </Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  numberOfLines={4}
                  placeholder={
                    leaveCategory === 'sakit'
                      ? 'Contoh: Demam tinggi dan flu, disarankan istirahat oleh dokter...'
                      : 'Contoh: Keperluan keluarga mendesak di luar kota...'
                  }
                  placeholderTextColor={colors.faint}
                  textAlignVertical="top"
                />
              </View>

              {/* Card 4: Berkas / Surat Dokter */}
              <View style={styles.sectionCard}>
                <Text style={styles.label}>
                  {leaveCategory === 'sakit'
                    ? 'Surat Dokter / Resep Klinik'
                    : 'Surat Bukti / Berkas Pendukung'}{' '}
                  <Text style={styles.optionalText}>(Opsional)</Text>
                </Text>
                {attachedUri ? (
                  <View style={styles.attachmentBox}>
                    {/\.(png|jpe?g|webp|gif)$/i.test(attachedName || '') ||
                    (attachedUri.startsWith('data:image')) ? (
                      <Image source={{ uri: attachedUri }} style={styles.attachmentThumb} />
                    ) : (
                      <View style={styles.attachmentIconCircle}>
                        <Feather name="file-text" size={18} color={colors.primary} />
                      </View>
                    )}
                    <View style={styles.attachmentInfo}>
                      <Text style={styles.attachmentName} numberOfLines={1}>
                        {attachedName || 'Berkas_Terlampir'}
                      </Text>
                      <Text style={styles.attachmentSub}>Berkas siap diunggah</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setAttachedUri(undefined)}
                      style={styles.removeBtn}
                      hitSlop={12}
                    >
                      <Feather name="trash-2" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={handlePickDocument}
                    style={styles.uploadArea}
                  >
                    <View style={styles.uploadIconWrap}>
                      <Feather name="upload-cloud" size={24} color={colors.primary} />
                    </View>
                    <Text style={styles.uploadTitle}>
                      {leaveCategory === 'sakit' ? 'Unggah Surat Dokter' : 'Unggah Dokumen Pendukung'}
                    </Text>
                    <Text style={styles.uploadHint}>Mendukung format JPG, PNG, atau PDF</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Info Banner Khusus Izin/Sakit */}
              <View style={styles.infoBanner}>
                <Feather name="info" size={18} color={colors.primary} style={{ marginRight: 10 }} />
                <Text style={styles.infoText}>
                  Pengajuan akan dikirim ke antrean persetujuan Admin Cabang.
                </Text>
              </View>
            </>
          )}

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <Button
              title={loading ? 'Mengajukan...' : leaveCategory === 'lembur' ? 'Kirim Pengajuan Lembur' : 'Kirim Pengajuan'}
              variant="primary"
              icon="send"
              loading={loading}
              disabled={loading}
              onPress={handleSubmit}
              style={styles.submitButton}
            />
            <Button
              title="Kembali ke Daftar"
              variant="outline"
              icon="arrow-left"
              disabled={loading}
              onPress={onBack}
              style={styles.backActionButton}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        title={pickerFor === 'start' ? 'Pilih Tanggal Mulai' : 'Pilih Tanggal Selesai'}
      >
        {/* Navigasi bulan */}
        <View style={styles.calNav}>
          <TouchableOpacity
            activeOpacity={0.7}
            hitSlop={8}
            onPress={() => {
              select();
              const d = new Date(pickerYear, pickerMonth - 1, 1);
              setPickerYear(d.getFullYear());
              setPickerMonth(d.getMonth());
            }}
            style={styles.calNavBtn}
          >
            <Feather name="chevron-left" size={18} color={colors.ink} />
          </TouchableOpacity>
          <Text style={styles.calNavTitle}>
            {CAL_MONTH_NAMES[pickerMonth]} {pickerYear}
          </Text>
          <TouchableOpacity
            activeOpacity={0.7}
            hitSlop={8}
            onPress={() => {
              select();
              const d = new Date(pickerYear, pickerMonth + 1, 1);
              setPickerYear(d.getFullYear());
              setPickerMonth(d.getMonth());
            }}
            style={styles.calNavBtn}
          >
            <Feather name="chevron-right" size={18} color={colors.ink} />
          </TouchableOpacity>
        </View>

        {/* Nama hari */}
        <View style={styles.calWeekRow}>
          {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map((lbl, idx) => (
            <View key={lbl} style={styles.calWeekCell}>
              <Text
                style={[
                  styles.calWeekText,
                  (idx === 0 || idx === 6) && { color: colors.izin },
                ]}
              >
                {lbl}
              </Text>
            </View>
          ))}
        </View>

        {/* Grid tanggal */}
        <View style={styles.calGrid}>
          {(() => {
            const firstDay = new Date(pickerYear, pickerMonth, 1).getDay();
            const daysInMonth = new Date(pickerYear, pickerMonth + 1, 0).getDate();
            const activeKey = pickerFor === 'start' ? startDate : endDate;
            const cells: Array<number | null> = [];
            for (let i = 0; i < firstDay; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(d);
            return cells.map((day, idx) => {
              if (day === null) {
                return <View key={`e-${idx}`} style={styles.calCell} />;
              }
              const key = toDateKey(pickerYear, pickerMonth, day);
              const isActive = key === activeKey;
              const weekday = new Date(pickerYear, pickerMonth, day).getDay();
              const isWeekend = weekday === 0 || weekday === 6;
              return (
                <View key={`d-${day}`} style={styles.calCell}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() => handlePickDay(day)}
                    style={[
                      styles.calDay,
                      isActive && styles.calDayActive,
                      !isActive && isWeekend && styles.calDayWeekend,
                    ]}
                  >
                    <Text
                      style={[
                        styles.calDayText,
                        isActive && styles.calDayTextActive,
                        !isActive && isWeekend && styles.calDayTextWeekend,
                      ]}
                    >
                      {day}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            });
          })()}
        </View>

        <Text style={styles.calHint}>
          Terpilih: {formatDisplayDate(pickerFor === 'start' ? startDate : endDate)}
        </Text>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTextWrap: {
    alignItems: 'center',
  },
  topBarTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
  },
  topBarSubtitle: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: 40,
    maxWidth: 500,
    width: '100%',
    alignSelf: 'center',
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 10,
  },
  subLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 6,
  },
  requiredStar: {
    color: colors.danger,
  },
  optionalText: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    color: colors.muted,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  typeTabSakitActive: {
    backgroundColor: colors.izinSoft,
    borderColor: colors.izin,
  },
  typeTabIzinActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  typeTabLemburActive: {
    backgroundColor: '#FFFBEB',
    borderColor: '#D97706',
  },
  typeIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  typeIconWrapActive: {
    backgroundColor: colors.izin,
  },
  typeIconWrapLemburActive: {
    backgroundColor: '#D97706',
  },
  typeTabText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  typeTabTextActive: {
    color: colors.ink,
  },
  typeTabLemburTextActive: {
    color: '#92400E',
    fontWeight: '800',
  },
  typeTabSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  typeTabSubActive: {
    color: colors.ink,
    fontWeight: '600',
  },
  typeTabLemburSubActive: {
    color: '#B45309',
    fontWeight: '600',
  },

  // Overtime Form Styles
  otChip: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    minWidth: 110,
  },
  otChipActive: {
    backgroundColor: '#D97706',
    borderColor: '#D97706',
  },
  otChipCode: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.ink,
  },
  otChipName: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
  otChipTextActive: {
    color: '#FFFFFF',
  },
  otTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  otTimeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 4,
  },
  otTimeInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.ink,
    textAlign: 'center',
    fontWeight: '600',
  },
  otQuickSlotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  otQuickSlotBtn: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  otQuickSlotBtnActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#D97706',
  },
  otQuickSlotText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  otQuickSlotTextActive: {
    color: '#B45309',
    fontWeight: '700',
  },
  otEstimateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: radius.sm,
    padding: 8,
    marginTop: 4,
  },
  otEstimateText: {
    fontSize: 11,
    color: '#92400E',
    fontWeight: '600',
  },
  durationRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  durationBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: '#F8FBFE',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  durationBtnActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  durationBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.muted,
  },
  durationBtnTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  halfDayBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sessionPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  sessionPill: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  sessionPillActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  sessionPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textAlign: 'center',
  },
  sessionPillTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  halfDayNote: {
    fontSize: 11,
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  dateRow: {
    flexDirection: 'row',
  },
  dateCol: {
    flex: 1,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FBFE',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 50,
    gap: 4,
  },
  dateValue: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.ink,
  },
  inputIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#F8FBFE',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fontSize.sm,
    color: colors.ink,
    minHeight: 50,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as any) : {}),
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },
  attachmentBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    padding: 12,
  },
  attachmentIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  attachmentThumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    marginRight: 10,
    backgroundColor: '#FFFFFF',
  },
  attachmentInfo: {
    flex: 1,
  },
  attachmentName: {
    fontSize: fontSize.sm,
    color: colors.ink,
    fontWeight: '700',
  },
  attachmentSub: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  removeBtn: {
    padding: 8,
  },
  uploadArea: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: '#F8FBFE',
    borderRadius: radius.md,
    paddingVertical: 22,
    paddingHorizontal: 16,
  },
  uploadIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  uploadTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  uploadHint: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 4,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 18,
    fontWeight: '500',
  },
  buttonContainer: {
    gap: 10,
  },
  submitButton: {
    backgroundColor: colors.izin,
    borderColor: colors.izin,
  },
  backActionButton: {
    borderColor: colors.borderStrong,
  },
  calNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  calNavBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calNavTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
  },
  calWeekRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  calWeekCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
  },
  calWeekText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.muted,
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
  },
  calDay: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
  },
  calDayActive: {
    backgroundColor: colors.primary,
  },
  calDayWeekend: {
    backgroundColor: colors.izinSoft,
  },
  calDayText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.ink,
  },
  calDayTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  calDayTextWeekend: {
    color: colors.izin,
  },
  calHint: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
