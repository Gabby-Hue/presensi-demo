import React, { useState } from 'react';
import { ScrollView, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fontSize, radius, touch } from '../../theme';
import { select } from '../../services/feedbackService';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: keyof typeof Feather.glyphMap;
  emptyText?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Dropdown pilihan sederhana; tampilan sama dengan DepartmentDropdown. */
export const SelectDropdown: React.FC<Props> = ({
  options,
  value,
  onChange,
  placeholder = 'Pilih...',
  icon = 'chevron-right',
  emptyText = 'Tidak ada pilihan.',
  accessibilityLabel,
  style,
}) => {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <View style={[styles.container, style]}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => {
          select();
          setOpen((o) => !o);
        }}
        style={[styles.trigger, open && styles.triggerOpen]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || placeholder}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.triggerLeft}>
          <View style={[styles.iconWrap, current && styles.iconWrapActive]}>
            <Feather name={icon} size={16} color={current ? colors.primaryDark : colors.muted} />
          </View>
          <Text style={[styles.triggerText, !current && styles.placeholder]} numberOfLines={1}>
            {current ? current.label : placeholder}
          </Text>
        </View>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={open ? colors.primary : colors.muted} />
      </TouchableOpacity>

      {open && (
        <View style={styles.panel}>
          <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {options.length === 0 ? (
              <Text style={styles.empty}>{emptyText}</Text>
            ) : (
              options.map((o) => {
                const selected = o.value === value;
                return (
                  <TouchableOpacity
                    key={o.value}
                    activeOpacity={0.7}
                    onPress={() => {
                      select();
                      onChange(o.value);
                      setOpen(false);
                    }}
                    style={[styles.item, selected && styles.itemSelected]}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.itemText, selected && styles.itemTextSelected]}>{o.label}</Text>
                    {selected && <Feather name="check" size={16} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { position: 'relative', zIndex: 10 },
  trigger: {
    minHeight: touch.inputMinHeight,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  triggerOpen: { borderColor: colors.primary },
  triggerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  iconWrapActive: { backgroundColor: colors.primarySoft },
  triggerText: { flex: 1, fontSize: fontSize.sm, color: colors.ink, fontWeight: '600' },
  placeholder: { color: colors.faint, fontWeight: '400' },
  panel: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    overflow: 'hidden',
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  list: { maxHeight: 220 },
  item: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSoft,
  },
  itemSelected: { backgroundColor: colors.primarySoft },
  itemText: { flex: 1, fontSize: fontSize.sm, color: colors.ink, fontWeight: '500' },
  itemTextSelected: { color: colors.primaryDark, fontWeight: '700' },
  empty: { padding: 14, fontSize: fontSize.sm, color: colors.muted },
});
