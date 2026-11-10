// E-Presensi UI · Modern Shadcn Dock NavBar (5 Tabs)
// Tab Bar: Presensi, Kegiatan, Profil (Bulat Tengah dengan Foto Asli), Kalender, Pengajuan.

import React from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { resolveMediaUrl } from '../../lib/api';
import { select } from '../../services/feedbackService';
import { colors, fontSize, neoShadow, radius } from '../../theme';
import { getInitials } from '../../utils/dates';

export type UserTabKey = 'presensi' | 'kegiatan' | 'profil' | 'kalender' | 'izin';

interface TabItem {
  key: UserTabKey;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  isCenter?: boolean;
}

const TABS: TabItem[] = [
  { key: 'presensi', label: 'Presensi', icon: 'check-circle' },
  { key: 'kegiatan', label: 'Kegiatan', icon: 'clock' },
  { key: 'profil', label: 'Profil', icon: 'user', isCenter: true },
  { key: 'kalender', label: 'Kalender', icon: 'calendar' },
  { key: 'izin', label: 'Pengajuan', icon: 'file-text' },
];

interface BottomNavBarProps {
  activeTab: UserTabKey;
  onTabChange: (tab: UserTabKey) => void;
  userAvatarUrl?: string | null;
  userName?: string;
  isProfileOpen?: boolean;
  onProfilePress?: () => void;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  activeTab,
  onTabChange,
  userAvatarUrl,
  userName,
  isProfileOpen = false,
  onProfilePress,
}) => {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'ios' ? 14 : 8);

  const handlePress = (tabKey: UserTabKey) => {
    void select();
    if (tabKey === 'profil' && onProfilePress) {
      onProfilePress();
      return;
    }
    if (tabKey !== activeTab) {
      onTabChange(tabKey);
    }
  };

  const realAvatarUri = userAvatarUrl ? (resolveMediaUrl(userAvatarUrl) || userAvatarUrl) : null;
  const initials = getInitials(userName);

  return (
    <View style={[styles.container, { paddingBottom: bottomPadding }]}>
      <View style={styles.navRow}>
        {TABS.map((tab) => {
          const isActive = tab.isCenter
            ? (isProfileOpen || activeTab === 'profil')
            : (tab.key === activeTab && !isProfileOpen);

          // Render Khusus Tombol Bulat Tengah (Profil dengan Foto Asli)
          if (tab.isCenter) {
            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.85}
                onPress={() => handlePress(tab.key)}
                style={styles.centerTabButton}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: isActive }}
              >
                <View
                  style={[
                    styles.centerCircle,
                    isActive ? styles.centerCircleActive : styles.centerCircleInactive,
                  ]}
                >
                  {realAvatarUri ? (
                    <Image
                      source={{ uri: realAvatarUri }}
                      style={styles.centerAvatarImage}
                    />
                  ) : (
                    <View style={styles.centerFallbackBox}>
                      <Text style={styles.centerInitials}>{initials}</Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    styles.tabLabel,
                    isActive ? styles.tabLabelActive : { marginTop: 2 },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          }

          // Render Tab Reguler
          return (
            <TouchableOpacity
              key={tab.key}
              activeOpacity={0.7}
              onPress={() => handlePress(tab.key)}
              style={styles.tabButton}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
            >
              <View style={[styles.tabContent, isActive && styles.tabContentActive]}>
                <Feather
                  name={tab.icon}
                  size={18}
                  color={isActive ? colors.primary : colors.muted}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: colors.ink,
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
      web: {
        boxShadow: '0 -2px 10px rgba(15, 23, 42, 0.04)',
      },
    }),
  },
  navRow: {
    flexDirection: 'row',
    height: 60,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  tabButton: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTabButton: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -14,
  },
  centerCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 5,
      },
      android: {
        elevation: 5,
      },
      web: {
        boxShadow: '0 3px 10px rgba(15, 23, 42, 0.18)',
      },
    }),
  },
  centerCircleInactive: {
    backgroundColor: '#0F172A',
  },
  centerCircleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primarySoft,
  },
  centerAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    resizeMode: 'cover',
  },
  centerFallbackBox: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerInitials: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  tabContent: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 2,
  },
  tabContentActive: {
    backgroundColor: '#DCFCE7', // Soft mint-green pill ala Material 3
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.muted,
  },
  tabLabelActive: {
    color: '#15803D',
    fontWeight: '800',
  },
});
