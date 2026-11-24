import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Modal } from './Modal';
import { colors, fontSize, radius } from '../../theme';
import { select, succeed, fail } from '../../services/feedbackService';
import {
  AppNotification,
  PushState,
  disablePush,
  enablePush,
  getPushState,
  listNotifications,
  markAllRead,
  onNewNotification,
} from '../../services/notificationService';

interface Props {
  userId: string;
  /** Warna ikon lonceng (header gelap/terang). */
  color?: string;
}

const PUSH_HINT: Record<PushState, string> = {
  unsupported: 'Browser ini belum mendukung notifikasi. Notifikasi tetap tampil di daftar ini.',
  'ios-needs-install': 'Di iPhone: buka menu Bagikan lalu pilih "Tambah ke Layar Utama", buka PresensiPro dari layar utama, lalu aktifkan notifikasi di sini.',
  denied: 'Notifikasi diblokir di browser. Izinkan lewat pengaturan situs browser, lalu muat ulang halaman.',
  off: 'Aktifkan agar notifikasi muncul di perangkat ini walau aplikasi sedang ditutup.',
  on: 'Notifikasi aktif di perangkat ini.',
};

const timeAgo = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return 'baru saja';
  if (m < 60) return m + ' mnt lalu';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' jam lalu';
  return Math.round(h / 24) + ' hari lalu';
};

export const NotificationBell: React.FC<Props> = ({ userId, color = colors.ink }) => {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [push, setPush] = useState<PushState>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listNotifications(userId));
      setError(null);
    } catch (e: any) {
      setError('Gagal memuat notifikasi. (' + (e?.message || e) + ')');
    }
  }, [userId]);

  useEffect(() => {
    refresh();
    getPushState().then(setPush).catch(() => setPush('unsupported'));
    return onNewNotification(userId, (n) => setItems((list) => [n, ...list.filter((x) => x.id !== n.id)]));
  }, [userId, refresh]);

  const unread = items.filter((n) => !n.readAt).length;

  const openPanel = async () => {
    select();
    setOpen(true);
    setLoading(true);
    await refresh();
    setLoading(false);
  };

  const closePanel = async () => {
    setOpen(false);
    if (unread > 0) {
      const now = new Date().toISOString();
      setItems((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      markAllRead(userId).catch(() => refresh());
    }
  };

  const togglePush = async () => {
    select();
    setPushBusy(true);
    setError(null);
    try {
      if (push === 'on') {
        await disablePush();
        setPush('off');
      } else {
        setPush(await enablePush(userId));
      }
      succeed();
    } catch (e: any) {
      fail();
      setError('Gagal mengatur notifikasi perangkat. (' + (e?.message || e) + ')');
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        onPress={openPanel}
        style={styles.bellBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={unread ? 'Notifikasi, ' + unread + ' belum dibaca' : 'Notifikasi'}
      >
        <Feather name="bell" size={20} color={color} />
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} onClose={closePanel} title="Notifikasi">
        <View style={styles.pushBox}>
          <Text style={styles.pushHint}>{PUSH_HINT[push]}</Text>
          {(push === 'off' || push === 'on') && (
            <TouchableOpacity
              style={[styles.pushBtn, push === 'on' && styles.pushBtnOff, pushBusy && { opacity: 0.6 }]}
              onPress={togglePush}
              disabled={pushBusy}
            >
              <Feather name={push === 'on' ? 'bell-off' : 'bell'} size={14} color={push === 'on' ? colors.ink : '#FFFFFF'} />
              <Text style={[styles.pushBtnText, push === 'on' && { color: colors.ink }]}>
                {pushBusy ? 'Memproses...' : push === 'on' ? 'Matikan di perangkat ini' : 'Aktifkan notifikasi'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>Belum ada notifikasi.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 420 }}>
            {items.map((n) => (
              <View key={n.id} style={[styles.item, !n.readAt && styles.itemUnread]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.itemTitle}>{n.title}</Text>
                  <Text style={styles.itemBody}>{n.body}</Text>
                  <Text style={styles.itemTime}>{timeAgo(n.createdAt)}</Text>
                </View>
                {!n.readAt && <View style={styles.dot} />}
              </View>
            ))}
          </ScrollView>
        )}
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  bellBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  badge: {
    position: 'absolute', top: 4, right: 3, minWidth: 17, height: 17, paddingHorizontal: 4,
    borderRadius: 999, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  pushBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, gap: 8, marginBottom: 12 },
  pushHint: { fontSize: fontSize.xs, color: colors.muted, lineHeight: 18 },
  pushBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10,
  },
  pushBtnOff: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  pushBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.xs, fontWeight: '600', marginBottom: 8 },
  empty: { textAlign: 'center', color: colors.muted, fontSize: fontSize.sm, marginVertical: 20 },
  item: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border, borderRadius: radius.sm,
  },
  itemUnread: { backgroundColor: colors.primarySoft },
  itemTitle: { fontSize: fontSize.sm, fontWeight: '800', color: colors.ink },
  itemBody: { fontSize: fontSize.xs, color: colors.ink, marginTop: 2, lineHeight: 18 },
  itemTime: { fontSize: fontSize.xs, color: colors.faint, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.primary, marginTop: 6 },
});
