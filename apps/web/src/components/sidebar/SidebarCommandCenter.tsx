import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { AsyncResult } from "effect/reactivity";
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { memo, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { openCommandCenter } from "../../lib/commandCenter";
import { useQuietThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ThreadRowLeadingStatus } from "../ThreadStatusIndicators";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function RowAction(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            onClick={(event) => {
              event.stopPropagation();
              props.onClick();
            }}
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** The Command Center's character and its main agent threads, newest first; settled ones fold away. */
export const SidebarCommandCenter = memo(function SidebarCommandCenter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const environmentId = usePrimaryEnvironmentId();
  const threadIds = usePrimarySettings((settings) => settings.commandCenter.threadIds);
  const shells = useQuietThreadShells();
  const route = useThreadRouteRef();
  const { settleThread, unsettleThread, confirmAndDeleteThread } = useThreadActions();
  const act = (title: string, run: () => Promise<AsyncResult.AsyncResult<unknown, unknown>>) => {
    void run().then((result) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  };
  const order = new Map(threadIds.map((threadId, index) => [threadId, index] as const));
  const threads = shells
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.archivedAt === null &&
        order.has(thread.id),
    )
    .toSorted((left, right) => order.get(right.id)! - order.get(left.id)!);
  const active = threads.filter((thread) => thread.settledAt === null);
  const settled = threads.filter((thread) => thread.settledAt !== null);
  const [showSettled, setShowSettled] = useState(false);

  const renderRow = (thread: (typeof threads)[number]) => {
    const ref: ScopedThreadRef = scopeThreadRef(thread.environmentId, thread.id);
    return (
      <SidebarMenuItem key={thread.id} className="group/cc-row relative">
        <SidebarMenuButton
          size="sm"
          isActive={route?.environmentId === thread.environmentId && route.threadId === thread.id}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(ref),
            });
          }}
        >
          <ThreadRowLeadingStatus thread={thread} />
          <span>{thread.title}</span>
        </SidebarMenuButton>
        <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center opacity-0 group-hover/cc-row:pointer-events-auto group-hover/cc-row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100">
          {thread.settledAt !== null ? (
            <RowAction
              label="Un-settle"
              onClick={() => act("Failed to un-settle thread", () => unsettleThread(ref))}
            >
              <Undo2Icon className="size-3.5" />
            </RowAction>
          ) : (
            <RowAction
              label="Settle"
              onClick={() => act("Failed to settle thread", () => settleThread(ref))}
            >
              <CheckIcon className="size-3.5" />
            </RowAction>
          )}
          <RowAction
            label="Delete"
            onClick={() =>
              act("Failed to delete thread", () => confirmAndDeleteThread(ref, thread.title))
            }
          >
            <Trash2Icon className="size-3.5" />
          </RowAction>
        </span>
      </SidebarMenuItem>
    );
  };

  const open = (startNew: boolean) => {
    if (isMobile) setOpenMobile(false);
    void openCommandCenter({ navigate }, { startNew });
  };

  return (
    <div className="flex min-h-0 flex-col gap-1 border-t border-sidebar-border pt-2">
      <SidebarMenu className="flex-row items-center">
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton size="lg" onClick={() => open(false)}>
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <BotIcon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">Command Center</span>
              <span className="truncate text-xs text-muted-foreground">
                {active.length === 0 ? "Ask me anything" : `${active.length} open`}
              </span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem className="shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarMenuButton
                  aria-label="New Command Center thread"
                  size="icon"
                  onClick={() => open(true)}
                >
                  <PlusIcon />
                </SidebarMenuButton>
              }
            />
            <TooltipPopup side="top">New Command Center thread</TooltipPopup>
          </Tooltip>
        </SidebarMenuItem>
      </SidebarMenu>
      {threads.length === 0 ? null : (
        <SidebarMenu className="max-h-48 overflow-y-auto">
          {active.map(renderRow)}
          {settled.length === 0 ? null : (
            <SidebarMenuItem>
              <SidebarMenuButton
                size="sm"
                aria-expanded={showSettled}
                onClick={() => setShowSettled((shown) => !shown)}
              >
                <ChevronRightIcon className={showSettled ? "rotate-90" : undefined} />
                <span>Settled ({settled.length})</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {showSettled ? settled.map(renderRow) : null}
        </SidebarMenu>
      )}
    </div>
  );
});
