import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { LocationCoords } from '../types/attendance';

// Cache memory koordinat terakhir yang valid agar tidak loncat ke koordinat default bila ada lag sesaat
let cachedLastCoords: LocationCoords | null = null;

/**
 * Calculates distance in meters between two lat/lng coordinates using the Haversine formula.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Requests location permissions and fetches current GPS position with High Accuracy.
 * Menggunakan strategi 2-tahap (Fast Last-Known + Precision High Lock) agar tidak tersangkut/lama di awal.
 */
export async function getCurrentLocation(): Promise<{
  coords: LocationCoords;
  errorMsg: string | null;
}> {
  // 1. Tangani Web Platform secara native via navigator.geolocation untuk presisi maksimal & responsif
  if (Platform.OS === 'web' && typeof window !== 'undefined' && 'geolocation' in navigator) {
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 7000,
          maximumAge: 10000,
        });
      });

      const resCoords: LocationCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? undefined,
      };
      cachedLastCoords = resCoords;
      return { coords: resCoords, errorMsg: null };
    } catch {
      // Jika browser geolocation timeout/ditolak, fallback ke Expo Location handler di bawah
    }
  }

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      const fallback = cachedLastCoords || { latitude: -7.23707, longitude: 112.6346 };
      return {
        coords: fallback,
        errorMsg: 'Izin akses lokasi belum diberikan. Aktifkan izin lokasi di pengaturan browser/perangkat Anda.',
      };
    }

    // Cek posisi terakhir yang tersimpan untuk instant warmup (mencegah loading lama saat awal buka)
    try {
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (lastKnown?.coords) {
        cachedLastCoords = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
          accuracy: lastKnown.coords.accuracy ?? undefined,
        };
      }
    } catch {
      // Abaikan jika last known belum ada
    }

    // Ambil posisi real-time dengan akurasi TINGGI (High)
    const locationPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    // Timeout 7 detik agar tidak stuck selamanya jika sinyal satelit lemah di dalam ruangan
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('GPS_TIMEOUT')), 7000)
    );

    const location = await Promise.race([locationPromise, timeoutPromise]);

    const resCoords: LocationCoords = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
    };
    cachedLastCoords = resCoords;

    return {
      coords: resCoords,
      errorMsg: null,
    };
  } catch (err: any) {
    if (cachedLastCoords) {
      // Gunakan posisi cache terakhir jika timeout daripada melempar ke Jakarta
      return {
        coords: cachedLastCoords,
        errorMsg: null,
      };
    }

    return {
      coords: { latitude: -7.23707, longitude: 112.6346 },
      errorMsg: err.message === 'GPS_TIMEOUT'
        ? 'Sinyal GPS lemah di dalam ruangan. Silakan coba tekan Perbarui Lokasi lagi.'
        : (err.message || 'Gagal membaca lokasi perangkat.'),
    };
  }
}

/**
 * Formats distance display string (e.g., "45 m" or "1.2 km")
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${meters} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}
