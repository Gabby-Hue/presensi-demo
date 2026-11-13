import { supabase, signUpClient } from '../lib/supabase';
import {
  ApprovalStatus,
  AttendanceRecord,
  AttendanceStatus,
  AttendanceType,
  DepartmentItem,
  OfficeSettings,
  SessionType,
  UserProfile,
} from '../types/attendance';
import { getDeviceInfo } from './deviceService';
import { todayWIB } from '../utils/dates';

let currentOfficeSettings: OfficeSettings = {
  id: '00000000-0000-0000-0000-000000000001',
  officeName: 'Kantor Utama',
  latitude: -6.2088,
  longitude: 106.8456,
  radiusMeters: 150,
  color: '#2196F3',
  updatedAt: new Date().toISOString(),
};

let cachedOffices: OfficeSettings[] = [currentOfficeSettings];

const FIXED_OFFICE_ID = '00000000-0000-0000-0000-000000000001';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v?: string | null): boolean {
  return typeof v === 'string' && UUID_REGEX.test(v);
}

function isHexColor(v: any): boolean {
  return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);
}

function mapUser(u: any): UserProfile {
  return {
    id: String(u.id),
    email: u.email,
    fullName: u.full_name || u.fullName || '',
    role: u.role || 'employee',
    department: u.department || 'None',
    companyId: u.company_id != null ? String(u.company_id) : (u.companyId != null ? String(u.companyId) : null),
    companyName: u.companies?.name || u.company_name || u.companyName || undefined,
    avatarUrl: u.avatar_url || u.avatarUrl || undefined,
    createdBy: u.created_by != null ? String(u.created_by) : null,
    phoneNumber: u.phone_number || u.phoneNumber || undefined,
    deviceModel: u.device_model || u.deviceModel || undefined,
    deviceId: u.device_id || u.deviceId || undefined,
    plainPassword: u.plain_password || u.plainPassword || '123456',
    createdAt: u.created_at || u.createdAt,
  };
}

function mapOffice(o: any): OfficeSettings {
  return {
    id: String(o.id),
    officeName: o.office_name || o.officeName || 'Kantor',
    latitude: Number(o.latitude),
    longitude: Number(o.longitude),
    radiusMeters: Number(o.radius_meters || o.radiusMeters || 150),
    color: isHexColor(o.color) ? o.color : '#2196F3',
    companyId: o.company_id != null ? String(o.company_id) : (o.companyId != null ? String(o.companyId) : null),
    workStartTime: o.work_start_time || o.workStartTime || '08:00',
    workEndTime: o.work_end_time || o.workEndTime || '17:00',
    lateDeadline: o.late_deadline || o.lateDeadline || '10:00',
    address: o.address || undefined,
    updatedAt: o.updated_at || o.updatedAt || new Date().toISOString(),
  };
}

