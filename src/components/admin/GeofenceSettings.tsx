import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { OfficeSettings } from '../../types/attendance';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MapView } from '../ui/MapView';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { getCurrentLocation } from '../../services/locationService';
import { Feather } from '@expo/vector-icons';
import { colors, fontSize, radius, spacing } from '../../theme';
import { select, succeed, fail } from '../../services/feedbackService';
import { formatTimeInput, startTimeChange } from '../../utils/time';
import { SelectDropdown } from '../ui/SelectDropdown';
import { AttendanceService } from '../../services/attendanceService';

interface OfficeManagerProps {
  offices: OfficeSettings[];
  onAdd: (params: {
    officeName: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    color?: string;
    workStartTime?: string;
    workEndTime?: string;
    lateDeadline?: string;
    address?: string;
  }) => Promise<{ success: boolean; message: string }>;
  onUpdate: (
    id: string,
    params: {
      officeName: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
      color?: string;
      workStartTime?: string;
      workEndTime?: string;
      lateDeadline?: string;
      address?: string;
    }
  ) => Promise<{ success: boolean; message: string }>;
  onDelete: (id: string) => Promise<{ success: boolean; message: string }>;
  /** Perusahaan admin, untuk pengaturan batas absen masuk lebih awal. */
  companyId?: string;
}

const EARLY_OPTIONS = [
  { value: '15', label: '15 menit sebelum jam masuk' },
  { value: '30', label: '30 menit sebelum jam masuk' },
  { value: '60', label: '1 jam sebelum jam masuk' },
  { value: '120', label: '2 jam sebelum jam masuk' },
  { value: 'none', label: 'Tanpa batas' },
];

const EMPTY_FORM = {
  officeName: '',
  latitude: '',
  longitude: '',
  radiusMeters: '150',
  color: '#2196F3',
  workStartTime: '08:00',
  workEndTime: '17:00',
  lateDeadline: '10:00',
  address: '',
};

export const OFFICE_COLORS = ['#2196F3', '#16A34A', '#EA580C', '#7C3AED', '#0D9488', '#DC2626'];

function normalizeTimeString(t?: string): string | null {
  if (!t) return null;
  let clean = t.trim().replace('.', ':');
  if (/^\d:\d{2}$/.test(clean)) {
    clean = '0' + clean;
  }
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(clean)) {
    return clean;
  }
  return null;
}

