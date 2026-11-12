// The right-click menu: its own small copy of this mod, in a popup at the pointer.
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { closeOverlay, props, shared, theme } from "herdr";
import { foundEditors } from "../actions/outside.js";
import { agentName } from "../actions/agents.js";
import { CLIPBOARD } from "../actions/files.js";
import { TEXT } from "./ui.js";

export const contextMenuMethods = {
  menuItems(target) {
    const local = !target.on;
    const editors = local ? foundEditors() : [];
    const file = { path: target.path, root: target.root, on: target.on };
    const groups = [];
    if (!target.dir)
      groups.push([
        { id: "open", label: "Open", run: (cx) => this.openFile(file, cx) },
        { id: "open-tab", label: "Open in new tab", run: (cx) => this.openInNewTab(file, cx) },
      ]);
    groups.push([
      ...editors.map((e) => ({
        id: `editor-${e.bundle}`,
        label: `Open in ${e.name}`,
        run: () => this.openInEditor(e, target.path),
      })),
      ...(local && !target.dir
        ? [{ id: "default", label: "Open in default app", run: () => this.openWithDefault(target.path) }]
        : []),
      ...(local
        ? [{ id: "reveal", label: "Show in Finder", run: () => this.revealInFinder(target.path) }]
        : []),
    ]);
    if (!target.dir && target.changed && shared("better-files.has-changes"))
      groups.push([{ id: "diff", label: "Show diff", run: (cx) => this.showDiff(target, cx) }]);
    const clip = shared(CLIPBOARD);
    const files = [];
    if (local) files.push({ id: "copy-file", label: "Copy", run: () => this.copyFile(target) });
    if (local && clip)
      files.push({ id: "paste-file", label: "Paste", run: () => this.pasteFile(target) });
    if (files.length) groups.push(files);
    groups.push([
      {
        id: "copy-relative",
        label: "Copy relative path",
        run: (cx) => cx.write_to_clipboard(target.relative),
      },
      { id: "copy-path", label: "Copy full path", run: (cx) => cx.write_to_clipboard(target.path) },
    ]);
    if (this.agentChoices(target).length)
      groups.push([
        {
          id: "send",
          label: "Send to agent",
          keep: true,
          run: (cx) => {
            this.menuPage = "agents";
            cx.notify();
          },
        },
      ]);
    return groups.filter((group) => group.length);
  },

  // Every agent the file can go to: running ones, a sub-agent under each, and new ones.
  agentChoices(target) {
    const running = this.spaceAgents(this.menuSpace);
    return [
      ...running.flatMap((a) => [
        {
          id: `agent-${a.address}`,
          label: `Send to ${agentName(a)}`,
          run: () => this.askForPrompt(target, a.address),
        },
        ...(this.spawnRun(a)
          ? [
              {
                id: `agent-spawn-${a.address}`,
                label: `Send to ${agentName(a)} (spawn)`,
                run: () => this.askForPrompt(target, `spawn:${a.address}`),
              },
            ]
          : []),
      ]),
      ...this.newAgentChoices().map((a) => ({
        id: `agent-${a.address}`,
        label: `Send to ${agentName(a)}`,
        run: () => this.askForPrompt(target, a.address),
      })),
    ];
  },

  menuView() {
    const t = theme();
    const target = props()?.target ?? this.menuTarget;
    const view = v_flex()
      .id("files-menu")
      .w_full()
      .max_h(520)
      .overflow_y_scrollbar()
      .p(4)
      .rounded(7)
      .border_1()
      .border_color(t.border)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(TEXT.tab);
    const groups =
      this.menuPage === "agents"
        ? [
            [
              {
                id: "back",
                label: "‹ Back",
                keep: true,
                run: (cx) => {
                  this.menuPage = null;
                  cx.notify();
                },
              },
            ],
            this.agentChoices(target),
          ]
        : this.menuItems(target);
    groups.forEach((group, i) => {
      if (i) view.child(div().h(1).my(3).flex_none().bg(t.border));
      for (const item of group)
        view.child(
          div()
            .id(`files-menu-${item.id}`)
            .flex_none()
            .h(24)
            .px(8)
            .flex()
            .items_center()
            .rounded(5)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              item.run(cx);
              if (item.keep) return;
              closeOverlay(props()?.overlay);
            })
            .child(div().truncate().child(item.label)),
        );
    });
    return view;
  },
};
