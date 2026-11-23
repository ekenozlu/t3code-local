# Command Center

The Command Center is one main agent that you talk to about work across all your projects. It
does not do the work itself. It hands each request to one of your saved agents, in the right
project, and tells you when the work finishes.

## Start

1. Open **Settings → Command Center** and add a saved agent for each kind of job, such as a bug
   fixer or a release agent. The main agent picks an agent by its description, so describe when to
   use it. An agent can also set its own instructions, model, permissions, and whether it works in
   the project's checkout or a new worktree. Leave a setting on the main agent's to inherit it.
2. Click the Command Center at the bottom of the sidebar, use the command palette, or press
   `mod+alt+c` on web and desktop. The first time, T3 Code starts the main agent's thread with
   your default model. Use **+** beside it to start another main agent thread, for example one per
   initiative; they are listed under it, newest first.
3. Ask for what you want, such as "fix the flaky login test in web and cut a patch release of
   api".

Each job runs as an ordinary thread in its own project's sidebar, with a link back to the
Command Center. Open it to watch or steer the work. The main agent's thread details list every
job and its status. When a job finishes, the main agent wakes up and reports back.

## Good to know

- Jobs run at most with the main agent's permissions. An agent set to a broader mode than the main
  agent's is refused.
- Use **Main agent guidance** in Settings to tell the main agent which project holds what.
- Hover a main agent thread to settle or delete it. Settled threads fold into **Settled** at the
  end of the list, where you can un-settle them; clicking the Command Center skips them. Archive one
  to take it off the list; unarchive it to bring it back.
- Each server has its own Command Center. It uses the agents saved on that server.
- In the mobile app, Command Center and Operation Center threads list in their own sections at the
  top of the thread list. Tap a section's title to fold it. A search lists them with the other
  matches.

## Operation Center

The Operation Center sits below the Command Center in the sidebar. It reviews the jobs the Command Center handed out and suggests how to improve them.

- **Dashboard.** Open it with the chart button beside the Operation Center or at Settings → Agents. It shows jobs, failures, median time, tokens, and steers (messages you sent a job's thread after its task) for the last 7, 30, or 90 days, broken down by agent. Jobs that failed, that you steered, or that took more than twice their agent's median are listed under **Needs attention**.
- **Reviews.** Ask the Operation Center to review recent work. It reads the same numbers, opens the slow or failed jobs, and may ask the agent that ran one what went wrong. It then reports numbered recommendations: changing a saved agent's instructions, description, or model, or the Command Center's guidance.
- **Approval.** Nothing changes until you approve. Reply with the numbers you want and it applies those changes.
- **On a schedule.** Ask it to "review every Monday at 9am" and it schedules the review in its own thread.

Add anything the Operation Center should weigh, such as cost limits, under Settings → Agents → Operation Center.
