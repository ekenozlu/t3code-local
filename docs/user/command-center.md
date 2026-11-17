# Command Center

The Command Center is one main agent that you talk to about work across all your projects. It
does not do the work itself. It hands each request to one of your saved agents, in the right
project, and tells you when the work finishes.

## Start

1. Open **Settings → Command Center** and add a saved agent for each kind of job, such as a bug
   fixer or a release agent. The main agent picks an agent by its description, so describe when to
   use it. An agent can also set its own instructions, model, permissions, and whether it works in
   the project's checkout or a new worktree. Leave a setting on the main agent's to inherit it.
2. Open **Command Center** from the sidebar or the command palette, or press `mod+alt+c` on web
   and desktop. The first time, T3 Code starts the main agent's thread with your default model.
3. Ask for what you want, such as "fix the flaky login test in web and cut a patch release of
   api".

Each job runs as an ordinary thread in its own project's sidebar, with a link back to the
Command Center. Open it to watch or steer the work. The main agent's thread details list every
job and its status. When a job finishes, the main agent wakes up and reports back.

## Good to know

- Jobs run at most with the main agent's permissions. An agent set to a broader mode than the main
  agent's is refused.
- Use **Main agent guidance** in Settings to tell the main agent which project holds what.
- Archive the main agent's thread to start over. The next open starts a new one.
- Each server has its own Command Center. It uses the agents saved on that server.