function mapRecord(r: any): AttendanceRecord {
  const cleanDate = r.date
    ? String(r.date).slice(0, 10)
    : r.clock_in_time || r.clockInTime
    ? String(r.clock_in_time || r.clockInTime).slice(0, 10)
    : '';

  return {
    id: String(r.id),
    userId: String(r.user_id || r.userId || r.user_email || r.userEmail),
    userName: r.user_name || r.userName || '',
    userEmail: r.user_email || r.userEmail || '',
    type: r.type,
    sessionType: r.session_type || r.sessionType || 'masuk',
    status: r.status,
    date: cleanDate,
    clockInTime: r.clock_in_time || r.clockInTime || new Date().toISOString(),
    companyId: r.company_id != null ? String(r.company_id) : (r.companyId != null ? String(r.companyId) : null),
    latitude: r.latitude != null ? Number(r.latitude) : undefined,
    longitude: r.longitude != null ? Number(r.longitude) : undefined,
    distanceMeters: r.distance_meters != null ? Number(r.distance_meters) : (r.distanceMeters != null ? Number(r.distanceMeters) : undefined),
    officeName: r.office_name || r.officeName || undefined,
    officeColor: r.office_color || r.officeColor || null,
    reason: r.reason || undefined,
    startDate: r.start_date ? String(r.start_date).slice(0, 10) : (r.startDate ? String(r.startDate).slice(0, 10) : undefined),
    endDate: r.end_date ? String(r.end_date).slice(0, 10) : (r.endDate ? String(r.endDate).slice(0, 10) : undefined),
    photoUrl: r.photo_url || r.photoUrl || undefined,
    documentUrl: r.document_url || r.documentUrl || undefined,
    createdAt: r.created_at || r.createdAt || new Date().toISOString(),
    approvalStatus: (r.approval_status || r.approvalStatus || 'approved') as ApprovalStatus,
    reviewedBy: r.reviewed_by != null ? String(r.reviewed_by) : (r.reviewedBy != null ? String(r.reviewedBy) : null),
    reviewedAt: r.reviewed_at || r.reviewedAt || null,
    reviewNote: r.review_note || r.reviewNote || null,
  };
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function toAuthEmail(raw: string): { authEmail: string; mapped: boolean } {
  const t = raw.trim().toLowerCase();
  if (isValidEmail(t)) return { authEmail: t, mapped: false };
  if (!t.includes('@')) return { authEmail: `${t}@epresensi.com`, mapped: true };
  const [local, domain] = t.split('@');
  const dom = domain.includes('.') ? domain : `${domain}.com`;
  return { authEmail: `${local}@${dom}`, mapped: true };
}

function translateAuthError(msgRaw: string): string {
  const m = (msgRaw || '').toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) {
    return 'Email atau kata sandi salah.';
  }
  if (m.includes('email not confirmed') || m.includes('email_not_confirmed')) {
    return 'Email belum diverifikasi. Matikan Confirm email di Supabase atau cek inbox.';
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Email ini sudah terdaftar. Langsung masuk, atau gunakan email lain.';
  }
  if (m.includes('password should be at least 6')) {
    return 'Kata sandi minimal 6 karakter.';
  }
  if (m.includes('invalid email') || m.includes('email_address_invalid')) {
    return 'Format email tidak valid. Gunakan email dengan @ dan domain.';
  }
  return msgRaw || 'Login gagal. Coba lagi.';
}

