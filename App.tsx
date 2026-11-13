import './src/utils/alertPolyfill';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

// Reset border/outline hitam bawaan browser saat input teks aktif di Web
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const existing = document.getElementById('epresensi-global-input-style');
  if (!existing) {
    const style = document.createElement('style');
    style.id = 'epresensi-global-input-style';
    style.textContent = `
      input, textarea, select {
        outline: none !important;
        outline-width: 0 !important;
        box-shadow: none !important;
      }
      input:focus, textarea:focus, select:focus {
        outline: none !important;
        outline-width: 0 !important;
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(style);
  }
}
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  AttendanceRecord,
  AttendanceType,
  OfficeSettings,
  SessionType,
  UserProfile,
} from './src/types/attendance';
import { AttendanceService } from './src/services/attendanceService';
import { initFeedback } from './src/services/feedbackService';
import { todayWIB } from './src/utils/dates';
import { supabase } from './src/lib/supabase';
import { INITIAL_OFFICE_SETTINGS, INITIAL_USERS } from './src/services/mockData';
import { Header } from './src/components/ui/Header';
import { colors } from './src/theme';
import { LoginScreen } from './src/components/auth/LoginScreen';
import { AdminDashboard } from './src/components/admin/AdminDashboard';
import { AttendanceHub } from './src/components/user/AttendanceHub';
import { ProfileScreen } from './src/components/user/ProfileScreen';

function AppContent() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [officeSettings, setOfficeSettings] = useState<OfficeSettings | null>(null);
  const [officeList, setOfficeList] = useState<OfficeSettings[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [todayAttendances, setTodayAttendances] = useState<AttendanceRecord[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<AttendanceRecord[]>([]);
  const [userHistory, setUserHistory] = useState<AttendanceRecord[]>([]);
  const [userTodayStatus, setUserTodayStatus] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfilePage, setShowProfilePage] = useState(false);
  const { width } = useWindowDimensions();
  const isAdminRole = (r?: string) => r === 'admin' || r === 'superadmin';
  // Di dashboard web admin sudah ada sidebar + topbar sendiri — header aplikasi disembunyikan
  const hideHeaderForWideAdmin =
    !!currentUser && isAdminRole(currentUser.role) && Platform.OS === 'web' && width >= 768;
  // Sembunyikan header global di admin web (karena sudah ada sidebar) dan di karyawan mobile (karena sudah punya welcome card sendiri)
  const hideGlobalHeader =
    hideHeaderForWideAdmin || (!!currentUser && !isAdminRole(currentUser.role));

  // Restore sesi login tersimpan (Supabase Auth) saat aplikasi dibuka
  useEffect(() => {
    checkCurrentSession();
    void initFeedback();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const profile = await AttendanceService.getCurrentProfile(session.user.id);
        setCurrentUser(profile);
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Reload data whenever currentUser changes
  useEffect(() => {
    if (currentUser) {
      loadDataForRole();
    }
  }, [currentUser]);

  const checkCurrentSession = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        const profile = await AttendanceService.getCurrentProfile(data.session.user.id);
        setCurrentUser(profile);
      }
    } catch {}
    setLoading(false);
  };

  const handleLoginSuccess = async (user?: UserProfile) => {
    if (user) {
      setCurrentUser(user);
    } else {
      await checkCurrentSession();
    }
  };

  const getAdminCompanyId = (user: UserProfile | null) => {
    if (!user) return undefined;
    if (user.role === 'superadmin') return undefined; // superadmin melihat pusat/semua
    return user.companyId || undefined;
  };

  const loadDataForRole = async () => {
    const compId = getAdminCompanyId(currentUser);
    let offices = await AttendanceService.getOfficeList(compId);
    if (offices.length === 0 && !isAdminRole(currentUser?.role)) {
      offices = [INITIAL_OFFICE_SETTINGS];
    }
    setOfficeList(offices);
    setOfficeSettings(offices[0] || null);

    if (currentUser) {
      const history = await AttendanceService.getUserAttendances(currentUser.id);
      const todayStr = todayWIB();
      const today = history.find((r) => (r.date || '').slice(0, 10) === todayStr && r.sessionType !== 'izin_sakit') || null;
      setUserHistory(history);
      setUserTodayStatus(today);

      if (isAdminRole(currentUser.role)) {
        let users = await AttendanceService.getAllUsers(compId);
        if (users.length === 0 && !compId) {
          users = INITIAL_USERS;
        }
        const attendances = await AttendanceService.getTodayAttendances(compId);
        const pending = await AttendanceService.getPendingApprovals(compId);
        setAllUsers(users);
        setTodayAttendances(attendances);
        setPendingApprovals(pending);
      }
    }
  };

  const handleRefreshOffices = async () => {
    const compId = getAdminCompanyId(currentUser);
    const offices = await AttendanceService.getOfficeList(compId);
    setOfficeList(offices);
    if (offices.length > 0) setOfficeSettings({ ...offices[0] });
    else setOfficeSettings(null);
  };

  useEffect(() => {
    if (!currentUser || !isAdminRole(currentUser.role)) return;
    const refreshAdminData = async () => {
      try {
        const compId = getAdminCompanyId(currentUser);
        const [offices, users, attendances, pending] = await Promise.all([
          AttendanceService.getOfficeList(compId),
          AttendanceService.getAllUsers(compId),
          AttendanceService.getTodayAttendances(compId),
          AttendanceService.getPendingApprovals(compId),
        ]);
        setOfficeList(offices);
        if (offices.length > 0) setOfficeSettings({ ...offices[0] });
        else setOfficeSettings(null);
        setAllUsers(users);
        setTodayAttendances(attendances);
        setPendingApprovals(pending);
      } catch (e) {
        console.warn('[AdminRefresh] Gagal memperbarui data berkala:', e);
      }
    };
    const timer = setInterval(refreshAdminData, 10000);
    return () => clearInterval(timer);
  }, [currentUser?.id, currentUser?.role, currentUser?.companyId]);

  const handleLogout = async () => {
    setLoading(true);
    await AttendanceService.signOut();
    setCurrentUser(null);
    setShowProfilePage(false);
    setLoading(false);
  };

  const handleUpdateOfficeSettings = async (newSettings: Partial<OfficeSettings>) => {
    await AttendanceService.updateOfficeSettings(newSettings);
    const fresh = await AttendanceService.getOfficeSettings();
    setOfficeSettings(fresh ? { ...fresh } : null);
  };

  const handleUserClockIn = async (data: {
    type: AttendanceType;
    sessionType: SessionType;
    latitude?: number;
    longitude?: number;
    distanceMeters?: number;
    officeName?: string;
    officeColor?: string;
    reason?: string;
    startDate?: string;
    endDate?: string;
    photoUrl?: string;
    documentUrl?: string;
  }) => {
    if (!currentUser) return;

    await AttendanceService.submitAttendance({
      user: currentUser,
      ...data,
    });

    await loadDataForRole();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1C1917" />
      </View>
    );
  }

  // If not logged in, render real LoginScreen
  if (!currentUser) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  // If viewing User Profile screen (contoh.jpeg)
  if (showProfilePage) {
    return (
      <ProfileScreen
        user={currentUser}
        onBack={() => setShowProfilePage(false)}
        onLogout={handleLogout}
        onUpdateUser={(updated) => setCurrentUser(updated)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

        {/* Header (disembunyikan di dashboard web admin dan karyawan mobile) */}
        {!hideGlobalHeader && (
          <Header
            user={currentUser}
            onPressProfile={() => setShowProfilePage(true)}
          />
        )}

        {/* Main View */}
        <View style={styles.content}>
          {isAdminRole(currentUser.role) ? (
            <AdminDashboard
              currentAdmin={currentUser}
              users={allUsers}
              todayAttendances={todayAttendances}
              pendingApprovals={pendingApprovals}
              officeSettings={officeSettings || {
                id: '1',
                officeName: 'Kantor Utama',
                latitude: -7.23707,
                longitude: 112.6346,
                radiusMeters: 150,
                color: colors.primary,
                updatedAt: new Date().toISOString(),
              }}
              officeList={officeList}
              onUpdateOfficeSettings={handleUpdateOfficeSettings}
              onRefreshOffices={handleRefreshOffices}
              onRefreshUsers={loadDataForRole}
              onLogout={handleLogout}
              onPressProfile={() => setShowProfilePage(true)}
            />
          ) : (
            <AttendanceHub
              user={currentUser}
              officeSettings={officeSettings || {
                id: '1',
                officeName: 'Kantor Utama',
                latitude: -7.23707,
                longitude: 112.6346,
                radiusMeters: 150,
                color: colors.primary,
                updatedAt: new Date().toISOString(),
              }}
              officeList={officeList}
              userTodayStatus={userTodayStatus}
              userHistory={userHistory}
              onClockIn={handleUserClockIn}
              onLogout={handleLogout}
              onUpdateUser={(updated) => setCurrentUser(updated)}
              onRefreshData={loadDataForRole}
            />
          )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
