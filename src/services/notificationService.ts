import { Platform } from 'react-native';
import { supabase, supabaseUrl } from '../lib/supabase';

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  url?: string | null;
  readAt?: string | null;
  createdAt: string;
}

const map = (n: any): AppNotification => ({
  id: n.id,
  kind: n.kind,
  title: n.title,
  body: n.body,
  url: n.url,
  readAt: n.read_at,
  createdAt: n.created_at,
});

export async function listNotifications(userId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data || []).map(map);
}

export async function markAllRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

/** Dengarkan notifikasi baru secara realtime. Mengembalikan fungsi berhenti. */
export function onNewNotification(userId: string, cb: (n: AppNotification) => void): () => void {
  const channel = supabase
    .channel('notif-' + userId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + userId },
      (payload) => cb(map(payload.new))
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ---------------- Web push ----------------

export type PushState = 'unsupported' | 'ios-needs-install' | 'denied' | 'off' | 'on';

const isWeb = () => Platform.OS === 'web' && typeof window !== 'undefined' && typeof navigator !== 'undefined';

function isIosBrowserTab(): boolean {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (navigator as any).standalone;
  return ios && !standalone;
}

export async function getPushState(): Promise<PushState> {
  if (!isWeb()) return 'unsupported';
  if (isIosBrowserTab()) return 'ios-needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'on' : 'off';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function getVapidPublicKey(): Promise<string> {
  const { data } = await supabase.rpc('vapid_public_key');
  if (data) return data as string;
  // Kunci belum dibuat: minta Edge Function membuatnya sekali.
  const res = await fetch(supabaseUrl + '/functions/v1/send-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'init' }),
  });
  const json = await res.json();
  if (!json.publicKey) throw new Error('Kunci notifikasi belum tersedia.');
  return json.publicKey;
}

/** Minta izin, daftarkan perangkat ini, simpan langganan ke Supabase. */
export async function enablePush(userId: string): Promise<PushState> {
  if (!isWeb() || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(await getVapidPublicKey()) as BufferSource,
    });
  }
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
  return 'on';
}

/** Matikan notifikasi di perangkat ini. */
export async function disablePush(): Promise<void> {
  if (!isWeb() || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
