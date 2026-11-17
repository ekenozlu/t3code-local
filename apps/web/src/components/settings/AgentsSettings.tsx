import { useAtomValue } from "@effect/atom-react";
import type { AgentProfile, ModelSelection, RuntimeMode } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { openCommandCenter } from "../../lib/commandCenter";
import { randomUUID } from "../../lib/utils";
import { primaryServerProvidersAtom } from "../../state/server";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const INHERIT = "inherit";

const RUNTIME_MODES: ReadonlyArray<{ readonly value: RuntimeMode; readonly label: string }> = [
  { value: "full-access", label: "Full access" },
  { value: "auto", label: "Auto" },
  { value: "auto-accept-edits", label: "Accept edits" },
  { value: "approval-required", label: "Ask for approval" },
];

const modelKey = (selection: ModelSelection) => `${selection.instanceId}\u0000${selection.model}`;

const emptyProfile = (): AgentProfile => ({
  id: randomUUID(),
  name: "",
  description: "",
  instructions: "",
  modelSelection: null,
  runtimeMode: null,
  interactionMode: null,
  isolation: "shared",
});

/** Saved agents the Command Center's main agent delegates to, and the main agent's own guidance. */
export function AgentsSettings() {
  const navigate = useNavigate();
  const profiles = usePrimarySettings((settings) => settings.agentProfiles);
  const guidance = usePrimarySettings((settings) => settings.commandCenter.instructions);
  const updateSettings = useUpdatePrimarySettings();
  const [editing, setEditing] = useState<AgentProfile | null>(null);
  const [guidanceDraft, setGuidanceDraft] = useState<string | null>(null);

  const saveProfile = (profile: AgentProfile) => {
    const exists = profiles.some((candidate) => candidate.id === profile.id);
    updateSettings({
      agentProfiles: exists
        ? profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate))
        : [...profiles, profile],
    });
    setEditing(null);
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="command-center"
        title="Command Center"
        headerAction={
          <Button size="xs" variant="outline" onClick={() => void openCommandCenter({ navigate })}>
            Open
          </Button>
        }
      >
        <SettingsRow
          title="Main agent guidance"
          description="The main agent hands each request to a saved agent below and tracks it. Anything here is added to its brief, such as which project holds what."
        >
          <Textarea
            className="mt-2"
            size="sm"
            value={guidanceDraft ?? guidance}
            placeholder="web is the Next.js app; api is the Go service. Releases go through Release."
            onChange={(event) => setGuidanceDraft(event.target.value)}
            onBlur={() => {
              if (guidanceDraft === null || guidanceDraft === guidance) return;
              updateSettings({ commandCenter: { instructions: guidanceDraft } });
              setGuidanceDraft(null);
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        id="saved-agents"
        title="Saved agents"
        headerAction={
          editing === null ? (
            <Button size="xs" variant="outline" onClick={() => setEditing(emptyProfile())}>
              <PlusIcon />
              Add agent
            </Button>
          ) : null
        }
      >
        {profiles.length === 0 && editing === null ? (
          <SettingsRow
            title="No saved agents yet"
            description="Add one per kind of job, such as a bug fixer or a release agent. The main agent picks one by its description."
          />
        ) : null}
        {profiles.map((profile) =>
          editing?.id === profile.id ? (
            <AgentProfileForm
              key={profile.id}
              profile={editing}
              names={profiles.filter((other) => other.id !== profile.id).map((other) => other.name)}
              onChange={setEditing}
              onCancel={() => setEditing(null)}
              onSave={saveProfile}
            />
          ) : (
            <SettingsRow
              key={profile.id}
              title={profile.name}
              description={
                profile.description || "No description: the main agent cannot tell when to pick it."
              }
              control={
                <div className="flex gap-1">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Edit ${profile.name}`}
                    onClick={() => setEditing(profile)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Delete ${profile.name}`}
                    onClick={() =>
                      updateSettings({
                        agentProfiles: profiles.filter((candidate) => candidate.id !== profile.id),
                      })
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              }
            />
          ),
        )}
        {editing !== null && !profiles.some((profile) => profile.id === editing.id) ? (
          <AgentProfileForm
            profile={editing}
            names={profiles.map((profile) => profile.name)}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={saveProfile}
          />
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function AgentProfileForm(props: {
  readonly profile: AgentProfile;
  readonly names: ReadonlyArray<string>;
  readonly onChange: (profile: AgentProfile) => void;
  readonly onCancel: () => void;
  readonly onSave: (profile: AgentProfile) => void;
}) {
  const { profile, onChange } = props;
  const providers = useAtomValue(primaryServerProvidersAtom);
  const models = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: modelKey({ instanceId: provider.instanceId, model: model.slug }),
        selection: { instanceId: provider.instanceId, model: model.slug },
        label: `${provider.displayName ?? provider.instanceId} · ${model.name}`,
      })),
    );
  const name = profile.name.trim();
  const duplicate = props.names.some((other) => other.toLowerCase() === name.toLowerCase());
  const selectedModel =
    profile.modelSelection === null ? INHERIT : modelKey(profile.modelSelection);

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <Input
        aria-label="Agent name"
        placeholder="Name, such as Bug fixer"
        value={profile.name}
        onChange={(event) => onChange({ ...profile, name: event.target.value })}
      />
      <Input
        aria-label="When to use this agent"
        placeholder="When to use it, such as: fixes bugs and flaky tests, then opens a PR"
        value={profile.description}
        onChange={(event) => onChange({ ...profile, description: event.target.value })}
      />
      <Textarea
        aria-label="Agent instructions"
        size="sm"
        placeholder="Instructions it gets before every task"
        value={profile.instructions}
        onChange={(event) => onChange({ ...profile, instructions: event.target.value })}
      />
      <div className="flex flex-wrap gap-2">
        <Select
          value={selectedModel}
          onValueChange={(value) => {
            if (value === null) return;
            onChange({
              ...profile,
              modelSelection:
                value === INHERIT
                  ? null
                  : (models.find((model) => model.key === value)?.selection ?? null),
            });
          }}
        >
          <SelectTrigger aria-label="Model" className="min-w-56" size="xs">
            <SelectValue>
              {selectedModel === INHERIT
                ? "Main agent's model"
                : (models.find((model) => model.key === selectedModel)?.label ??
                  profile.modelSelection?.model)}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={INHERIT}>Main agent's model</SelectItem>
            {models.map((model) => (
              <SelectItem key={model.key} value={model.key}>
                {model.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={profile.runtimeMode ?? INHERIT}
          onValueChange={(value) => {
            if (value === null) return;
            onChange({
              ...profile,
              runtimeMode: value === INHERIT ? null : (value as RuntimeMode),
            });
          }}
        >
          <SelectTrigger aria-label="Permissions" className="min-w-40" size="xs">
            <SelectValue>
              {RUNTIME_MODES.find((mode) => mode.value === profile.runtimeMode)?.label ??
                "Main agent's permissions"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={INHERIT}>Main agent's permissions</SelectItem>
            {RUNTIME_MODES.map((mode) => (
              <SelectItem key={mode.value} value={mode.value}>
                {mode.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={profile.isolation}
          onValueChange={(value) => {
            if (value === "shared" || value === "worktree")
              onChange({ ...profile, isolation: value });
          }}
        >
          <SelectTrigger aria-label="Checkout" className="min-w-40" size="xs">
            <SelectValue>
              {profile.isolation === "worktree" ? "New worktree" : "Project checkout"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="shared">Project checkout</SelectItem>
            <SelectItem value="worktree">New worktree</SelectItem>
          </SelectPopup>
        </Select>
      </div>
      <div className="flex items-center justify-end gap-2">
        {duplicate ? (
          <span className="me-auto text-xs text-destructive">Another agent has this name.</span>
        ) : null}
        <Button size="xs" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={name.length === 0 || duplicate}
          onClick={() =>
            props.onSave({ ...profile, name, description: profile.description.trim() })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}
