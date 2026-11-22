import type { AgentProfile, EnvironmentId, ModelSelection, RuntimeMode } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListRow } from "../../components/ui/ListRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { uuidv4 } from "../../lib/uuid";
import { useServerConfigs } from "../../state/entities";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { CENTER_LABELS, type Center } from "./centers";
import {
  CenterEnvironmentPicker,
  MenuField,
  TextField,
  useCenterTarget,
  useWriteServerSettings,
} from "./centerSettingsTarget";
import { useOpenCenter } from "./useOpenCenter";

const INHERIT = "inherit";

const RUNTIME_MODES: ReadonlyArray<{ readonly value: RuntimeMode; readonly label: string }> = [
  { value: "full-access", label: "Full access" },
  { value: "auto", label: "Auto" },
  { value: "auto-accept-edits", label: "Accept edits" },
  { value: "approval-required", label: "Ask for approval" },
];

const modelKey = (selection: ModelSelection) => `${selection.instanceId}\u0000${selection.model}`;

const GUIDANCE: Record<
  Center,
  { readonly footer: string; readonly placeholder: string; readonly label: string }
> = {
  command: {
    label: "Main agent guidance",
    footer:
      "The main agent hands each request to a saved agent below and tracks it. Anything here is added to its brief, such as which project holds what.",
    placeholder: "web is the Next.js app; api is the Go service. Releases go through Release.",
  },
  operations: {
    label: "Review guidance",
    footer:
      "Reviews the Command Center's jobs and proposes agent and guidance changes, applied only after you approve.",
    placeholder: "Prefer cheaper models unless a job failed twice.",
  },
};

function useScrollInsets() {
  const insets = useSafeAreaInsets();
  return { paddingBottom: Math.max(insets.bottom, 18) + 18 };
}

function GuidanceSection(props: {
  readonly center: Center;
  readonly environmentId: EnvironmentId;
  readonly saved: string;
  readonly onOpen: () => void;
  readonly onDashboard?: () => void;
}) {
  const write = useWriteServerSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const copy = GUIDANCE[props.center];
  return (
    <SettingsSection title={CENTER_LABELS[props.center]} footer={copy.footer}>
      <TextField
        label={copy.label}
        multiline
        value={draft ?? props.saved}
        placeholder={copy.placeholder}
        onChangeText={setDraft}
        onEndEditing={() => {
          if (draft === null || draft === props.saved) return;
          void write(
            props.environmentId,
            props.center === "operations"
              ? { operationCenter: { instructions: draft } }
              : { commandCenter: { instructions: draft } },
          ).then(() => setDraft(null));
        }}
      />
      <View className="flex-row gap-2 border-t border-border-subtle px-4 py-3">
        <Button size="compact" label="Open" icon="bubble.left" onPress={props.onOpen} />
        {props.onDashboard ? (
          <Button
            size="compact"
            label="Dashboard"
            icon="chart.bar.xaxis"
            onPress={props.onDashboard}
          />
        ) : null}
      </View>
    </SettingsSection>
  );
}

