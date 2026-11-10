import { AttendanceRecord, OfficeSettings, UserProfile } from '../types/attendance';

export const INITIAL_OFFICE_SETTINGS: OfficeSettings = {
  id: 'off-001',
  officeName: 'Kantor Utama',
  latitude: -6.2088,
  longitude: 106.8456,
  radiusMeters: 150,
  color: '#0061A4',
  updatedAt: new Date().toISOString(),
};

export const INITIAL_USERS: UserProfile[] = [
  { id: '1', email: 'admin@admin.com', fullName: 'Super Admin', role: 'superadmin', department: 'Management' },
];

export const INITIAL_ATTENDANCES: AttendanceRecord[] = [];
