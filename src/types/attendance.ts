export type UserRole = 'superadmin' | 'admin' | 'employee';

export interface Company {
  id: string;
  name: string;
  createdAt?: string;
}

export interface DepartmentItem {
  id: string;
  name: string;
  companyId?: string | null;
  employeeCount: number;
  createdAt?: string;
}

export type AttendanceType = 'luring' | 'daring' | 'izin_sakit';

export type SessionType = 'masuk' | 'pulang' | 'izin_sakit';

export type AttendanceStatus = 'hadir' | 'izin' | 'sakit';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  department?: string;
  companyId?: string | null;
  companyName?: string;
  avatarUrl?: string;
  createdBy?: string | null;
  phoneNumber?: string;
  deviceModel?: string;
  deviceId?: string;
  plainPassword?: string;
  createdAt?: string;
}

export interface OfficeSettings {
  id: string;
  officeName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  color: string;
  companyId?: string | null;
  workStartTime?: string;
  workEndTime?: string;
  lateDeadline?: string;
  address?: string;
  updatedAt: string;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  type: AttendanceType;
  sessionType: SessionType;
  status: AttendanceStatus;
  date: string; // YYYY-MM-DD
  clockInTime: string; // ISO string
  companyId?: string | null;
  latitude?: number;
  longitude?: number;
  distanceMeters?: number;
  officeName?: string;
  officeColor?: string | null;
  reason?: string;
  startDate?: string;
  endDate?: string;
  photoUrl?: string;
  documentUrl?: string;
  createdAt: string;
  approvalStatus: ApprovalStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

export interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  companyId?: string | null;
  companyName?: string | null;
  action: string;
  description?: string | null;
  createdAt: string;
}

export interface ActivityRecord {
  id: string;
  userId: string;
  userName: string;
  companyId?: string | null;
  projectCode: string;
  projectName?: string;
  activityDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  durationMinutes: number;
  description: string;
  isOvertime?: boolean;
  overtimeStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  latitude?: number | null;
  longitude?: number | null;
  locationAddress?: string | null;
  photoUrl?: string | null;
  createdAt: string;
}

export interface ProjectSummaryItem {
  projectCode: string;
  projectName: string;
  totalMinutes: number;
  totalHours: number;
  totalLogs: number;
  totalContributors: number;
  contributors: string[];
}

export interface ActivitySummary {
  totalHours: number;
  totalLogs: number;
  projectCount: number;
  projects: ProjectSummaryItem[];
}