/** Saved agents the Command Center delegates to, and both centers' guidance. */
export function SettingsAgentsRouteScreen() {
  const navigation = useNavigation();
  const scroll = useScrollInsets();
  const center = useCenterTarget();
  const openCenter = useOpenCenter();
  const target = center.target;
  const settings = target?.serverConfig.settings;

  return (
    <SettingsScreen title="Command Center">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={scroll}
      >
        {target === null || settings === undefined ? (
          <EmptyState
            variant="plain"
            title="No environment connected"
            detail="Connect to a T3 Code server to set up its agents."
          />
        ) : (
          <>
            <CenterEnvironmentPicker {...center} />
            <SettingsSection
              title="Saved agents"
              footer="Add one per kind of job, such as a bug fixer or a release agent. The main agent picks one by its description."
            >
              {settings.agentProfiles.map((profile) => (
                <ListRow
                  key={profile.id}
                  icon="robot"
                  label={profile.name}
                  description={profile.description || "No description: never picked."}
                  onPress={() =>
                    navigation.navigate("SettingsAgentEdit", {
                      environmentId: target.environmentId,
                      agentId: profile.id,
                    })
                  }
                />
              ))}
              <ListRow
                icon="plus"
                label="Add agent"
                onPress={() =>
                  navigation.navigate("SettingsAgentEdit", {
                    environmentId: target.environmentId,
                    agentId: null,
                  })
                }
              />
            </SettingsSection>
            <GuidanceSection
              key={`command:${target.environmentId}`}
              center="command"
              environmentId={target.environmentId}
              saved={settings.commandCenter.instructions}
              onOpen={() => void openCenter(target.environmentId, { center: "command" })}
            />
            <GuidanceSection
              key={`operations:${target.environmentId}`}
              center="operations"
              environmentId={target.environmentId}
              saved={settings.operationCenter.instructions}
              onOpen={() => void openCenter(target.environmentId, { center: "operations" })}
              onDashboard={() => navigation.navigate("SettingsOperations")}
            />
          </>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

export function SettingsAgentEditRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId; readonly agentId: string | null }>) {
  const navigation = useNavigation();
  const scroll = useScrollInsets();
  const { target } = useCenterTarget(route.params.environmentId);
  const write = useWriteServerSettings();
  const providers = useServerConfigs().get(route.params.environmentId)?.providers ?? [];
  const profiles = target?.serverConfig.settings.agentProfiles ?? [];
  const existing = profiles.find((profile) => profile.id === route.params.agentId) ?? null;
  const [profile, setProfile] = useState<AgentProfile>(
    () =>
      existing ?? {
        id: uuidv4(),
        name: "",
        description: "",
        instructions: "",
        modelSelection: null,
        runtimeMode: null,
        interactionMode: null,
        isolation: "shared",
      },
  );
  const [saving, setSaving] = useState(false);
  if (target === null) {
    return (
      <SettingsScreen title="Agent">
        <EmptyState
          variant="plain"
          title="Environment disconnected"
          detail="Reconnect to edit this agent."
        />
      </SettingsScreen>
    );
  }
  const environmentId = target.environmentId;
  const models = providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      title: provider.displayName ?? provider.instanceId,
      models: provider.models.map((model) => ({
        key: modelKey({ instanceId: provider.instanceId, model: model.slug }),
        selection: { instanceId: provider.instanceId, model: model.slug },
        label: model.name,
      })),
    }));
  const allModels = models.flatMap((group) => group.models);
  const selectedModel =
    profile.modelSelection === null ? INHERIT : modelKey(profile.modelSelection);
  const name = profile.name.trim();
  const duplicate = profiles.some(
    (other) => other.id !== profile.id && other.name.toLowerCase() === name.toLowerCase(),
  );

  const save = async (next: readonly AgentProfile[]) => {
    setSaving(true);
    const result = await write(environmentId, { agentProfiles: next });
    setSaving(false);
    if (result._tag === "Success") navigation.goBack();
  };

  return (
    <SettingsScreen title={existing ? existing.name : "New agent"}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={scroll}
      >
        <SettingsSection
          footer={
            duplicate
              ? "Another agent has this name."
              : "The main agent routes by name and description."
          }
        >
          <TextField
            label="Name"
            value={profile.name}
            placeholder="Bug fixer"
            onChangeText={(value) => setProfile({ ...profile, name: value })}
          />
          <TextField
            borderTop
            label="When to use it"
            multiline
            value={profile.description}
            placeholder="Fixes bugs and flaky tests, then opens a PR"
            onChangeText={(value) => setProfile({ ...profile, description: value })}
          />
          <TextField
            borderTop
            label="Instructions"
            multiline
            value={profile.instructions}
            placeholder="Instructions it gets before every task"
            onChangeText={(value) => setProfile({ ...profile, instructions: value })}
          />
        </SettingsSection>
        <SettingsSection title="How it runs">
          <MenuField
            label="Model"
            value={
              selectedModel === INHERIT
                ? "Main agent's"
                : (allModels.find((model) => model.key === selectedModel)?.label ??
                  profile.modelSelection?.model ??
                  "")
            }
            actions={[
              {
                id: INHERIT,
                title: "Main agent's model",
                state: selectedModel === INHERIT ? "on" : undefined,
              },
              ...models.map((group) => ({
                id: `provider:${group.title}`,
                title: group.title,
                subactions: group.models.map((model) => ({
                  id: model.key,
                  title: model.label,
                  state: model.key === selectedModel ? ("on" as const) : undefined,
                })),
              })),
            ]}
            onSelect={(id) =>
              setProfile({
                ...profile,
                modelSelection:
                  id === INHERIT
                    ? null
                    : (allModels.find((model) => model.key === id)?.selection ??
                      profile.modelSelection),
              })
            }
          />
          <MenuField
            borderTop
            label="Permissions"
            value={
              RUNTIME_MODES.find((mode) => mode.value === profile.runtimeMode)?.label ??
              "Main agent's"
            }
            actions={[
              {
                id: INHERIT,
                title: "Main agent's permissions",
                state: profile.runtimeMode === null ? "on" : undefined,
              },
              ...RUNTIME_MODES.map((mode) => ({
                id: mode.value,
                title: mode.label,
                state: mode.value === profile.runtimeMode ? ("on" as const) : undefined,
              })),
            ]}
            onSelect={(id) =>
              setProfile({
                ...profile,
                runtimeMode: RUNTIME_MODES.find((mode) => mode.value === id)?.value ?? null,
              })
            }
          />
          <MenuField
            borderTop
            label="Checkout"
            value={profile.isolation === "worktree" ? "New worktree" : "Project checkout"}
            actions={[
              {
                id: "shared",
                title: "Project checkout",
                state: profile.isolation === "shared" ? "on" : undefined,
              },
              {
                id: "worktree",
                title: "New worktree",
                state: profile.isolation === "worktree" ? "on" : undefined,
              },
            ]}
            onSelect={(id) => {
              if (id === "shared" || id === "worktree") setProfile({ ...profile, isolation: id });
            }}
          />
        </SettingsSection>
        <View className="gap-3">
          <Button
            fullWidth
            tone="primary"
            label="Save"
            loading={saving}
            disabled={name.length === 0 || duplicate}
            onPress={() => {
              const next = { ...profile, name, description: profile.description.trim() };
              void save(
                existing
                  ? profiles.map((candidate) => (candidate.id === next.id ? next : candidate))
                  : [...profiles, next],
              );
            }}
          />
          {existing ? (
            <Button
              fullWidth
              tone="danger"
              label="Delete agent"
              disabled={saving}
              onPress={() =>
                Dialog.alert(`Delete ${existing.name}?`, "The main agent can no longer pick it.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () =>
                      void save(profiles.filter((candidate) => candidate.id !== existing.id)),
                  },
                ])
              }
            />
          ) : null}
        </View>
      </ScrollView>
    </SettingsScreen>
  );
}
