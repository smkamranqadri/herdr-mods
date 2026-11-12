// The tree's tools, beside the filter: up a folder, back to the pane's folder, dotfiles,
// and collapse all.
import { spaces } from "herdr";
import { parentOf } from "../files/model.js";
import { foldersTo } from "../files/filter.js";
import { IconButton } from "./ui.js";

const DOTFILES = "better-files.dotfiles";

// Shown unless turned off, and remembered on this computer. Storage can be missing or
// refuse, and then the choice lasts until Herdr restarts.
export function savedDotfiles() {
  try {
    return localStorage.getItem(DOTFILES) !== "false";
  } catch {
    return true;
  }
}

export const toolMethods = {
  // Gone up from the pane's folder in the space on show, so the tree stays put.
  pinned() {
    const space = spaces().find((s) => s.active);
    return Boolean(this.pin && this.pin.space === space?.id);
  },

  // The folder in use before going up is kept, so going back works even while a file tab,
  // which has no folder, is focused.
  goUp(cx) {
    if (!this.root || this.root === "/") return;
    if (!this.pinned()) this.followed = this.place;
    this.pin = { cwd: parentOf(this.root), on: this.on ?? null, space: this.place?.space ?? null };
    this.refresh(cx);
  },

  followPane(cx) {
    this.pin = null;
    this.place = this.followed ?? null;
    this.refresh(cx);
  },

  toggleDotfiles(cx) {
    this.dotfiles = !this.dotfiles;
    try {
      localStorage.setItem(DOTFILES, String(this.dotfiles));
    } catch {
      // Not remembered, but still applied.
    }
    cx.notify();
  },

  // A marker in a folder that closes moves to the folder at the top.
  collapseAll(cx) {
    this.folders.clear();
    if (this.cursor?.includes("/")) this.cursor = foldersTo(this.cursor, false)[0];
    cx.notify();
  },

  toolButtons() {
    const filtering = Boolean(this.filterText());
    return [
      IconButton({
        id: "files-tool-up",
        icon: "folder-up",
        label: "Up a folder",
        small: true,
        disabled: !this.root || this.root === "/",
        onClick: (cx) => this.goUp(cx),
      }),
      ...(this.pinned()
        ? [
            IconButton({
              id: "files-tool-follow",
              icon: "locate-fixed",
              label: "Back to the pane's folder",
              small: true,
              onClick: (cx) => this.followPane(cx),
            }),
          ]
        : []),
      IconButton({
        id: "files-tool-dotfiles",
        icon: this.dotfiles ? "eye" : "eye-off",
        label: this.dotfiles ? "Hide dotfiles" : "Show dotfiles",
        small: true,
        onClick: (cx) => this.toggleDotfiles(cx),
      }),
      IconButton({
        id: "files-tool-collapse",
        icon: "chevrons-down-up",
        label: "Collapse all",
        small: true,
        disabled: filtering || this.folders.size === 0,
        onClick: (cx) => this.collapseAll(cx),
      }),
    ];
  },
};
