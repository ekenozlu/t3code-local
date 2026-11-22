import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { openSettings } from "../settings/settings-navigation";
import { CENTER_LABELS, CENTERS, centerOf, type Center } from "./centers";
import { useOpenCenter } from "./useOpenCenter";

const CHARACTERS: Record<
  Center,
  { readonly icon: AppSymbolName; readonly className: string; readonly idle: string }
> = {
  command: { icon: "robot", className: "bg-primary", idle: "Ask me anything" },
  operations: {
    icon: "checkmark.circle",
    className: "bg-emerald-600",
    idle: "Review jobs and tune agents",
  },
};

function IconAction(props: {
  readonly label: string;
  readonly icon: AppSymbolName;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={6}
      onPress={props.onPress}
      className="size-9 items-center justify-center rounded-full bg-subtle active:opacity-70"
    >
      <SymbolView name={props.icon} size={16} tintColorClassName="accent-foreground" />
    </Pressable>
  );
}

function CenterThreadRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly onSettle: () => void;
  readonly onUnsettle: () => void;
  readonly onDelete: () => void;
}) {
  const { thread } = props;
  const settled = thread.settledAt !== null;
  return (
    <Menu
      shouldOpenOnLongPress
      actions={[
        settled ? { id: "unsettle", title: "Un-settle" } : { id: "settle", title: "Settle" },
        { id: "delete", title: "Delete", attributes: { destructive: true } },
      ]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "settle") props.onSettle();
        else if (nativeEvent.event === "unsettle") props.onUnsettle();
        else if (nativeEvent.event === "delete") props.onDelete();
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Long-press to settle or delete"
        onPress={props.onOpen}
        className={cn(
          "min-h-10 flex-row items-center gap-3 rounded-xl pl-14 pr-3 active:opacity-70",
          props.selected && "bg-thread-selected",
        )}
      >
        <View className="w-3 items-center">
          {isThreadWorking(thread) ? (
            <AppActivityIndicator size="small" colorClassName="accent-foreground-muted" />
          ) : (
            <View
              className={cn(
                "size-1.5 rounded-full",
                settled ? "bg-foreground-muted/40" : "bg-foreground-muted",
              )}
            />
          )}
        </View>
        <Text
          numberOfLines={1}
          className={cn("flex-1 text-sm", settled ? "text-foreground-muted" : "text-foreground")}
        >
          {thread.title || "Untitled thread"}
        </Text>
      </Pressable>
    </Menu>
  );
}

/**
 * The Command and Operation Centers at the top of Home: tap a character to open its newest
 * thread, + to start another; long-press a thread to settle or delete it.
 */
export function CenterHomeSection(props: {
  readonly environmentId: EnvironmentId;
  /** Shown when several machines are connected, so the user knows whose center this is. */
  readonly environmentLabel: string | null;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly centers: ReadonlyMap<string, Center>;
  readonly selectedThreadKey: string | null;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onSettleThread: (thread: EnvironmentThreadShell) => unknown;
  readonly onUnsettleThread: (thread: EnvironmentThreadShell) => unknown;
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => unknown;
}) {
  const navigation = useNavigation();
  const openCenter = useOpenCenter();
  const [showSettled, setShowSettled] = useState<Center | null>(null);
  const byCenter = (center: Center) =>
    [...props.threads]
      .filter(
        (thread) =>
          thread.environmentId === props.environmentId &&
          thread.archivedAt === null &&
          centerOf(props.centers, thread) === center,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <View className="pb-2 pt-1">
      <View className="gap-1 rounded-2xl bg-grouped-card py-2">
        {props.environmentLabel !== null ? (
          <Text className="px-4 pb-1 text-xs text-foreground-muted">
            On {props.environmentLabel}
          </Text>
        ) : null}
        {CENTERS.map((center) => {
          const threads = byCenter(center);
          const active = threads.filter((thread) => thread.settledAt === null);
          const settled = threads.filter((thread) => thread.settledAt !== null);
          const character = CHARACTERS[center];
          const renderRow = (thread: EnvironmentThreadShell) => (
            <CenterThreadRow
              key={thread.id}
              thread={thread}
              selected={
                props.selectedThreadKey === scopedThreadKey(thread.environmentId, thread.id)
              }
              onOpen={() => props.onSelectThread(thread)}
              onSettle={() => void props.onSettleThread(thread)}
              onUnsettle={() => void props.onUnsettleThread(thread)}
              onDelete={() => void props.onDeleteThread(thread)}
            />
          );
          return (
            <View key={center} className="gap-0.5">
              <View className="flex-row items-center gap-2 px-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${CENTER_LABELS[center]}`}
                  onPress={() => void openCenter(props.environmentId, { center })}
                  className="min-h-14 flex-1 flex-row items-center gap-3 active:opacity-70"
                >
                  <View
                    className={cn(
                      "size-9 items-center justify-center rounded-full",
                      character.className,
                    )}
                  >
                    <SymbolView name={character.icon} size={18} tintColor="white" />
                  </View>
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-base font-semibold text-foreground">
                      {CENTER_LABELS[center]}
                    </Text>
                    <Text numberOfLines={1} className="text-sm text-foreground-muted">
                      {active.length > 0 ? `${active.length} open` : character.idle}
                    </Text>
                  </View>
                </Pressable>
                {center === "operations" ? (
                  <IconAction
                    label="Operations dashboard"
                    icon="chart.bar.xaxis"
                    onPress={() => openSettings(navigation, "SettingsOperations")}
                  />
                ) : null}
                <IconAction
                  label={`New ${CENTER_LABELS[center]} thread`}
                  icon="plus"
                  onPress={() => void openCenter(props.environmentId, { center, startNew: true })}
                />
              </View>
              {active.map(renderRow)}
              {settled.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showSettled === center }}
                  onPress={() => setShowSettled((shown) => (shown === center ? null : center))}
                  className="min-h-9 flex-row items-center gap-2 pl-14 pr-3 active:opacity-70"
                >
                  <SymbolView
                    name={showSettled === center ? "chevron.down" : "chevron.right"}
                    size={11}
                    tintColorClassName="accent-foreground-muted"
                  />
                  <Text className="text-sm text-foreground-muted">Settled ({settled.length})</Text>
                </Pressable>
              ) : null}
              {showSettled === center ? settled.map(renderRow) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
