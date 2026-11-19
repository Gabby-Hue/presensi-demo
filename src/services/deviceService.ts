import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface DeviceDetails {
  modelName: string;
  deviceId: string;
  brand: string;
  osName: string;
}

const DEVICE_KEY = 'epresensi_device_fingerprint';
const DEVICE_COOKIE = 'epresensi_device_id';

let cachedInfo: DeviceDetails | null = null;
let inflight: Promise<DeviceDetails> | null = null;

/**
 * Normalisasi ID perangkat: hanya huruf/angka, huruf besar, panjang wajar.
 * ID yang tidak valid dianggap kosong supaya tidak pernah terkirim setengah jadi.
 */
function normalizeId(raw: unknown): string {
  const value = String(raw ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return value.length >= 8 ? value.slice(0, 64) : '';
}

/** ID acak 32 karakter hex — tidak pernah sama antar perangkat. */
function generateId(): string {
  const bytes = new Uint8Array(16);
  let filled = false;
  try {
    const c = typeof crypto !== 'undefined' ? (crypto as any) : null;
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(bytes);
      filled = true;
    }
  } catch {
    // lanjut ke Math.random
  }
  if (!filled) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function readCookie(name: string): string | null {
  try {
    if (typeof document === 'undefined' || !document.cookie) return null;
    const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string) {
  try {
    if (typeof document === 'undefined') return;
    const maxAge = 365 * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch {
    // abaikan — storage utama tetap dipakai
  }
}

/**
 * Baca ID yang tersimpan. Di web memakai AsyncStorage (localStorage) + cookie
 * sebagai cadangan, sehingga membersihkan localStorage saja tidak otomatis
 * memberi "perangkat baru".
 */
async function readStoredId(): Promise<string> {
  try {
    const stored = normalizeId(await AsyncStorage.getItem(DEVICE_KEY));
    if (stored) return stored;
  } catch {
    // abaikan
  }
  const cookieId = normalizeId(readCookie(DEVICE_COOKIE));
  if (cookieId) {
    // Pulihkan ke AsyncStorage kalau cookie masih ada.
    try {
      await AsyncStorage.setItem(DEVICE_KEY, cookieId);
    } catch {
      // abaikan
    }
    return cookieId;
  }
  return '';
}

async function persistId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DEVICE_KEY, id);
  } catch {
    // abaikan — cookie masih menyimpan
  }
  if (Platform.OS === 'web') writeCookie(DEVICE_COOKIE, id);
}

/** Label ramah untuk perangkat web, mis. "Chrome · Windows". */
function webDeviceLabel(): string {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const browser = /Edg\//.test(ua)
      ? 'Microsoft Edge'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Browser';
    const os = /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iPod/.test(ua)
          ? 'iOS'
          : /Mac OS X/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
    return os ? `${browser} · ${os}` : browser;
  } catch {
    return 'Web Browser';
  }
}

async function detectDeviceInfo(): Promise<DeviceDetails> {
  const brand = Device.brand || (Platform.OS === 'web' ? 'Web Browser' : 'Unknown Brand');
  const model = Device.modelName || (Platform.OS === 'web' ? 'Browser Client' : 'Mobile Device');
  const osName = Device.osName || Platform.OS;
  let deviceId = '';

  // 1. ID bawaan OS (paling stabil dan tidak bisa dipakai bersama perangkat lain)
  try {
    if (Platform.OS === 'android') {
      deviceId = normalizeId(Application.getAndroidId());
    } else if (Platform.OS === 'ios') {
      deviceId = normalizeId(await Application.getIosIdForVendorAsync());
    }
  } catch {
    // fallback ke ID tersimpan di bawah
  }

  // 2. ID tersimpan per pemasangan aplikasi (web / native tanpa ID OS)
  if (!deviceId) {
    deviceId = await readStoredId();
  }

  // 3. Buat ID baru bila memang belum ada. TIDAK memakai ID bersama.
  if (!deviceId) {
    deviceId = generateId();
  }

  await persistId(deviceId);

  const modelFormatted =
    Platform.OS === 'web'
      ? webDeviceLabel()
      : brand.toLowerCase() === 'apple'
        ? `${model}`
        : `${brand} ${model}`;

  return {
    modelName: modelFormatted,
    deviceId,
    brand,
    osName,
  };
}

/**
 * Deteksi informasi perangkat. Hasil di-cache supaya konsisten selama sesi
 * (ID tidak berubah di tengah pemakaian).
 */
export async function getDeviceInfo(): Promise<DeviceDetails> {
  if (cachedInfo) return cachedInfo;
  if (inflight) return inflight;
  inflight = detectDeviceInfo()
    .then((info) => {
      cachedInfo = info;
      return info;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** ID perangkat saja — dipakai untuk header X-Device-Id di setiap request. */
export async function getDeviceId(): Promise<string> {
  try {
    return (await getDeviceInfo()).deviceId;
  } catch {
    return '';
  }
}
