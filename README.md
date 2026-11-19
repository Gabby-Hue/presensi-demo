# PresensiPro (Vercel + Supabase)

Aplikasi presensi modern, clean, dan responsif (Web & Mobile Expo) yang terhubung langsung ke **Supabase** (Auth, PostgreSQL DB, dan Storage) serta siap dideploy ke **Vercel** dengan 1 klik.

## Keunggulan
- **Fitur Lengkap**: Geofencing multi-kantor, swafoto webcam/HP dengan watermark waktu real-time, approval izin/sakit, kalender status dinamis, manajemen PT/departemen, audit logs, timesheet kegiatan proyek, dan ekspor Excel/PDF.
- **Desain Netral & Bersih**: Pure polosan, bebas trademark/branding apa pun, hanya label resmi aplikasi `PresensiPro`.
- **Hanya Akun Super Admin**: Database awal bersih tanpa akun dummy. Akun pertama yang tersedia adalah Super Admin (`admin@admin.com` / `123456`).

---

## 1. Setup Supabase (Database & Storage)

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka menu **SQL Editor** di dashboard Supabase.
3. Buka file `supabase_schema.sql` di proyek ini, copy seluruh isinya, dan tekan **Run**.
   - Skema ini otomatis membuat semua tabel (`companies`, `departments`, `profiles`, `office_settings`, `attendances`, `audit_logs`, `activities`).
   - Otomatis membuat 3 storage bucket (`attendance-photos`, `attendance-docs`, `avatars`) dengan permission publik.
   - Otomatis membuat trigger anti-double presensi.
   - Otomatis mendaftarkan akun **Super Admin**:
     - **Email**: `admin@admin.com`
     - **Password**: `123456`
     - **Role**: `superadmin`
4. Di dashboard Supabase, buka menu **Authentication** -> **Providers** -> **Email**:
   - Nonaktifkan **Confirm email** (supaya akun baru yang didaftarkan admin bisa langsung login tanpa perlu verifikasi email masuk).

---

## 2. Setup Environment Variables

Salin file `.env.example` menjadi `.env` di root proyek:
```bash
EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
*(Ambil Project URL dan Anon Key dari dashboard Supabase: Project Settings -> API)*

---

## 3. Menjalankan di Lokal

```bash
# Jalankan web di browser
npm run web
# atau
npx expo start --web
```

Buka `http://localhost:8081` di browser Anda, lalu login dengan:
- **Email**: `admin@admin.com`
- **Kata Sandi**: `123456`

---

## 4. Deploy ke Vercel

1. Push folder proyek ini ke repository GitHub baru (misalnya `epresensi-app`).
2. Masuk ke [vercel.com](https://vercel.com) dan klik **Add New** -> **Project**.
3. Import repository GitHub tersebut.
4. Pada **Environment Variables**, tambahkan:
   - `EXPO_PUBLIC_SUPABASE_URL`: URL project Supabase Anda
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`: Anon Key Supabase Anda
5. Pastikan setting build (sudah otomatis terdeteksi via `vercel.json`):
   - **Build Command**: `npx expo export --platform web`
   - **Output Directory**: `dist`
6. Klik **Deploy**!
