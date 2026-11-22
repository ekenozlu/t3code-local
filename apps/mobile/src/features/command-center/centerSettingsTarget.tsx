import type { EnvironmentId, ServerSettingsPatch } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSettingsEnvironmentFilter } from "../settings/settings-environment-filter";

/**
 * Agents and centers belong to one machine. Pages edit the one named by the route, else the one
 * picked here, else the first in the Settings filter.
 */
export function useCenterTarget(fixed?: EnvironmentId) {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const [picked, setPicked] = useState<EnvironmentId | null>(null);
  const wanted = fixed ?? picked;
  const target =
    selectedTargets.find((candidate) => candidate.environmentId === wanted) ??
    selectedTargets[0] ??
    null;
  return { targets: selectedTargets, target, pick: setPicked };
}

export function useWriteServerSettings() {
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    label: "Command Center settings update",
    reportFailure: true,
  });
  return (environmentId: EnvironmentId, patch: ServerSettingsPatch) =>
    update({ environmentId, input: { patch } });
}

/** A labelled choice that opens a menu; picks among `options` by id. */
export function MenuField(props: {
  readonly label: string;
  readonly value: string;
  readonly borderTop?: boolean;
  readonly actions: React.ComponentProps<typeof Menu>["actions"];
  readonly onSelect: (id: string) => void;
}) {
  return (
    <Menu
      actions={props.actions}
      onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.label}, ${props.value}`}
        className={cn(
          "min-h-14 flex-row items-center gap-3 px-4 py-3 active:opacity-70",
          props.borderTop && "border-t border-border-subtle",
        )}
      >
        <Text className="text-base text-foreground">{props.label}</Text>
        <Text numberOfLines={1} className="flex-1 text-right text-base text-foreground-muted">
          {props.value}
        </Text>
        <SymbolView name="chevron.down" size={14} tintColorClassName="accent-chevron" />
      </Pressable>
    </Menu>
  );
}

export function TextField(
  props: Pick<
    TextInputProps,
    "value" | "onChangeText" | "onEndEditing" | "placeholder" | "multiline" | "readOnly"
  > & {
    readonly label: string;
    readonly borderTop?: boolean;
  },
) {
  return (
    <View className={cn("gap-1 px-4 py-3", props.borderTop && "border-t border-border-subtle")}>
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        onEndEditing={props.onEndEditing}
        placeholder={props.placeholder}
        readOnly={props.readOnly}
        multiline={props.multiline}
        scrollEnabled={props.multiline}
        textAlignVertical={props.multiline ? "top" : "center"}
        placeholderTextColorClassName="accent-foreground-muted"
        className={cn(
          "font-sans text-base text-foreground",
          props.multiline ? "max-h-56 min-h-20" : "min-h-8",
        )}
      />
    </View>
  );
}

/** Lets a page switch machines when the Settings filter holds several. */
export function CenterEnvironmentPicker(props: ReturnType<typeof useCenterTarget>) {
  if (props.targets.length < 2 || props.target === null) return null;
  return (
    <View className="overflow-hidden rounded-2xl bg-grouped-card">
      <MenuField
        label="Environment"
        value={props.target.label}
        actions={props.targets.map((target) => ({
          id: target.environmentId,
          title: target.label,
          state: target.environmentId === props.target?.environmentId ? "on" : undefined,
        }))}
        onSelect={(id) => props.pick(id as EnvironmentId)}
      />
    </View>
  );
}
