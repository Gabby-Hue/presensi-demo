import { supabase } from '../lib/supabase';
import { ActivityRecord, ActivitySummary, ProjectSummaryItem } from '../types/attendance';

export type { ActivityRecord, ActivitySummary, ProjectSummaryItem };

export interface ProjectOption {
  code: string;
  name: string;
  category: 'proyek' | 'sales' | 'internal';
}

export const DEFAULT_PROJECTS: ProjectOption[] = [
  { code: 'MG05', name: 'Dashboard Piping', category: 'proyek' },
  { code: 'PR01', name: 'Renovasi Ruko Dinoyo', category: 'proyek' },
  { code: 'PR02', name: 'Pembangunan Gudang Sememi', category: 'proyek' },
  { code: 'SL02', name: 'Sales Lapangan', category: 'sales' },
  { code: 'SL03', name: 'Kunjungan Toko & Klien', category: 'sales' },
  { code: 'INT01', name: 'Operasional Kantor', category: 'internal' },
];

let localMockActivities: ActivityRecord[] = [];

function mapActivityRow(r: any): ActivityRecord {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    userName: r.user_name || 'Karyawan',
    companyId: r.company_id ? String(r.company_id) : undefined,
    projectCode: r.project_code,
    projectName: r.project_name || r.project_code,
    activityDate: r.activity_date ? String(r.activity_date).slice(0, 10) : '',
    startTime: r.start_time,
    endTime: r.end_time,
    durationMinutes: Number(r.duration_minutes) || 0,
    description: r.description,
    isOvertime: !!r.is_overtime,
    overtimeStatus: r.overtime_status || 'none',
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    locationAddress: r.location_address || null,
    photoUrl: r.photo_url || null,
    createdAt: r.created_at || new Date().toISOString(),
  };
}

export async function fetchActivities(params?: {
  date?: string;
  month?: string;
  user_id?: string;
  project_code?: string;
}): Promise<ActivityRecord[]> {
  try {
    let query = supabase.from('activities').select('*').order('created_at', { ascending: false });
    if (params?.date) query = query.eq('activity_date', params.date);
    if (params?.month) query = query.gte('activity_date', `${params.month}-01`).lte('activity_date', `${params.month}-31`);
    if (params?.user_id) query = query.eq('user_id', params.user_id);
    if (params?.project_code) query = query.eq('project_code', params.project_code);

    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      return data.map(mapActivityRow);
    }
  } catch (err) {
    console.warn('Gagal fetch activities dari Supabase, menggunakan fallback memori:', err);
  }

  // Fallback memori
  let filtered = [...localMockActivities];
  if (params?.date) {
    filtered = filtered.filter((a) => a.activityDate === params.date);
  }
  if (params?.project_code) {
    filtered = filtered.filter((a) => a.projectCode === params.project_code);
  }
  return filtered;
}

export async function createActivity(payload: {
  projectCode: string;
  projectName?: string;
  activityDate: string;
  startTime: string;
  endTime: string;
  description: string;
  isOvertime?: boolean;
  overtimeStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  latitude?: number | null;
  longitude?: number | null;
  locationAddress?: string | null;
  photoUrl?: string | null;
}): Promise<ActivityRecord> {
  const startParts = payload.startTime.split(':').map(Number);
  const endParts = payload.endTime.split(':').map(Number);
  const duration = Math.max(60, (endParts[0] * 60 + (endParts[1] || 0)) - (startParts[0] * 60 + (startParts[1] || 0)));

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    let userName = 'Karyawan';
    if (user?.id) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      if (prof?.full_name) userName = prof.full_name;
    }

    const insertData: any = {
      user_id: user?.id || '00000000-0000-0000-0000-000000000000',
      user_name: userName,
      project_code: payload.projectCode.toUpperCase(),
      project_name: payload.projectName || payload.projectCode,
      activity_date: payload.activityDate,
      start_time: payload.startTime,
      end_time: payload.endTime,
      duration_minutes: duration,
      description: payload.description,
      is_overtime: !!payload.isOvertime,
      overtime_status: payload.overtimeStatus || 'none',
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      location_address: payload.locationAddress ?? null,
      photo_url: payload.photoUrl ?? null,
    };

    const { data, error } = await supabase.from('activities').insert(insertData).select().single();
    if (!error && data) {
      return mapActivityRow(data);
    }
  } catch (err) {
    console.warn('Gagal create activity ke Supabase, menyimpan lokal:', err);
  }

  const mock: ActivityRecord = {
    id: `act-${Date.now()}`,
    userId: '1',
    userName: 'Karyawan',
    projectCode: payload.projectCode.toUpperCase(),
    projectName: payload.projectName || payload.projectCode,
    activityDate: payload.activityDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    durationMinutes: duration,
    description: payload.description,
    isOvertime: payload.isOvertime,
    overtimeStatus: payload.overtimeStatus || 'none',
    latitude: payload.latitude,
    longitude: payload.longitude,
    locationAddress: payload.locationAddress,
    photoUrl: payload.photoUrl,
    createdAt: new Date().toISOString(),
  };

  localMockActivities.unshift(mock);
  return mock;
}

export async function deleteActivity(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('activities').delete().eq('id', id);
    if (!error) {
      localMockActivities = localMockActivities.filter((a) => a.id !== id);
      return true;
    }
  } catch (err) {
    console.warn('Gagal hapus activity di Supabase, menghapus dari lokal:', err);
  }
  localMockActivities = localMockActivities.filter((a) => a.id !== id);
  return true;
}

export async function fetchActivitySummary(params?: {
  month?: string;
  start_date?: string;
  end_date?: string;
}): Promise<ActivitySummary> {
  try {
    const acts = await fetchActivities({ month: params?.month });
    const projMap: Record<string, ProjectSummaryItem> = {};
    let totalMin = 0;

    for (const a of acts) {
      totalMin += a.durationMinutes;
      if (!projMap[a.projectCode]) {
        projMap[a.projectCode] = {
          projectCode: a.projectCode,
          projectName: a.projectName || a.projectCode,
          totalMinutes: 0,
          totalHours: 0,
          totalLogs: 0,
          totalContributors: 0,
          contributors: [],
        };
      }
      projMap[a.projectCode].totalMinutes += a.durationMinutes;
      projMap[a.projectCode].totalLogs += 1;
      if (!projMap[a.projectCode].contributors.includes(a.userName)) {
        projMap[a.projectCode].contributors.push(a.userName);
        projMap[a.projectCode].totalContributors = projMap[a.projectCode].contributors.length;
      }
    }

    const projects = Object.values(projMap).map((p) => ({
      ...p,
      totalHours: Math.round((p.totalMinutes / 60) * 10) / 10,
    }));

    return {
      totalHours: Math.round((totalMin / 60) * 10) / 10,
      totalLogs: acts.length,
      projectCount: projects.length,
      projects,
    };
  } catch (err) {
    console.warn('Gagal fetch activity summary:', err);
    return {
      totalHours: 0,
      totalLogs: 0,
      projectCount: 0,
      projects: [],
    };
  }
}