export const GeofenceSettings: React.FC<OfficeManagerProps> = ({
  companyId,
  offices,
  onAdd,
  onUpdate,
  onDelete,
}) => {
  const [earlyValue, setEarlyValue] = useState('30');
  const [earlyMsg, setEarlyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    AttendanceService.getEarlyCheckinMinutes(companyId)
      .then((m) => setEarlyValue(m == null ? 'none' : String(m)))
      .catch(() => {});
  }, [companyId]);
  const saveEarly = async (v: string) => {
    const prev = earlyValue;
    setEarlyValue(v);
    setEarlyMsg(null);
    if (!companyId) return setEarlyMsg({ ok: false, text: 'Akun admin belum terhubung ke perusahaan.' });
    try {
      await AttendanceService.setEarlyCheckinMinutes(companyId, v === 'none' ? null : Number(v));
      setEarlyMsg({ ok: true, text: 'Tersimpan.' });
    } catch (e: any) {
      setEarlyValue(prev);
      setEarlyMsg({ ok: false, text: 'Gagal menyimpan: ' + (e?.message || e) });
    }
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(offices.length === 0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [addressQuery, setAddressQuery] = useState('');
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingGps, setFetchingGps] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [optimisticallyRemoved, setOptimisticallyRemoved] = useState<string[]>([]);
  const [officeToDelete, setOfficeToDelete] = useState<OfficeSettings | null>(null);
  const [globalStart, setGlobalStart] = useState(() => offices[0]?.workStartTime || '08:00');
  const [globalEnd, setGlobalEnd] = useState(() => offices[0]?.workEndTime || '17:00');
  const [globalLate, setGlobalLate] = useState(() => offices[0]?.lateDeadline || '10:00');
  const [savingGlobalHours, setSavingGlobalHours] = useState(false);
  const hasInitializedHours = useRef(false);
  const [feedbackDialog, setFeedbackDialog] = useState<{
    title: string;
    message: string;
    variant: 'primary' | 'danger';
  } | null>(null);

  useEffect(() => {
    setOptimisticallyRemoved([]);
    // Inisialisasi jam global HANYA saat data pertama kali dimuat.
    // Mencegah input ter-reset kembali ke default saat background polling 10 detik berjalan.
    if (!hasInitializedHours.current && offices.length > 0 && offices[0]) {
      if (offices[0].workStartTime) setGlobalStart(offices[0].workStartTime);
      if (offices[0].workEndTime) setGlobalEnd(offices[0].workEndTime);
      if (offices[0].lateDeadline) setGlobalLate(offices[0].lateDeadline);
      hasInitializedHours.current = true;
    }
  }, [offices]);

  const handleSaveGlobalHours = async () => {
    select();
    const cleanStart = normalizeTimeString(globalStart);
    const cleanLate = normalizeTimeString(globalLate);
    const cleanEnd = normalizeTimeString(globalEnd);

    if (!cleanStart || !cleanLate || !cleanEnd) {
      setFeedbackDialog({
        title: 'Format Jam Tidak Valid',
        message: 'Masukkan jam dengan format JJ:MM yang benar (contoh: 08:00, 10:00, 17:00). Format titik seperti 08.00 juga otomatis diterima.',
        variant: 'danger',
      });
      return;
    }

    setSavingGlobalHours(true);
    try {
      for (const off of visibleOffices) {
        await onUpdate(off.id, {
          officeName: off.officeName,
          latitude: off.latitude,
          longitude: off.longitude,
          radiusMeters: off.radiusMeters,
          color: off.color,
          workStartTime: cleanStart,
          workEndTime: cleanEnd,
          lateDeadline: cleanLate,
          address: off.address,
        });
      }
      setGlobalStart(cleanStart);
      setGlobalEnd(cleanEnd);
      setGlobalLate(cleanLate);
      succeed();
      setFeedbackDialog({
        title: 'Jam Kerja Global Disimpan',
        message: `Jam kerja global cabang berhasil diatur ke ${cleanStart} - ${cleanEnd} WIB (Batas ${cleanLate}). Berlaku untuk semua titik kantor.`,
        variant: 'primary',
      });
    } catch (err: any) {
      fail();
      setFeedbackDialog({
        title: 'Gagal Menyimpan',
        message: err?.message || 'Gagal memperbarui jam kerja global.',
        variant: 'danger',
      });
    } finally {
      setSavingGlobalHours(false);
    }
  };

  const visibleOffices = offices.filter((office) => !optimisticallyRemoved.includes(office.id));
  const editing = editingId ? visibleOffices.find((o) => o.id === editingId) ?? null : null;

  useEffect(() => {
    if (editing) {
      setForm({
        officeName: editing.officeName,
        latitude: editing.latitude.toString(),
        longitude: editing.longitude.toString(),
        radiusMeters: editing.radiusMeters.toString(),
        color: editing.color || '#2196F3',
        workStartTime: editing.workStartTime || '08:00',
        workEndTime: editing.workEndTime || '17:00',
        lateDeadline: editing.lateDeadline || '10:00',
        address: editing.address || '',
      });
      setAddressQuery(editing.address || '');
    }
  }, [editingId]);

  const latNum = parseFloat(form.latitude);
  const lngNum = parseFloat(form.longitude);
  const radNum = parseInt(form.radiusMeters, 10);
  const previewLat = isFinite(latNum) ? latNum : (editing?.latitude ?? visibleOffices[0]?.latitude ?? -6.2088);
  const previewLng = isFinite(lngNum) ? lngNum : (editing?.longitude ?? visibleOffices[0]?.longitude ?? 106.8456);
  const previewRad = Number.isInteger(radNum) && radNum > 0 ? radNum : (editing?.radiusMeters ?? 150);

  const [isCustomHours, setIsCustomHours] = useState(false);

  const handleLatChange = (text: string) => {
    // Deteksi jika user paste sepasang koordinat lengkap dari Google Maps: "-7.237564, 112.634711"
    const match = text.match(/(-?\d+\.\d{3,})\s*[,|\s]\s*(-?\d+\.\d{3,})/);
    if (match) {
      setForm((f) => ({
        ...f,
        latitude: parseFloat(match[1]).toFixed(6),
        longitude: parseFloat(match[2]).toFixed(6),
      }));
      succeed();
      return;
    }
    setForm((f) => ({ ...f, latitude: text }));
  };

  const handleLngChange = (text: string) => {
    const match = text.match(/(-?\d+\.\d{3,})\s*[,|\s]\s*(-?\d+\.\d{3,})/);
    if (match) {
      setForm((f) => ({
        ...f,
        latitude: parseFloat(match[1]).toFixed(6),
        longitude: parseFloat(match[2]).toFixed(6),
      }));
      succeed();
      return;
    }
    setForm((f) => ({ ...f, longitude: text }));
  };

  const scrollToForm = () => {
    setTimeout(() => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const el = document.getElementById('geofence-form-card');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 100);
  };

  const startAdd = () => {
    select();
    setEditingId(null);
    setForm(EMPTY_FORM);
    setAddressQuery('');
    setIsCustomHours(false);
    setShowForm(true);
    scrollToForm();
  };

  const startEdit = (office: OfficeSettings) => {
    select();
    setEditingId(office.id);
    setShowForm(true);
    setAddressQuery(office.address || '');
    const hasCustom = (office.workStartTime && office.workStartTime !== '08:00') ||
                      (office.workEndTime && office.workEndTime !== '17:00') ||
                      (office.lateDeadline && office.lateDeadline !== '10:00');
    setIsCustomHours(!!hasCustom);
    setForm({
      officeName: office.officeName,
      latitude: office.latitude.toString(),
      longitude: office.longitude.toString(),
      radiusMeters: office.radiusMeters.toString(),
      color: office.color || '#2196F3',
      workStartTime: office.workStartTime || '08:00',
      workEndTime: office.workEndTime || '17:00',
      lateDeadline: office.lateDeadline || '10:00',
      address: office.address || '',
    });
    scrollToForm();
  };

  const cancelForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setAddressQuery('');
    setShowForm(offices.length === 0);
  };

  const handleSearchAddress = async () => {
    const q = addressQuery.trim();
    if (!q) {
      setFeedbackDialog({
        title: 'Alamat Kosong',
        message: 'Ketik nama jalan atau daerah yang ingin dicari (contoh: Jl. Western Village, Surabaya).',
        variant: 'danger',
      });
      return;
    }

    // 1. Cek jika user menempelkan koordinat langsung atau URL Google Maps (misal: -7.236417, 112.635284)
    const coordMatch = q.match(/(-?\d+\.\d{3,})\s*,\s*(-?\d+\.\d{3,})/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]).toFixed(6);
      const lng = parseFloat(coordMatch[2]).toFixed(6);
      setForm((f) => ({
        ...f,
        latitude: lat,
        longitude: lng,
        address: f.address || q,
      }));
      succeed();
      setFeedbackDialog({
        title: 'Koordinat Terdeteksi',
        message: `Berhasil mendeteksi koordinat: ${lat}, ${lng}`,
        variant: 'primary',
      });
      return;
    }

    setSearchingAddress(true);

    // 2. Bangun kandidat pencarian cerdas (otomatis membersihkan No/Blok/RT yang tidak diindeks peta)
    const candidates: string[] = [q];

    const cleaned = q
      .replace(/\b(blk\.?|blok)\s*[a-z0-9\-\s\.]+(?=,|$)/gi, '')
      .replace(/\b(no\.?|nomor)\s*[0-9a-z\-\s/]+(?=,|$)/gi, '')
      .replace(/\b(rt|rw)\.?\s*\d+/gi, '')
      .replace(/\b\d{5}\b/g, '')
      .replace(/\b(komp\.?|kompleks?|ruko)\b/gi, '')
      .replace(/\beast java\b/gi, 'Jawa Timur')
      .replace(/\bwest java\b/gi, 'Jawa Barat')
      .replace(/\bcentral java\b/gi, 'Jawa Tengah')
      .replace(/\bcity\b/gi, '');

    const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
    const cleanedJoined = parts.join(', ');
    if (cleanedJoined && cleanedJoined !== q) {
      candidates.push(cleanedJoined);
    }

    if (parts.length >= 2) {
      candidates.push(`${parts[0]}, ${parts[parts.length - 1]}`);
      if (parts.length >= 3) {
        candidates.push(`${parts[0]}, ${parts[parts.length - 2]}`);
      }
    }

    const streetOnly = parts[0]?.replace(/^(jl\.?|jalan)\s+/i, '');
    if (streetOnly && parts.length >= 2) {
      candidates.push(`${streetOnly}, ${parts[parts.length - 1]}`);
    }

    try {
      let foundItem: any = null;
      for (const cand of candidates) {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cand)}&limit=1&countrycodes=id`;
          const res = await fetch(url, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'EPresensiApp/1.0',
            },
          });
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            foundItem = data[0];
            break;
          }
        } catch {
          // Lanjut ke kandidat berikutnya
        }
      }

      if (foundItem) {
        const lat = parseFloat(foundItem.lat).toFixed(6);
        const lng = parseFloat(foundItem.lon).toFixed(6);
        setForm((f) => ({
          ...f,
          latitude: lat,
          longitude: lng,
          address: foundItem.display_name,
          officeName: f.officeName ? f.officeName : (foundItem.name || q.split(',')[0]),
        }));
        succeed();
        setFeedbackDialog({
          title: 'Lokasi Ditemukan',
          message: `Titik koordinat berhasil disesuaikan ke:\n${foundItem.display_name}`,
          variant: 'primary',
        });
      } else {
        fail();
        setFeedbackDialog({
          title: 'Tidak Ditemukan',
          message: `Alamat tidak ditemukan. Coba ketik nama jalan utama dan kotanya saja, contoh:\n"Jl. Jenderal Sudirman, Jakarta" atau "Jl. Pemuda, Surabaya".`,
          variant: 'danger',
        });
      }
    } catch {
      fail();
      setFeedbackDialog({
        title: 'Pencarian Gagal',
        message: 'Gagal terhubung ke layanan geocoding. Pastikan koneksi internet aktif.',
        variant: 'danger',
      });
    } finally {
      setSearchingAddress(false);
    }
  };

  const handleUseCurrentGps = async () => {
    setFetchingGps(true);
    const { coords, errorMsg } = await getCurrentLocation();
    setFetchingGps(false);
    if (errorMsg) {
      setFeedbackDialog({
        title: 'GPS',
        message: errorMsg,
        variant: 'danger',
      });
    }
    setForm((f) => ({ ...f, latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6) }));
  };

  const handleSave = async () => {
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    const rad = parseInt(form.radiusMeters, 10);
    if (!form.officeName.trim()) {
      setFeedbackDialog({
        title: 'Belum lengkap',
        message: 'Isi nama kantor dulu, contoh: Kantor Pusat / Cabang Sidoarjo.',
        variant: 'danger',
      });
      return;
    }
    if (!isFinite(lat) || !isFinite(lng) || !Number.isInteger(rad) || rad <= 0) {
      setFeedbackDialog({
        title: 'Tidak valid',
        message: 'Periksa koordinat dan radius (bilangan bulat meter).',
        variant: 'danger',
      });
      return;
    }
    let workStart = '08:00';
    let workEnd = '17:00';
    let lateDead = '10:00';

    if (isCustomHours) {
      const cleanStart = normalizeTimeString(form.workStartTime);
      const cleanLate = normalizeTimeString(form.lateDeadline);
      const cleanEnd = normalizeTimeString(form.workEndTime);
      if (!cleanStart || !cleanLate || !cleanEnd) {
        setFeedbackDialog({
          title: 'Format Jam Custom Tidak Valid',
          message: 'Periksa jam kerja custom pada titik ini. Gunakan format JJ:MM (contoh: 08:30).',
          variant: 'danger',
        });
        return;
      }
      workStart = cleanStart;
      lateDead = cleanLate;
      workEnd = cleanEnd;
    } else {
      workStart = normalizeTimeString(globalStart) || '08:00';
      lateDead = normalizeTimeString(globalLate) || '10:00';
      workEnd = normalizeTimeString(globalEnd) || '17:00';
    }

    setSaving(true);
    const payload = {
      officeName: form.officeName,
      latitude: lat,
      longitude: lng,
      radiusMeters: rad,
      color: form.color,
      workStartTime: workStart,
      workEndTime: workEnd,
      lateDeadline: lateDead,
      address: form.address || undefined,
    };
    const res = editingId
      ? await onUpdate(editingId, payload)
      : await onAdd(payload);
    setSaving(false);
    if (res.success) succeed();
    else fail();
    setFeedbackDialog({
      title: res.success ? 'Berhasil' : 'Gagal',
      message: res.message,
      variant: res.success ? 'primary' : 'danger',
    });
    if (res.success) {
      setEditingId(null);
      setForm(EMPTY_FORM);
      setAddressQuery('');
      setShowForm(false);
    }
  };

  const handleDelete = (office: OfficeSettings) => {
    select();
    setOfficeToDelete(office);
  };

  const confirmDeleteOffice = async () => {
    if (!officeToDelete) return;
    const target = officeToDelete;
    setOfficeToDelete(null);
    setDeletingId(target.id);
    const res = await onDelete(target.id);
    setDeletingId(null);
    if (res.success) {
      setOptimisticallyRemoved((current) => current.includes(target.id) ? current : [...current, target.id]);
      if (editingId === target.id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setShowForm(false);
      }
      succeed();
    } else {
      fail();
    }
    setFeedbackDialog({
      title: res.success ? 'Berhasil' : 'Gagal',
      message: res.message,
      variant: res.success ? 'primary' : 'danger',
    });
  };

  return (
    <View>
      {/* Card Jam Kerja Kantor Global (Default Cabang) */}
      <Card
        title="Jam Kerja Global Kantor (Default Cabang)"
        subtitle="Berlaku otomatis ke seluruh titik kantor yang tidak memakai jam kerja custom"
        icon="clock"
        style={{ marginBottom: spacing.md }}
      >
        <View style={styles.globalHoursGrid}>
          <View style={styles.globalHoursCol}>
            <Text style={styles.globalHoursLabel}>Jam Masuk</Text>
            <TextInput
              style={styles.globalHoursInput}
              value={globalStart}
              onChangeText={(v) => {
                const p = startTimeChange(v);
                setGlobalStart(p.start);
                if (p.late) setGlobalLate(p.late);
                if (p.end) setGlobalEnd(p.end);
              }}
              keyboardType="number-pad"
              maxLength={5}
              placeholder="08:00"
              placeholderTextColor={colors.faint}
            />
          </View>
          <View style={styles.globalHoursCol}>
            <Text style={styles.globalHoursLabel}>Batas Terlambat</Text>
            <TextInput
              style={styles.globalHoursInput}
              value={globalLate}
              onChangeText={(v) => setGlobalLate(formatTimeInput(v))}
              keyboardType="number-pad"
              maxLength={5}
              placeholder="08:30"
              placeholderTextColor={colors.faint}
            />
          </View>
          <View style={styles.globalHoursCol}>
            <Text style={styles.globalHoursLabel}>Jam Pulang</Text>
            <TextInput
              style={styles.globalHoursInput}
              value={globalEnd}
              onChangeText={(v) => setGlobalEnd(formatTimeInput(v))}
              keyboardType="number-pad"
              maxLength={5}
              placeholder="16:00"
              placeholderTextColor={colors.faint}
            />
          </View>
        </View>

        <Text style={[styles.globalHoursLabel, { marginTop: 14, marginBottom: 6 }]}>Absen masuk paling awal</Text>
        <SelectDropdown
          options={EARLY_OPTIONS}
          value={earlyValue}
          onChange={saveEarly}
          icon="unlock"
          accessibilityLabel="Absen masuk paling awal"
        />
        <Text style={{ fontSize: 11, marginTop: 4, color: earlyMsg && !earlyMsg.ok ? colors.danger : colors.muted }}>
          {earlyMsg?.text ||
            'Berlaku untuk jam kantor dan semua shift. Contoh: jam masuk 08:00 dengan batas 30 menit, absen dibuka 07:30. Lembur di hari libur tidak dibatasi.'}
        </Text>

        <View style={{ marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Button
            title={savingGlobalHours ? 'Menyimpan...' : 'Simpan Jam Kerja Global'}
            icon="check"
            variant="primary"
            loading={savingGlobalHours}
            onPress={handleSaveGlobalHours}
          />
        </View>
      </Card>

      <Card title={`Titik Kantor (${visibleOffices.length})`} icon="map-pin" subtitle="Tambah cabang, atur radius tiap titik">
        {/* Peta semua titik */}
        <View style={styles.mapBox}>
          <MapView
            userLat={previewLat}
            userLng={previewLng}
            officeLat={previewLat}
            officeLng={previewLng}
            radiusMeters={previewRad}
            offices={visibleOffices}
            activeOfficeId={editingId}
            mainColor={form.color}
            height={320}
            interactivePicker={showForm}
            onLocationSelect={(lat, lng) =>
              setForm((f) => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }))
            }
          />
        </View>
        <Text style={styles.hint}>
          {showForm
            ? 'Mode Edit Aktif: Pin navigasi dapat ditahan & digeser bebas atau ketuk peta untuk menaruh titik kantor.'
            : 'Mode Tinjau: Pin terkunci. Tekan tombol "+ Tambah titik baru" atau "Ubah" di bawah untuk mengedit posisi.'}
        </Text>

        {/* Daftar titik */}
        {visibleOffices.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="alert-triangle" size={26} color={colors.warning} style={{ marginBottom: 6 }} />
            <Text style={styles.emptyTitle}>Lokasi Kantor Cabang Belum Dikonfigurasi</Text>
            <Text style={styles.emptySub}>
              Sebagai admin cabang pertama, Anda harus menginput titik lokasi kantor dan jam kerja operasional terlebih dahulu pada form di bawah agar sistem presensi karyawan dapat mulai digunakan.
            </Text>
          </View>
        ) : (
          visibleOffices.map((office) => {
            const active = editingId === office.id;
            return (
              <View key={office.id} style={[styles.officeRow, active && styles.officeRowActive]}>
                <TouchableOpacity style={styles.officeInfo} activeOpacity={0.7} onPress={() => startEdit(office)}>
                  <View style={[styles.officeDot, { backgroundColor: office.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.officeName}>{office.officeName}</Text>
                    {office.address ? (
                      <Text style={styles.officeAddress} numberOfLines={1}>
                        Alamat: {office.address}
                      </Text>
                    ) : null}
                    <Text style={styles.officeSub}>
                      {office.latitude.toFixed(5)}, {office.longitude.toFixed(5)} • radius {office.radiusMeters} m
                    </Text>
                    <Text style={styles.officeHours}>
                      Jam Kerja: {office.workStartTime || '08:00'} - {office.workEndTime || '17:00'} WIB (Batas {office.lateDeadline || '10:00'})
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.faint} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(office)}
                  hitSlop={10}
                  style={styles.deleteBtn}
                  disabled={deletingId === office.id}
                >
                  <Text style={styles.deleteText}>{deletingId === office.id ? 'Menghapus...' : 'Hapus'}</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}

        <Button
          title={visibleOffices.length === 0 ? 'Input Titik Kantor Sekarang' : 'Tambah titik baru'}
          variant="outline"
          icon="plus"
          onPress={startAdd}
          style={styles.addBtn}
        />
      </Card>

      {showForm && (
      <View nativeID="geofence-form-card" style={{ marginTop: spacing.md }}>
      <Card title={editingId ? `Ubah: ${editing?.officeName}` : 'Tambah Titik Kantor Baru'} icon={editingId ? 'edit' : 'plus-circle'}>
        {/* Banner Panduan Interaktif */}
        <View style={styles.guideBanner}>
          <Feather name="navigation" size={16} color={colors.primary} style={{ marginTop: 2, marginRight: 8 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.guideTitle}>
              {editingId ? 'Panduan Ubah Titik Kantor' : 'Panduan Tambah Titik Kantor Baru'}
            </Text>
            <Text style={styles.guideText}>
              1. Ketik nama jalan di kolom cari alamat lalu tekan Cari (atau tahan & geser pin navigasi pada peta di atas).{'\n'}
              2. Atur radius batas presensi (disarankan 100 - 150 meter) dan jam kerja operasional.{'\n'}
              3. Tekan tombol "Simpan Titik Kantor" di bawah.
            </Text>
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Nama kantor</Text>
          <TextInput
            style={styles.input}
            value={form.officeName}
            onChangeText={(v) => setForm((f) => ({ ...f, officeName: v }))}
            placeholder="Contoh: Kantor Pusat, Cabang Sidoarjo"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Cari Alamat Jalan (Geocoding)</Text>
          <View style={styles.addressSearchRow}>
            <TextInput
              style={[styles.input, { flex: 1, minHeight: 48 }]}
              value={addressQuery}
              onChangeText={setAddressQuery}
              placeholder="Contoh: Jl. Jenderal Sudirman No. 10..."
              placeholderTextColor={colors.faint}
              onSubmitEditing={handleSearchAddress}
            />
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleSearchAddress}
              disabled={searchingAddress}
              style={styles.searchAddrBtn}
            >
              <Feather name="search" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.searchAddrBtnText}>{searchingAddress ? 'Mencari...' : 'Cari'}</Text>
            </TouchableOpacity>
          </View>
          {form.address ? (
            <View style={styles.foundAddressBox}>
              <Feather name="map-pin" size={13} color={colors.primary} style={{ marginTop: 2, marginRight: 6 }} />
              <Text style={styles.foundAddressText}>{form.address}</Text>
            </View>
          ) : null}
          <Text style={styles.hint}>
            Ketik alamat/nama jalan lalu tekan Cari untuk otomatis menaruh pin peta dan koordinat.
          </Text>
        </View>

        {/* Input Koordinat Lat & Lng (Sekali Paste dari Google Maps) */}
        <View style={styles.formGroup}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={styles.label}>Koordinat Titik Kantor</Text>
            <Text style={styles.coordPasteHint}>Bisa paste 1 baris dari Google Maps</Text>
          </View>
          <View style={styles.row}>
            <View style={[styles.formGroup, { flex: 1, marginRight: 6, marginBottom: 0 }]}>
              <Text style={styles.subLabel}>Latitude (Lintang)</Text>
              <TextInput
                style={styles.input}
                value={form.latitude}
                onChangeText={handleLatChange}
                placeholder="Contoh: -7.2375 atau paste format lengkap"
                placeholderTextColor={colors.faint}
              />
            </View>
            <View style={[styles.formGroup, { flex: 1, marginLeft: 6, marginBottom: 0 }]}>
              <Text style={styles.subLabel}>Longitude (Bujur)</Text>
              <TextInput
                style={styles.input}
                value={form.longitude}
                onChangeText={handleLngChange}
                placeholder="Contoh: 112.6347"
                placeholderTextColor={colors.faint}
              />
            </View>
          </View>
        </View>

        <Button
          title={fetchingGps ? 'Mengambil GPS...' : 'Pakai GPS Lokasi Saya Saat Ini'}
          variant="outline"
          icon="crosshair"
          loading={fetchingGps}
          onPress={handleUseCurrentGps}
          style={styles.gpsBtn}
        />

        {/* Baris Berdampingan Rapi: Radius & Warna Titik */}
        <View style={[styles.row, { marginBottom: 14 }]}>
          <View style={[styles.formGroup, { flex: 1, marginRight: 8, marginBottom: 0 }]}>
            <Text style={styles.label}>Radius Batas Absen</Text>
            <View style={styles.radiusRow}>
              <TextInput
                style={[styles.input, styles.radiusInput, { flex: 1 }]}
                value={form.radiusMeters}
                onChangeText={(v) => setForm((f) => ({ ...f, radiusMeters: v.replace(/[^0-9]/g, '') }))}
                keyboardType="numeric"
                placeholder="150"
              />
              <View style={styles.unitBox}>
                <Text style={styles.unitText}>meter</Text>
              </View>
            </View>
            <Text style={styles.fieldHintText}>Standar toleransi: 100 - 150 m</Text>
          </View>

          <View style={[styles.formGroup, { flex: 1, marginLeft: 8, marginBottom: 0 }]}>
            <Text style={styles.label}>Warna Penanda Titik</Text>
            <View style={styles.swatchRow}>
              {OFFICE_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  activeOpacity={0.8}
                  onPress={() => {
                    select();
                    setForm((f) => ({ ...f, color: c }));
                  }}
                  style={[
                    styles.swatch,
                    { backgroundColor: c },
                    form.color === c && styles.swatchActive,
                  ]}
                  hitSlop={6}
                >
                  {form.color === c && <Feather name="check" size={14} color="#FFFFFF" />}
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldHintText}>Penanda di daftar kantor</Text>
          </View>
        </View>

        {/* Jam Operasional & Shift (Global Cabang vs Custom Override) */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Jam Operasional & Shift</Text>
          <View style={styles.shiftToggleRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                select();
                setIsCustomHours(false);
                setForm((f) => ({ ...f, workStartTime: '08:00', lateDeadline: '10:00', workEndTime: '17:00' }));
              }}
              style={[styles.shiftToggleBtn, !isCustomHours && styles.shiftToggleBtnActive]}
            >
              <Feather name="globe" size={13} color={!isCustomHours ? colors.primaryDark : colors.muted} style={{ marginRight: 6 }} />
              <Text style={[styles.shiftToggleText, !isCustomHours && styles.shiftToggleTextActive]}>
                Ikuti Jam Global Cabang
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                select();
                setIsCustomHours(true);
              }}
              style={[styles.shiftToggleBtn, isCustomHours && styles.shiftToggleBtnActive]}
            >
              <Feather name="sliders" size={13} color={isCustomHours ? colors.primaryDark : colors.muted} style={{ marginRight: 6 }} />
              <Text style={[styles.shiftToggleText, isCustomHours && styles.shiftToggleTextActive]}>
                Custom Titik Ini (Override)
              </Text>
            </TouchableOpacity>
          </View>

          {!isCustomHours ? (
            <View style={styles.globalHoursBox}>
              <Feather name="check-circle" size={15} color={colors.primary} style={{ marginRight: 8, marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.globalHoursTitle}>Jam Default Cabang Aktif (08:00 - 17:00 WIB)</Text>
                <Text style={styles.globalHoursSub}>Masuk: 08:00 • Batas Terlambat: 10:00 • Buka Pulang: 17:00 WIB</Text>
              </View>
            </View>
          ) : (
            <View style={styles.customHoursCard}>
              <View style={styles.row}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 4, marginBottom: 0 }]}>
                  <Text style={styles.subLabel}>Jam Masuk</Text>
                  <TextInput
                    style={styles.input}
                    value={form.workStartTime}
                    onChangeText={(v) => {
                      const p = startTimeChange(v);
                      setForm((f) => ({
                        ...f,
                        workStartTime: p.start,
                        ...(p.late ? { lateDeadline: p.late } : {}),
                        ...(p.end ? { workEndTime: p.end } : {}),
                      }));
                    }}
                    keyboardType="number-pad"
                    maxLength={5}
                    placeholder="08:00"
                    placeholderTextColor={colors.faint}
                  />
                </View>
                <View style={[styles.formGroup, { flex: 1, marginHorizontal: 4, marginBottom: 0 }]}>
                  <Text style={styles.subLabel}>Batas Telat</Text>
                  <TextInput
                    style={styles.input}
                    value={form.lateDeadline}
                    onChangeText={(v) => setForm((f) => ({ ...f, lateDeadline: formatTimeInput(v) }))}
                    keyboardType="number-pad"
                    maxLength={5}
                    placeholder="08:30"
                    placeholderTextColor={colors.faint}
                  />
                </View>
                <View style={[styles.formGroup, { flex: 1, marginLeft: 4, marginBottom: 0 }]}>
                  <Text style={styles.subLabel}>Jam Pulang</Text>
                  <TextInput
                    style={styles.input}
                    value={form.workEndTime}
                    onChangeText={(v) => setForm((f) => ({ ...f, workEndTime: formatTimeInput(v) }))}
                    keyboardType="number-pad"
                    maxLength={5}
                    placeholder="16:00"
                    placeholderTextColor={colors.faint}
                  />
                </View>
              </View>
              <Text style={styles.customHoursHint}>Jam khusus ini akan meng-override jam operasional default cabang.</Text>
            </View>
          )}
        </View>

        <Button
          title={saving ? 'Menyimpan...' : editingId ? 'Simpan perubahan' : 'Simpan titik'}
          variant="primary"
          icon="save"
          loading={saving}
          onPress={handleSave}
        />
        {showForm && (
          <Button title="Batalkan" variant="outline" onPress={cancelForm} style={styles.cancelBtn} />
        )}
      </Card>
      </View>
      )}

      {/* Dialog Konfirmasi Hapus Titik Kantor */}
      <ConfirmDialog
        visible={!!officeToDelete}
        onClose={() => setOfficeToDelete(null)}
        onConfirm={confirmDeleteOffice}
        title="Hapus Titik Kantor?"
        message={`Titik "${officeToDelete?.officeName}" akan dihapus. Presensi lama yang tercatat di sini tidak ikut terhapus.`}
        confirmText="Ya, Hapus"
        cancelText="Batal"
        icon="trash-2"
        variant="danger"
      />

      {/* Dialog Feedback (Berhasil / Gagal) */}
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
  mapBox: { marginBottom: 8 },
  hint: { fontSize: fontSize.xs, color: colors.muted, fontWeight: '600', marginBottom: 12 },
  officeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  officeRowActive: { borderColor: colors.primary },
  officeInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12 },
  officeDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary, marginRight: 10 },
  officeName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.ink },
  officeAddress: { fontSize: fontSize.xs, color: colors.muted, marginTop: 1, fontWeight: '500' },
  officeSub: { fontSize: fontSize.xs, color: colors.muted, marginTop: 2, fontWeight: '600' },
  officeHours: { fontSize: fontSize.xs, color: colors.primaryDark, marginTop: 3, fontWeight: '700' },
  addressSearchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  searchAddrBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    minHeight: 48,
  },
  searchAddrBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: fontSize.xs },
  foundAddressBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primarySoft,
    padding: 8,
    borderRadius: radius.sm,
    marginBottom: 6,
  },
  foundAddressText: {
    fontSize: fontSize.xs,
    color: colors.primaryDark,
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
  emptyBox: {
    padding: 20,
    backgroundColor: '#FFFBEB',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: fontSize.xs,
    color: '#B45309',
    textAlign: 'center',
    lineHeight: 18,
  },
  deleteBtn: { paddingVertical: 8, paddingHorizontal: 10, marginRight: 8, borderWidth: 1, borderColor: '#E8B4B4', borderRadius: radius.sm, backgroundColor: '#FFF8F8' },
  deleteText: { color: colors.danger, fontSize: fontSize.xs, fontWeight: '700' },
  addBtn: { marginTop: 4, marginBottom: 4 },
  formGroup: { marginBottom: 12 },
  label: { fontSize: fontSize.xs, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  subLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.muted, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    color: colors.ink,
    minHeight: 44,
  },
  row: { flexDirection: 'row' },
  swatchRow: { flexDirection: 'row', gap: 8, marginTop: 2, marginBottom: 4 },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchActive: { borderColor: colors.ink },
  gpsBtn: { marginBottom: 12 },
  coordPasteHint: {
    fontSize: 11,
    color: colors.primaryDark,
    fontWeight: '700',
  },
  fieldHintText: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 4,
  },
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 44,
  },
  radiusInput: {
    minHeight: 44,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  unitBox: {
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 0,
    height: 44,
  },
  unitText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.muted },
  shiftToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  shiftToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shiftToggleBtnActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  shiftToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  shiftToggleTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  globalHoursBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: 10,
    marginTop: 2,
  },
  globalHoursTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  globalHoursSub: {
    fontSize: 11,
    color: colors.ink,
    marginTop: 1,
  },
  customHoursCard: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    marginTop: 2,
  },
  customHoursHint: {
    fontSize: 11,
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: 6,
  },
  cancelBtn: { marginTop: 8 },
  guideBanner: {
    flexDirection: 'row',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  guideTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primaryDark,
    marginBottom: 4,
  },
  guideText: {
    fontSize: 11,
    color: colors.ink,
    lineHeight: 18,
  },
  globalHoursGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  globalHoursCol: {
    flex: 1,
  },
  globalHoursLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  globalHoursInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    backgroundColor: colors.surface,
    textAlign: 'center',
  },
});
