import { supabase } from './supabase';
import { StorageService } from '../services/storageService';

export const apiBaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';

export async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

export async function setToken(_t: string | null): Promise<void> {
  // Ditangani secara otomatis oleh Supabase Auth client
}

export async function clearToken(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {}
}

export async function uploadFile(
  kind: 'avatar' | 'photo' | 'document',
  uri: string,
  filename?: string
): Promise<string> {
  return StorageService.uploadFile(kind, uri, filename);
}

export function resolveMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  const clean = String(url).trim();
  if (!clean) return null;
  return clean;
}
