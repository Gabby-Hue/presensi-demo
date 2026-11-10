import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AttendanceRecord } from '../../types/attendance';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { colors, fontSize, radius } from '../../theme';
import { select } from '../../services/feedbackService';

interface AdminApprovalQueueProps {
  requests: AttendanceRecord[];
  onSelect: (record: AttendanceRecord) => void;
}

export const AdminApprovalQueue: React.FC<AdminApprovalQueueProps> = ({ requests, onSelect }) => {
  return (
    <Card
      title={`Menunggu persetujuan (${requests.length})`}
      subtitle="Ketuk pengajuan untuk lihat bukti lalu setujui atau tolak"
      icon="inbox"
    >
      {requests.length === 0 ? (
        <View style={styles.emptyBox}>
          <Feather name="check-circle" size={36} color={colors.successInk} />
          <Text style={styles.emptyText}>Tidak ada antrean. Semua pengajuan sudah diproses.</Text>
        </View>
      ) : (
        requests.map((item) => (
          <TouchableOpacity
            key={item.id}
            activeOpacity={0.7}
            onPress={() => {
              select();
              onSelect(item);
            }}
            style={styles.row}
          >
            {item.photoUrl ? (
              <Image source={{ uri: item.photoUrl }} style={styles.thumb} />
            ) : (
              <View style={styles.thumbFallback}>
                <Text style={styles.thumbText}>
                  {item.userName.substring(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.name}>{item.userName}</Text>
                {item.reason && item.reason.includes('[LEMBUR]') ? (
                  <View style={styles.otBadge}>
                    <Feather name="zap" size={10} color="#B45309" style={{ marginRight: 2 }} />
                    <Text style={styles.otBadgeText}>LEMBUR</Text>
                  </View>
                ) : item.status === 'sakit' || (item.reason && item.reason.includes('[SAKIT]')) ? (
                  <View style={styles.sakitBadge}>
                    <Feather name="activity" size={10} color={colors.danger} style={{ marginRight: 2 }} />
                    <Text style={styles.sakitBadgeText}>SAKIT</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.sub} numberOfLines={1}>
                {item.startDate && item.endDate && item.startDate !== item.endDate
                  ? `${item.startDate} - ${item.endDate}`
                  : item.date}
                {item.reason ? ` • ${item.reason}` : ''}
              </Text>
              {item.documentUrl ? (
                <Text style={styles.docHint}>
                  <Feather name="paperclip" size={12} /> Ada dokumen pendukung
                </Text>
              ) : null}
            </View>
            <View style={styles.right}>
              <Badge type="menunggu" size="sm" />
              <Feather name="chevron-right" size={16} color={colors.faint} style={{ marginTop: 4 }} />
            </View>
          </TouchableOpacity>
        ))
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    marginRight: 12,
    backgroundColor: colors.surfaceSoft,
  },
  thumbFallback: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  thumbText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 13,
  },
  name: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  otBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  otBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
  },
  sakitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.izinSoft,
    borderWidth: 1,
    borderColor: colors.izinBorder,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  sakitBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.dangerInk,
  },
  sub: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '600',
  },
  docHint: {
    fontSize: 11,
    color: colors.primaryDark,
    fontWeight: '700',
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
  },
});
