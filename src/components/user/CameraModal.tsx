// Hallmark Component · CameraModal (Viewfinder Verification)
// Anti-AI-slop: Authentic photographic viewfinder, zero cybernetic grids, locked tokens.

import React, { createElement, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button } from '../ui/Button';
import { Feather } from '@expo/vector-icons';
import { colors, fontSize, radius, spacing } from '../../theme';
import { tap } from '../../services/feedbackService';

export interface AttendancePhotoMetadata {
  userName?: string;
  department?: string;
  companyName?: string;
  sessionLabel?: string;
  statusLabel?: string;
  officeName?: string;
  distanceText?: string;
  latitude?: number;
  longitude?: number;
  deviceModel?: string;
}

interface CameraModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirmPhoto: (photoUri: string) => void;
  attendanceTypeLabel: string;
  metadata?: AttendancePhotoMetadata;
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  metadata: AttendancePhotoMetadata,
  attendanceTypeLabel: string
) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const fullTimestamp = `${dateStr} • ${timeStr} WIB`;

  const scale = Math.max(1, width / 640);
  const paddingX = Math.round(14 * scale);
  const stripHeight = Math.round(112 * scale);
  const startY = height - stripHeight;

  // 1. Solid Dark Slate Background (100% Solid Opaque, TIDAK transparan)
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, startY, width, stripHeight);

  // 2. Hairline Divider Elegan (Bukan border biru tebal!)
  ctx.fillStyle = '#1E293B';
  ctx.fillRect(0, startY, width, Math.max(1, Math.round(1 * scale)));

  // 3. Header Baris 1: Badge E-Presensi + Badge Sesi Presensi
  const isPulang = (metadata.sessionLabel || attendanceTypeLabel || '').toLowerCase().includes('pulang');
  const sessionTag = metadata.sessionLabel || (isPulang ? 'PRESENSI PULANG' : 'PRESENSI MASUK');

  // Kotak Badge E-Presensi (Putih Bersih dengan Rounded Corners)
  const logoBoxW = Math.round(92 * scale);
  const logoBoxH = Math.round(26 * scale);
  const logoBoxX = paddingX;
  const logoBoxY = startY + Math.round(10 * scale);

  drawRoundRect(ctx, logoBoxX, logoBoxY, logoBoxW, logoBoxH, Math.round(5 * scale));
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  ctx.font = `bold ${Math.round(11 * scale)}px sans-serif`;
  ctx.fillStyle = '#0061A4';
  ctx.fillText('E-PRESENSI', logoBoxX + Math.round(8 * scale), logoBoxY + Math.round(17 * scale));

  // Badge Sesi (Masuk: Hijau Emerald / Pulang: Oranye Sunset)
  const badgeX = logoBoxX + logoBoxW + Math.round(8 * scale);
  const badgeH = Math.round(24 * scale);
  const badgePadX = Math.round(8 * scale);
  ctx.font = `bold ${Math.round(10.5 * scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const textMetrics = ctx.measureText(sessionTag);
  const badgeW = textMetrics.width + badgePadX * 2;

  drawRoundRect(ctx, badgeX, logoBoxY + Math.round(1 * scale), badgeW, badgeH, Math.round(4 * scale));
  ctx.fillStyle = isPulang ? '#D97706' : '#059669';
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(sessionTag, badgeX + badgePadX, logoBoxY + Math.round(17 * scale));

  // Label Status (jika ada, misal Tepat Waktu / Terlambat)
  if (metadata.statusLabel) {
    const statusX = badgeX + badgeW + Math.round(8 * scale);
    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold ${Math.round(10.5 * scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(`• ${metadata.statusLabel.toUpperCase()}`, statusX, logoBoxY + Math.round(17 * scale));
  }

  // 4. Baris 2: Waktu & Tanggal Realtime Presisi
  const timeY = startY + Math.round(54 * scale);
  ctx.font = `bold ${Math.round(12.5 * scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`Waktu: ${fullTimestamp}`, paddingX, timeY);

  // 5. Baris 3: Nama Karyawan & Departemen
  const nameY = startY + Math.round(72 * scale);
  ctx.font = `${Math.round(10.5 * scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = '#E2E8F0';
  const nameText = metadata.userName ? `${metadata.userName} (${metadata.department || 'Karyawan'})` : 'Karyawan Resmi';
  const deviceText = metadata.deviceModel ? ` • Perangkat: ${metadata.deviceModel}` : '';
  ctx.fillText(`Karyawan: ${nameText}${deviceText}`, paddingX, nameY);

  // 6. Baris 4: Geofence & Koordinat GPS
  const locY = startY + Math.round(90 * scale);
  ctx.fillStyle = '#38BDF8';
  const officeName = metadata.officeName || 'Kantor Cabang';
  const distance = metadata.distanceText ? ` (${metadata.distanceText})` : '';
  const coords =
    metadata.latitude !== undefined && metadata.longitude !== undefined
      ? ` • ${metadata.latitude.toFixed(6)}, ${metadata.longitude.toFixed(6)}`
      : '';
  ctx.fillText(`Lokasi: ${officeName}${distance}${coords}`, paddingX, locY);
}

export const CameraModal: React.FC<CameraModalProps> = ({
  visible,
  onClose,
  onConfirmPhoto,
  attendanceTypeLabel,
  metadata,
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [webStream, setWebStream] = useState<MediaStream | null>(null);
  const [webError, setWebError] = useState<string | null>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('front');

  const cameraRef = useRef<CameraView>(null);
  const videoNodeRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<any>(null);

  // Fallback upload via camera HP / file picker (tidak butuh izin browser)
  const handleFallbackCapture = (e: any) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;

      const img = new (window as any).Image();
      img.onload = () => {
        const iw = img.width || 640;
        const ih = img.height || 480;
        // Standard Portrait Selfie 3:4
        const targetAspect = 3 / 4;
        const currentAspect = iw / ih;

        let sx = 0, sy = 0, sw = iw, sh = ih;
        if (currentAspect > targetAspect) {
          sw = Math.round(ih * targetAspect);
          sx = Math.round((iw - sw) / 2);
        } else {
          sh = Math.round(iw / targetAspect);
          sy = Math.round((ih - sh) / 2);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 640;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          if (metadata) {
            drawWatermark(ctx, canvas.width, canvas.height, metadata, attendanceTypeLabel);
          }
          const watermarkedUrl = canvas.toDataURL('image/jpeg', 0.88);
          setCapturedPhoto(watermarkedUrl);
          stopWebCamera();
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  };

  const initWebCamera = async (targetFacing?: 'front' | 'back') => {
    setWebError(null);
    const activeFacing = targetFacing || facing;
    const webFacingMode = activeFacing === 'front' ? 'user' : 'environment';

    try {
      if (typeof window !== 'undefined' && navigator?.mediaDevices?.getUserMedia) {
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: webFacingMode }, width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          });
        } catch (constraintErr) {
          // Fallback jika constraint resolusi/facingMode ditolak oleh webcam tertentu
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: webFacingMode },
            audio: false,
          });
        }
        setWebStream(stream);

        if (videoNodeRef.current) {
          videoNodeRef.current.srcObject = stream;
          videoNodeRef.current.play().catch(() => {});
        }
      } else {
        setWebError('Peramban Anda tidak mendukung akses kamera.');
      }
    } catch (err: any) {
      const msg = err.message || '';
      if (err.name === 'NotAllowedError' || msg.toLowerCase().includes('permission denied')) {
        setWebError('Izin kamera diblokir browser. Silakan klik ikon gembok/setelan di kiri URL browser, ubah izin Kamera ke "Izinkan" (Allow), lalu refresh halaman.');
      } else {
        setWebError('Gagal mengakses kamera: ' + (msg || 'Izin kamera ditolak.'));
      }
    }
  };

  const toggleCameraFacing = () => {
    tap();
    const nextFacing = facing === 'front' ? 'back' : 'front';
    setFacing(nextFacing);

    if (Platform.OS === 'web') {
      stopWebCamera();
      setTimeout(() => {
        initWebCamera(nextFacing);
      }, 150);
    }
  };

  // Initialize Web Camera Stream when modal opens on Web
  useEffect(() => {
    if (visible && Platform.OS === 'web' && !capturedPhoto) {
      initWebCamera(facing);
    } else {
      stopWebCamera();
    }

    return () => {
      stopWebCamera();
    };
  }, [visible, capturedPhoto]);

  const stopWebCamera = () => {
    if (webStream) {
      webStream.getTracks().forEach((track) => track.stop());
      setWebStream(null);
    }
  };

  const handleTakePicture = async () => {
    if (Platform.OS === 'web' && webError) {
      fileInputRef.current?.click();
      return;
    }
    setCapturing(true);

    try {
      if (Platform.OS === 'web') {
        // Web Canvas Snapshot (Dipangkas 3:4 portrait natural + anti-terpotong)
        const video = videoNodeRef.current;
        if (video) {
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 480;
          const targetAspect = 3 / 4;
          const currentAspect = vw / vh;

          let sx = 0, sy = 0, sw = vw, sh = vh;
          if (currentAspect > targetAspect) {
            sw = Math.round(vh * targetAspect);
            sx = Math.round((vw - sw) / 2);
          } else {
            sh = Math.round(vw / targetAspect);
            sy = Math.round((vh - sh) / 2);
          }

          const canvas = document.createElement('canvas');
          canvas.width = 480;
          canvas.height = 640;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            if (facing === 'front') {
              ctx.translate(canvas.width, 0);
              ctx.scale(-1, 1); // Flip horizontally for natural selfie orientation
              ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
              ctx.setTransform(1, 0, 0, 1, 0, 0); // Restore identity transform
            } else {
              ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            }

            // Stempel metadata watermark
            if (metadata) {
              drawWatermark(ctx, canvas.width, canvas.height, metadata, attendanceTypeLabel);
            }

            const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
            setCapturedPhoto(dataUrl);
            stopWebCamera();
          }
        } else {
          setWebError('Kamera belum siap. Mohon tunggu...');
        }
      } else {
        // Native Expo Camera Snapshot
        if (cameraRef.current) {
          const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
          if (photo?.uri) {
            setCapturedPhoto(photo.uri);
          }
        }
      }
    } catch (e: any) {
      setWebError('Gagal mengambil potret: ' + e.message);
    } finally {
      setCapturing(false);
    }
  };

  const handleConfirm = () => {
    if (capturedPhoto) {
      onConfirmPhoto(capturedPhoto);
      setCapturedPhoto(null);
      stopWebCamera();
      onClose();
    }
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    if (Platform.OS === 'web') {
      setTimeout(initWebCamera, 250);
    }
  };

  const handleCloseModal = () => {
    stopWebCamera();
    setCapturedPhoto(null);
    onClose();
  };

  // Helper renderer for Web Video Element in React Native Web
  const renderWebVideo = () => {
    return (
      <View style={styles.webCameraContainer}>
        {/* Hidden Native Camera / File Input Fallback */}
        {createElement('input', {
          ref: fileInputRef,
          type: 'file',
          accept: 'image/*',
          capture: 'user',
          style: { display: 'none' },
          onChange: handleFallbackCapture,
        })}

        {webError ? (
          <View style={styles.webErrorBox}>
            <View style={styles.webErrorIconWrap}>
              <Feather name="camera" size={32} color={colors.primary} />
            </View>
            <Text style={styles.webErrorTitle}>Izin Kamera Browser Belum Aktif</Text>
            <Text style={styles.webErrorText}>
              Tenang, Anda tetap bisa langsung berfoto selfie menggunakan kamera bawaan ponsel tanpa perlu repot mengatur izin browser.
            </Text>

            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.fallbackPrimaryBtn}
              onPress={() => fileInputRef.current?.click()}
            >
              <Feather name="camera" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.fallbackPrimaryBtnText}>Buka Kamera Ponsel Langsung</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.7}
              style={styles.retryTextBtn}
              onPress={() => initWebCamera()}
            >
              <Feather name="refresh-cw" size={13} color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.retryTextBtnText}>Coba Nyalakan Kamera Browser</Text>
            </TouchableOpacity>

            <View style={styles.browserHintBox}>
              <Text style={styles.browserHintText}>
                Tips: Jika ingin kamera peramban menyala langsung di halaman ini, klik ikon setelan/gembok di sebelah kiri alamat web (URL) atas, ubah Kamera ke "Izinkan", lalu refresh halaman.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.videoWrapper}>
            {createElement('video', {
              ref: (node: HTMLVideoElement | null) => {
                videoNodeRef.current = node;
                if (node && webStream && node.srcObject !== webStream) {
                  node.srcObject = webStream;
                  node.play().catch(() => {});
                }
              },
              autoPlay: true,
              playsInline: true,
              muted: true,
              style: {
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: facing === 'front' ? 'scaleX(-1)' : 'none',
              },
            })}
            <View style={styles.targetGuideOverlay}>
              <View style={styles.targetCircle} />
              <Text style={styles.targetGuideText}>
                {facing === 'front' ? 'Posisikan wajah Anda di dalam panduan' : 'Arahkan kamera ke objek / lokasi kerja'}
              </Text>
            </View>

            {/* Quick Switch Camera Facing (Depan / Belakang) */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.flipFloatingBtn}
              onPress={toggleCameraFacing}
            >
              <Feather name="refresh-cw" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.flipFloatingBtnText}>
                {facing === 'front' ? 'Kamera Belakang' : 'Kamera Depan'}
              </Text>
            </TouchableOpacity>

            {/* Quick Switch to Phone Native Camera if Web Stream is Slow */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.switchCamFloatingBtn}
              onPress={() => fileInputRef.current?.click()}
            >
              <Feather name="camera" size={14} color={colors.ink} style={{ marginRight: 6 }} />
              <Text style={styles.switchCamFloatingText}>Ganti ke Kamera HP</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={handleCloseModal}>
      <SafeAreaView style={styles.container}>
        {/* Minimalist Top Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCloseModal} style={styles.closeBtn} accessibilityLabel="Tutup Kamera">
            <Feather name="x" size={20} color={colors.ink} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Verifikasi Swafoto</Text>
            <Text style={styles.headerSub}>{attendanceTypeLabel}</Text>
          </View>
          <TouchableOpacity
            onPress={toggleCameraFacing}
            style={styles.switchCamHeaderBtn}
            accessibilityLabel="Ganti Kamera Depan / Belakang"
            activeOpacity={0.7}
          >
            <Feather name="refresh-cw" size={17} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Captured Photo Validation vs Live Camera Stream */}
        {capturedPhoto ? (
          <View style={styles.previewContainer}>
            <View style={styles.validationBanner}>
              <Feather name="shield" size={18} color={colors.successInk} style={{ marginRight: 8 }} />
              <Text style={styles.validationText}>
                {metadata
                  ? 'Foto dan stempel metadata resmi (WIB, GPS, & Identitas) siap dikirim.'
                  : 'Foto berhasil diambil. Periksa kejelasan sebelum konfirmasi.'}
              </Text>
            </View>

            <View style={styles.photoFrame}>
              <Image source={{ uri: capturedPhoto }} style={styles.previewImage} />
            </View>

            <View style={styles.actionRow}>
              <Button
                title="Ambil Ulang"
                variant="outline"
                icon="refresh-cw"
                onPress={handleRetake}
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button
                title="Konfirmasi"
                variant="primary"
                icon="check"
                onPress={handleConfirm}
                style={{ flex: 1, marginLeft: 6 }}
              />
            </View>
          </View>
        ) : (
          <View style={styles.cameraViewArea}>
            {Platform.OS === 'web' ? (
              renderWebVideo()
            ) : !permission?.granted ? (
              <View style={styles.permissionBox}>
                <Feather name="camera-off" size={36} color={colors.faint} />
                <Text style={styles.permText}>Izin Kamera Diperlukan</Text>
                <Text style={styles.permSubText}>
                  Aplikasi membutuhkan akses kamera untuk mengambil foto bukti presensi langsung.
                </Text>
                <Button
                  title="Izinkan Akses Kamera"
                  onPress={requestPermission}
                  style={{ marginTop: 14 }}
                />
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <CameraView mode="picture" style={styles.nativeCamera} facing={facing} ref={cameraRef}>
                  <View style={styles.targetGuideOverlay}>
                    <View style={styles.targetCircle} />
                    <Text style={styles.targetGuideText}>
                      {facing === 'front' ? 'Posisikan wajah Anda di dalam panduan' : 'Arahkan kamera ke objek / lokasi kerja'}
                    </Text>
                  </View>
                  {/* Floating Flip Button on Native */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.flipFloatingBtn}
                    onPress={toggleCameraFacing}
                  >
                    <Feather name="refresh-cw" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.flipFloatingBtnText}>
                      {facing === 'front' ? 'Kamera Belakang' : 'Kamera Depan'}
                    </Text>
                  </TouchableOpacity>
                </CameraView>
              </View>
            )}

            {/* Bottom Camera Snap Controls */}
            <View style={styles.bottomControls}>
              <View style={{ width: 48 }} />

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleTakePicture}
                disabled={capturing}
                style={styles.snapBtn}
                accessibilityLabel="Ambil Foto"
              >
                <View style={styles.snapInnerCircle} />
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={toggleCameraFacing}
                style={styles.switchCamBottomBtn}
                accessibilityLabel="Putar Kamera"
              >
                <Feather name="refresh-cw" size={20} color={colors.primary} />
                <Text style={styles.switchCamBottomText}>
                  {facing === 'front' ? 'Belakang' : 'Depan'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  headerTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: '500',
    marginTop: 1,
  },
  previewContainer: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  validationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    borderRadius: radius.md,
    width: '100%',
  },
  validationText: {
    fontSize: fontSize.sm,
    color: colors.successInk,
    fontWeight: '600',
    flex: 1,
  },
  photoFrame: {
    width: '100%',
    maxWidth: 320,
    aspectRatio: 3 / 4,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  cameraViewArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  webCameraContainer: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  videoWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.surfaceSoft,
  },
  webErrorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
  webErrorIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  webErrorTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 8,
    textAlign: 'center',
  },
  webErrorText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 320,
    lineHeight: 20,
  },
  fallbackPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    marginTop: 18,
    width: '100%',
    maxWidth: 300,
  },
  fallbackPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  retryTextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 6,
  },
  retryTextBtnText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  browserHintBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 320,
  },
  browserHintText: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textAlign: 'center',
    lineHeight: 18,
  },
  switchCamFloatingBtn: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  switchCamFloatingText: {
    color: colors.ink,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  nativeCamera: {
    flex: 1,
  },
  targetGuideOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  targetCircle: {
    width: 220,
    height: 300,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  targetGuideText: {
    color: colors.ink,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  switchCamHeaderBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  flipFloatingBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    zIndex: 20,
  },
  flipFloatingBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  bottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  switchCamBottomBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  switchCamBottomText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 3,
  },
  snapBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  snapInnerCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
  },
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
  permText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 14,
  },
  permSubText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 6,
  },
});