export class AttendanceService {
  /**
   * Login ketat via Supabase Auth + device lock untuk karyawan
   */
  static async signInWithEmail(email: string, pass: string): Promise<{ user: UserProfile | null; error: string | null }> {
    const raw = email.trim();
    const { authEmail } = toAuthEmail(raw);

    try {
      let { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: pass,
      });

      // Jika gagal dengan authEmail hasil mapping, coba cari email asli di database profiles (bisa login pakai username / nama)
      if (error && error.message) {
        try {
          const { data: matchedProfile } = await supabase
            .from('profiles')
            .select('email')
            .or(`email.ilike.${raw},full_name.ilike.${raw},email.ilike.${raw}@%`)
            .limit(1)
            .maybeSingle();

          if (matchedProfile?.email && matchedProfile.email.toLowerCase() !== authEmail.toLowerCase()) {
            const retryAuth = await supabase.auth.signInWithPassword({
              email: matchedProfile.email,
              password: pass,
            });
            if (retryAuth.data?.user && !retryAuth.error) {
              data = retryAuth.data;
              error = null;
            }
          }
        } catch {}
      }

      // Auto bootstrap superadmin jika akun admin@admin.com belum ada
      if (error && (authEmail === 'admin@admin.com' || authEmail === 'admin@epresensi.com') && pass === '123456') {
        const boot = await this.bootstrapInitialAdmin();
        if (boot.user) {
          return { user: boot.user, error: null };
        }
      }

      if (error) {
        return { user: null, error: translateAuthError(error.message) };
      }
      if (!data?.user) {
        return { user: null, error: 'Login gagal. Coba lagi.' };
      }

      const profile = await this.getCurrentProfile(data.user.id);
      if (!profile) {
        return { user: null, error: 'Akun belum terdaftar di data profil karyawan. Hubungi admin.' };
      }

      // Device lock: superadmin & admin bebas; employee dikunci ke device pertama
      if (profile.role === 'employee') {
        const dev = await getDeviceInfo();
        const devId = (dev as any).deviceId ?? (dev as any).id ?? null;
        const devModel = (dev as any).modelName ?? (dev as any).model ?? null;

        if (profile.deviceId && devId && profile.deviceId !== devId) {
          await supabase.auth.signOut();
          return {
            user: null,
            error: `Akun ini terkunci pada perangkat (${profile.deviceModel || 'HP lain'}). Hubungi admin untuk reset perangkat.`,
          };
        }

        // Ikat device jika belum terikat
        if (!profile.deviceId && devId) {
          await supabase
            .from('profiles')
            .update({ device_id: devId, device_model: devModel })
            .eq('id', profile.id);
          profile.deviceId = devId;
          profile.deviceModel = devModel;
        }
      }

      return { user: profile, error: null };
    } catch (err: any) {
      return { user: null, error: err?.message || 'Login gagal. Coba lagi.' };
    }
  }

  static async signOut(): Promise<void> {
    try {
      await supabase.auth.signOut();
    } catch {}
  }

  static async getCurrentProfile(userId?: string): Promise<UserProfile | null> {
    try {
      let targetId = userId;
      if (!targetId) {
        const { data } = await supabase.auth.getSession();
        targetId = data.session?.user?.id;
      }
      if (!targetId) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('*, companies(name)')
        .eq('id', targetId)
        .maybeSingle();

      if (error || !data) return null;
      return mapUser(data);
    } catch {
      return null;
    }
  }

  static async updateAvatar(userId: string, avatarUrl: string): Promise<{ success: boolean; user?: UserProfile; message?: string }> {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', userId);

      if (error) throw new Error(error.message);
      const user = await this.getCurrentProfile(userId);
      return { success: true, user: user || undefined };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal memperbarui foto profil.' };
    }
  }

  static async createEmployeeAccount(params: {
    email: string;
    password: string;
    fullName: string;
    department?: string;
    createdBy?: string | null;
    role?: 'employee' | 'admin';
    companyId?: string | null;
  }): Promise<{ success: boolean; message: string }> {
    const cleanName = params.fullName.trim();
    const typedRaw = params.email.trim();
    if (!cleanName || !typedRaw || !params.password) {
      return { success: false, message: 'Lengkapi nama, departemen, email, dan kata sandi dulu.' };
    }
    if (params.password.length < 6) return { success: false, message: 'Kata sandi minimal 6 karakter.' };

    const { authEmail, mapped } = toAuthEmail(typedRaw);

    try {
      let newUserId: string | null = null;

      const { data: authData, error: authError } = await signUpClient.auth.signUp({
        email: authEmail,
        password: params.password,
        options: {
          data: {
            full_name: cleanName,
            role: params.role || 'employee',
          },
        },
      });

      if (authData?.user?.id) {
        newUserId = authData.user.id;
      }

      // Jika user sudah pernah terdaftar di auth.users (misal akun sebelumnya pernah dihapus dari profiles):
      if (!newUserId || authError) {
        const errLower = (authError?.message || '').toLowerCase();
        const isAlreadyRegistered =
          errLower.includes('already registered') ||
          errLower.includes('already been registered') ||
          errLower.includes('user_already_exists');

        if (isAlreadyRegistered || !newUserId) {
          // Cek apakah email ini benar-benar sedang dipakai oleh user AKTIF di profiles
          const { data: existingActive } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .eq('email', authEmail)
            .maybeSingle();

          if (existingActive) {
            return {
              success: false,
              message: `Email "${typedRaw}" sudah aktif digunakan oleh ${existingActive.full_name}. Gunakan email lain atau ubah data akun yang ada.`,
            };
          }

          // Akun ini pernah dihapus dari profiles sehingga tersisa di auth.users.
          // Kita klaim ulang (revive) akun ini:
          let revivedLogin = await signUpClient.auth.signInWithPassword({
            email: authEmail,
            password: params.password,
          });

          if (!revivedLogin.data?.user) {
            revivedLogin = await signUpClient.auth.signInWithPassword({
              email: authEmail,
              password: '123456',
            });
          }

          if (revivedLogin.data?.user) {
            newUserId = revivedLogin.data.user.id;
            try {
              await signUpClient.auth.updateUser({
                password: params.password,
                data: {
                  full_name: cleanName,
                  role: params.role || 'employee',
                },
              });
            } catch {}
            await signUpClient.auth.signOut();
          } else {
            return {
              success: false,
              message: translateAuthError(authError?.message || 'Email ini sudah terdaftar di sistem autentikasi.'),
            };
          }
        } else {
          return { success: false, message: translateAuthError(authError!.message) };
        }
      }

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: newUserId,
        email: authEmail,
        full_name: cleanName,
        role: params.role || 'employee',
        department: params.department?.trim() || 'General',
        company_id: params.companyId || null,
        created_by: params.createdBy || null,
        plain_password: params.password,
      });

      if (profileError) {
        return { success: false, message: `Akun auth berhasil dibuat, tapi profil gagal: ${profileError.message}` };
      }

      const label = params.role === 'admin' ? 'admin cabang' : 'karyawan';
      return {
        success: true,
        message: mapped
          ? `Akun ${label} ${cleanName} (${typedRaw}) berhasil dibuat. Untuk masuk, ketik "${typedRaw}".`
          : `Akun ${label} ${cleanName} (${typedRaw}) berhasil dibuat.`,
      };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal membuat akun.' };
    }
  }

  static async updateEmployeeAccount(params: {
    id: string;
    fullName: string;
    department?: string;
    password?: string;
  }): Promise<{ success: boolean; message: string }> {
    const cleanName = params.fullName.trim();
    if (!cleanName) return { success: false, message: 'Nama tidak boleh kosong.' };

    try {
      const updateData: any = {
        full_name: cleanName,
        department: params.department?.trim() || 'General',
      };
      if (params.password && params.password.length >= 6) {
        updateData.plain_password = params.password;
      }

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', params.id);

      if (error) throw new Error(error.message);
      return { success: true, message: `Data ${cleanName} berhasil diperbarui.` };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal memperbarui data.' };
    }
  }

  static async deleteEmployeeAccount(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { success: true, message: 'Akun berhasil dihapus.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal menghapus akun.' };
    }
  }

  static async resetUserPassword(id: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ plain_password: newPassword })
        .eq('id', id);

      if (error) throw new Error(error.message);
      return { success: true, message: 'Kata sandi berhasil diperbarui.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal memperbarui kata sandi.' };
    }
  }

  static async resetEmployeeDevice(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ device_model: null, device_id: null })
        .eq('id', id);

      if (error) throw new Error(error.message);
      return { success: true, message: 'Kunci perangkat direset. Karyawan bisa login dari HP baru.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal reset perangkat.' };
    }
  }

  // Inisialisasi awal: pastikan hanya 1 akun Super Admin (admin@admin.com / 123456)
  static async bootstrapInitialAdmin(): Promise<{ success: boolean; message: string; user?: UserProfile }> {
    const adminEmail = 'admin@admin.com';
    const adminPass = '123456';

    try {
      // 1. Cek apakah superadmin sudah ada di database
      const { data: existingProfiles } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', adminEmail)
        .maybeSingle();

      if (existingProfiles) {
        // Coba login
        const login = await supabase.auth.signInWithPassword({
          email: adminEmail,
          password: adminPass,
        });
        if (login.data?.user) {
          const prof = await this.getCurrentProfile(login.data.user.id);
          if (prof) return { success: true, message: 'Super Admin siap!', user: prof };
        }
      }

      // 2. Buat akun Auth baru
      const { data: signUpData, error: signUpErr } = await signUpClient.auth.signUp({
        email: adminEmail,
        password: adminPass,
        options: {
          data: {
            full_name: 'Super Admin',
            role: 'superadmin',
          },
        },
      });

      if (signUpErr && !signUpErr.message.includes('already registered')) {
        return { success: false, message: signUpErr.message };
      }

      const uid = signUpData.user?.id;
      if (uid) {
        await supabase.from('profiles').upsert({
          id: uid,
          email: adminEmail,
          full_name: 'Super Admin',
          role: 'superadmin',
          department: 'Management',
          plain_password: adminPass,
        });

        // Pastikan ada 1 titik kantor awal jika belum ada
        const { data: offices } = await supabase.from('office_settings').select('id').limit(1);
        if (!offices || offices.length === 0) {
          await supabase.from('office_settings').insert({
            office_name: 'Kantor Utama',
            latitude: -6.2088,
            longitude: 106.8456,
            radius_meters: 150,
            color: '#2196F3',
          });
        }

        const login = await supabase.auth.signInWithPassword({
          email: adminEmail,
          password: adminPass,
        });
        if (login.data?.user) {
          const prof = await this.getCurrentProfile(login.data.user.id);
          if (prof) return { success: true, message: 'Super Admin siap!', user: prof };
        }
      }
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal bootstrap superadmin.' };
    }

    return { success: false, message: 'Gagal inisialisasi superadmin.' };
  }

  static async getOfficeSettings(): Promise<OfficeSettings | null> {
    const offices = await this.getOfficeList();
    if (offices.length > 0) {
      currentOfficeSettings = offices[0];
      return currentOfficeSettings;
    }
    return null;
  }

  static async getOfficeList(): Promise<OfficeSettings[]> {
    try {
      const { data, error } = await supabase
        .from('office_settings')
        .select('*')
        .order('updated_at', { ascending: false });

      if (!error && data && data.length > 0) {
        cachedOffices = data.map(mapOffice);
        currentOfficeSettings = cachedOffices[0];
        return cachedOffices;
      }
    } catch {}
    return cachedOffices;
  }

  static async addOffice(params: {
    officeName: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    color?: string;
    workStartTime?: string;
    workEndTime?: string;
    lateDeadline?: string;
    address?: string;
    companyId?: string | null;
  }): Promise<{ success: boolean; message: string; office?: OfficeSettings }> {
    const name = params.officeName.trim();
    if (!name) return { success: false, message: 'Nama kantor tidak boleh kosong.' };
    if (!isFinite(params.latitude) || !isFinite(params.longitude)) {
      return { success: false, message: 'Koordinat tidak valid.' };
    }
    if (!Number.isInteger(params.radiusMeters) || params.radiusMeters <= 0) {
      return { success: false, message: 'Radius harus bilangan bulat positif (meter).' };
    }
    const officeColor = isHexColor(params.color) ? (params.color as string) : '#2196F3';

    try {
      const { data, error } = await supabase
        .from('office_settings')
        .insert({
          office_name: name,
          latitude: params.latitude,
          longitude: params.longitude,
          radius_meters: params.radiusMeters,
          color: officeColor,
          company_id: params.companyId || null,
          work_start_time: params.workStartTime || '08:00',
          work_end_time: params.workEndTime || '17:00',
          late_deadline: params.lateDeadline || '10:00',
          address: params.address?.trim() || null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      const office = mapOffice(data);
      await this.getOfficeList();
      return { success: true, message: `Titik ${name} berhasil ditambahkan.`, office };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal menambah titik kantor.' };
    }
  }

  static async updateOffice(
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
  ): Promise<{ success: boolean; message: string }> {
    const name = params.officeName.trim();
    if (!name) return { success: false, message: 'Nama kantor tidak boleh kosong.' };
    if (!isFinite(params.latitude) || !isFinite(params.longitude)) {
      return { success: false, message: 'Koordinat tidak valid.' };
    }
    if (!Number.isInteger(params.radiusMeters) || params.radiusMeters <= 0) {
      return { success: false, message: 'Radius harus bilangan bulat positif (meter).' };
    }
    const officeColor = isHexColor(params.color) ? (params.color as string) : '#2196F3';

    try {
      const { error } = await supabase
        .from('office_settings')
        .update({
          office_name: name,
          latitude: params.latitude,
          longitude: params.longitude,
          radius_meters: params.radiusMeters,
          color: officeColor,
          work_start_time: params.workStartTime || '08:00',
          work_end_time: params.workEndTime || '17:00',
          late_deadline: params.lateDeadline || '10:00',
          address: params.address?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw new Error(error.message);
      await this.getOfficeList();
      return { success: true, message: `Titik ${name} berhasil diperbarui.` };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal memperbarui titik kantor.' };
    }
  }

  static async deleteOffice(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const { error } = await supabase.from('office_settings').delete().eq('id', id);
      if (error) throw new Error(error.message);
      await this.getOfficeList();
      return { success: true, message: 'Titik kantor dihapus.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal menghapus titik kantor.' };
    }
  }

  static async updateOfficeSettings(newSettings: Partial<OfficeSettings>): Promise<OfficeSettings> {
    currentOfficeSettings = { ...currentOfficeSettings, ...newSettings, updatedAt: new Date().toISOString() };
    try {
      const list = await this.getOfficeList();
      const targetId = list.length > 0 && list[0].id ? list[0].id : FIXED_OFFICE_ID;
      await supabase.from('office_settings').upsert({
        id: targetId,
        office_name: currentOfficeSettings.officeName,
        latitude: currentOfficeSettings.latitude,
        longitude: currentOfficeSettings.longitude,
        radius_meters: currentOfficeSettings.radiusMeters,
        color: currentOfficeSettings.color,
        updated_at: currentOfficeSettings.updatedAt,
      });
      currentOfficeSettings.id = targetId;
      await this.getOfficeList();
    } catch {}
    return currentOfficeSettings;
  }

  static async getAllUsers(companyId?: string): Promise<UserProfile[]> {
    try {
      let query = supabase.from('profiles').select('*, companies(name)').order('created_at', { ascending: false });
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
      const { data, error } = await query;
      if (error || !data) return [];
      return data.map(mapUser);
    } catch {
      return [];
    }
  }

  static async getTodayAttendances(): Promise<AttendanceRecord[]> {
    const today = todayWIB();
    try {
      const { data, error } = await supabase
        .from('attendances')
        .select('*')
        .eq('date', today)
        .order('clock_in_time', { ascending: false });

      if (error || !data) return [];
      return data.map(mapRecord);
    } catch {
      return [];
    }
  }

  static async getUserAttendances(userId: string): Promise<AttendanceRecord[]> {
    try {
      const { data, error } = await supabase
        .from('attendances')
        .select('*')
        .eq('user_id', userId)
        .order('clock_in_time', { ascending: false });

      if (!error && data) {
        return data.map(mapRecord);
      }
    } catch {}
    return [];
  }

  static async submitAttendance(params: {
    user: UserProfile;
    type: AttendanceType;
    sessionType?: SessionType;
    status?: AttendanceStatus;
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
  }): Promise<AttendanceRecord> {
    const now = new Date();
    const today = todayWIB(now);
    const isSakit = params.type === 'izin_sakit' && (params.status === 'sakit' || (params.reason && params.reason.includes('[SAKIT]')));
    const status = params.type === 'izin_sakit' ? (isSakit ? 'sakit' : 'izin') : (params.status || 'hadir');
    const sType = params.sessionType || (params.type === 'izin_sakit' ? 'izin_sakit' : 'masuk');

    // Validasi & pastikan user_id berupa UUID valid
    let targetUserId = params.user.id;
    if (!isUuid(targetUserId)) {
      if (params.user.email) {
        const { data: p } = await supabase.from('profiles').select('id').eq('email', params.user.email.trim().toLowerCase()).maybeSingle();
        if (p?.id && isUuid(p.id)) {
          targetUserId = p.id;
        }
      }
    }

    if (!isUuid(targetUserId)) {
      throw new Error('Sesi akun tidak valid atau belum terdaftar di database. Silakan keluar lalu masuk kembali dengan akun resmi.');
    }

    const validCompanyId = isUuid(params.user.companyId) ? params.user.companyId : null;

    // Anti-duplikat presensi di sisi klien sebelum insert
    if (sType === 'masuk' || sType === 'pulang') {
      const { data: existing } = await supabase
        .from('attendances')
        .select('id')
        .eq('user_id', targetUserId)
        .eq('date', today)
        .eq('session_type', sType)
        .maybeSingle();

      if (existing) {
        throw new Error('Presensi sesi ini pada tanggal ini sudah tersimpan. Tidak bisa absen dua kali.');
      }
    } else if (sType === 'izin_sakit') {
      const reqStart = params.startDate || today;
      const reqEnd = params.endDate || today;
      const { data: existingPending } = await supabase
        .from('attendances')
        .select('id')
        .eq('user_id', targetUserId)
        .eq('session_type', 'izin_sakit')
        .eq('approval_status', 'pending')
        .eq('start_date', reqStart)
        .eq('end_date', reqEnd)
        .maybeSingle();

      if (existingPending) {
        throw new Error('Pengajuan izin/sakit untuk tanggal ini sudah menunggu persetujuan admin.');
      }
    }

    const newRecordData: any = {
      user_id: targetUserId,
      user_name: params.user.fullName,
      user_email: params.user.email,
      type: params.type,
      session_type: sType,
      status,
      date: today,
      clock_in_time: now.toISOString(),
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      distance_meters: params.distanceMeters ?? null,
      office_name: params.officeName ?? null,
      office_color: params.officeColor ?? null,
      reason: params.reason ?? null,
      start_date: params.startDate || today,
      end_date: params.endDate || today,
      photo_url: params.photoUrl ?? null,
      document_url: params.documentUrl ?? null,
      approval_status: sType === 'izin_sakit' ? 'pending' : 'approved',
      company_id: validCompanyId,
    };

    const { data, error } = await supabase
      .from('attendances')
      .insert(newRecordData)
      .select()
      .single();

    if (error) {
      throw new Error(`Gagal menyimpan presensi: ${error.message}`);
    }

    return mapRecord(data);
  }

  static async getUserTodayStatus(userId: string): Promise<AttendanceRecord | null> {
    const today = todayWIB();
    const recs = await this.getUserAttendances(userId);
    return recs.find((r) => r.date === today && r.sessionType !== 'izin_sakit') || null;
  }

  static async getCompanies(): Promise<{ id: string; name: string }[]> {
    try {
      const { data, error } = await supabase.from('companies').select('*').order('name');
      if (!error && data) {
        return data.map((c: any) => ({ id: String(c.id), name: c.name }));
      }
    } catch {}
    return [];
  }

  static async createCompany(name: string): Promise<{ success: boolean; message: string }> {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, message: 'Nama PT tidak boleh kosong.' };
    try {
      const { error } = await supabase.from('companies').insert({ name: trimmed });
      if (error) throw new Error(error.message);
      return { success: true, message: `PT ${trimmed} berhasil dibuat.` };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal membuat PT.' };
    }
  }

  static async deleteCompany(id: string, _force = false): Promise<{ success: boolean; message: string }> {
    try {
      const { error } = await supabase.from('companies').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { success: true, message: 'PT berhasil dihapus.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal menghapus PT.' };
    }
  }

  static async getPendingApprovals(): Promise<AttendanceRecord[]> {
    try {
      const { data, error } = await supabase
        .from('attendances')
        .select('*')
        .eq('approval_status', 'pending')
        .order('clock_in_time', { ascending: false });

      if (!error && data) {
        return data.map(mapRecord);
      }
    } catch {}
    return [];
  }

  static async getAllAttendances(params?: {
    month?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<AttendanceRecord[]> {
    try {
      let query = supabase.from('attendances').select('*').order('clock_in_time', { ascending: false });
      if (params?.month) {
        query = query.gte('date', `${params.month}-01`).lte('date', `${params.month}-31`);
      }
      if (params?.startDate) {
        query = query.gte('date', params.startDate);
      }
      if (params?.endDate) {
        query = query.lte('date', params.endDate);
      }
      if (params?.limit) {
        query = query.limit(params.limit);
      }
      const { data, error } = await query;
      if (!error && data) {
        return data.map(mapRecord);
      }
    } catch {}
    return [];
  }

  static async getDepartments(_companyId?: string): Promise<string[]> {
    try {
      const { data, error } = await supabase.from('departments').select('name').order('name');
      if (!error && data) {
        return Array.from(new Set(data.map((d: any) => d.name).filter(Boolean)));
      }
    } catch {}
    return [];
  }

  static async getDepartmentItems(_companyId?: string): Promise<DepartmentItem[]> {
    try {
      const { data, error } = await supabase.from('departments').select('*').order('name');
      if (error || !data) return [];

      const { data: profiles } = await supabase.from('profiles').select('department, company_id');
      const deptCounts: Record<string, number> = {};
      (profiles || []).forEach((p: any) => {
        const d = p.department || 'None';
        deptCounts[d] = (deptCounts[d] || 0) + 1;
      });

      return data.map((i: any) => ({
        id: String(i.id),
        name: String(i.name),
        companyId: i.company_id ? String(i.company_id) : null,
        employeeCount: deptCounts[i.name] || 0,
        createdAt: i.created_at,
      }));
    } catch {
      return [];
    }
  }

  static async addDepartment(
    name: string,
    companyId?: string
  ): Promise<{ success: boolean; message: string; departments: string[]; department?: DepartmentItem }> {
    const trimmed = name.trim();
    if (!trimmed) {
      return { success: false, message: 'Nama departemen tidak boleh kosong.', departments: [] };
    }
    try {
      const { data, error } = await supabase
        .from('departments')
        .insert({
          name: trimmed,
          company_id: companyId || null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      const allDepts = await this.getDepartments(companyId);
      return {
        success: true,
        message: `Departemen ${trimmed} berhasil ditambahkan.`,
        departments: allDepts,
        department: data
          ? {
              id: String(data.id),
              name: String(data.name),
              companyId: data.company_id ? String(data.company_id) : null,
              employeeCount: 0,
              createdAt: data.created_at,
            }
          : undefined,
      };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal menambahkan departemen.', departments: [] };
    }
  }

  static async updateDepartment(
    id: string,
    name: string
  ): Promise<{ success: boolean; message: string }> {
    const trimmed = name.trim();
    if (!trimmed) {
      return { success: false, message: 'Nama departemen tidak boleh kosong.' };
    }
    try {
      const { error } = await supabase.from('departments').update({ name: trimmed }).eq('id', id);
      if (error) throw new Error(error.message);
      return { success: true, message: `Departemen berhasil diubah menjadi "${trimmed}".` };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal mengubah nama departemen.' };
    }
  }

  static async reassignDepartment(
    fromDepartment: string,
    toDepartment: string,
    companyId?: string
  ): Promise<{ success: boolean; message: string; affectedRows?: number }> {
    try {
      let query = supabase.from('profiles').update({ department: toDepartment }).eq('department', fromDepartment);
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
      const { error } = await query;
      if (error) throw new Error(error.message);
      return { success: true, message: `Karyawan dipindahkan ke ${toDepartment}.` };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal memindahkan karyawan.' };
    }
  }

  static async deleteDepartment(
    idOrName: string,
    options?: string | { action?: 'unassign' | 'reassign'; reassignTo?: string }
  ): Promise<{ success: boolean; message: string }> {
    try {
      const isIdUuid = isUuid(idOrName);
      let deptName = idOrName;

      if (isIdUuid) {
        const { data: dept } = await supabase.from('departments').select('name, company_id').eq('id', idOrName).maybeSingle();
        if (dept?.name) deptName = dept.name;
      }

      const reassignTo = typeof options === 'string' ? options : options?.reassignTo;
      const targetDept = reassignTo || 'None';

      // Selalu unassign / reassign karyawan dari profil
      await supabase
        .from('profiles')
        .update({ department: targetDept })
        .eq('department', deptName);

      // Hapus dari tabel departments (baik by ID maupun by Name)
      if (isIdUuid) {
        await supabase.from('departments').delete().eq('id', idOrName);
      }
      await supabase.from('departments').delete().eq('name', deptName);

      return { success: true, message: `Departemen "${deptName}" berhasil dihapus.` };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal menghapus departemen.' };
    }
  }

  static async reviewApproval(
    id: string,
    decision: 'approved' | 'rejected',
    reviewerId?: string,
    note?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { error } = await supabase
        .from('attendances')
        .update({
          approval_status: decision,
          reviewed_by: reviewerId || null,
          reviewed_at: new Date().toISOString(),
          review_note: note?.trim() || null,
        })
        .eq('id', id);

      if (error) throw new Error(error.message);
      return {
        success: true,
        message: decision === 'approved' ? 'Pengajuan disetujui.' : 'Pengajuan ditolak.',
      };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal memproses persetujuan.' };
    }
  }

  static async cancelLeave(
    id: string,
    todayDate?: string,
    opts?: { note?: string; full?: boolean }
  ): Promise<{ success: boolean; message: string; attendance?: AttendanceRecord }> {
    try {
      const curDate = todayDate || todayWIB();
      const { data: rec } = await supabase.from('attendances').select('*').eq('id', id).maybeSingle();

      if (!rec) {
        return { success: false, message: 'Data pengajuan izin tidak ditemukan.' };
      }

      const startDate = (rec.start_date || rec.date || '').slice(0, 10);
      const endDate = (rec.end_date || rec.date || '').slice(0, 10);

      // Jika opsi full, atau pengajuan masih pending, atau izin 1 hari saja (startDate === endDate), atau belum berjalan (startDate >= curDate):
      // Langsung hapus record agar tanggal benar-benar bersih dan bebas untuk presensi
      if (opts?.full || rec.approval_status === 'pending' || startDate >= curDate || startDate === endDate) {
        const { error } = await supabase.from('attendances').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return { success: true, message: 'Pengajuan izin berhasil dicabut/dibatalkan.' };
      }

      // Jika izin multi-hari yang sudah berjalan di masa lalu (misal izin tgl 10-15, dan hari ini tgl 13):
      // Mundurkan end_date ke hari kemarin agar hari ini & seterusnya bebas untuk presensi
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = todayWIB(yesterday);

      const { data, error } = await supabase
        .from('attendances')
        .update({
          end_date: yesterdayStr >= startDate ? yesterdayStr : startDate,
          review_note: opts?.note || 'Izin dicabut / kembali bekerja lebih awal',
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return {
        success: true,
        message: 'Izin berhasil disesuaikan.',
        attendance: data ? mapRecord(data) : undefined,
      };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal membatalkan izin.' };
    }
  }

  static async getAuditLogs(companyId?: string): Promise<import('../types/attendance').AuditLog[]> {
    try {
      let query = supabase.from('audit_logs').select('*, companies(name)').order('created_at', { ascending: false });
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
      const { data, error } = await query;
      if (!error && data) {
        return data.map((l: any) => ({
          id: String(l.id),
          userId: String(l.user_id),
          userName: l.user_name || 'Admin',
          userRole: l.user_role || 'admin',
          companyId: l.company_id ? String(l.company_id) : null,
          companyName: l.companies?.name || null,
          action: l.action,
          description: l.description,
          createdAt: l.created_at,
        }));
      }
    } catch {}
    return [];
  }
}
