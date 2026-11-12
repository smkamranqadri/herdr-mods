// Copy and paste of files on this computer. The clipboard is the mod's own, shared between
// its copies, so a file copied from one menu pastes from another. Nothing is ever overwritten:
// a name already taken gets " copy" (then " copy 2") before its extension.
import { exec, setShared, shared } from "herdr";
import { parentOf } from "../files/model.js";

export const CLIPBOARD = "better-files.file-clipboard";
const FILE_ERROR = "better-files.error";

// Arguments, never interpolated: $1 is what to copy and $2 the folder to copy into.
const PASTE = `src=$1; dir=$2; name=\${src##*/}; stem=$name; ext=
if [ ! -d "$src" ]; then
  case $name in
    .*) rest=\${name#.}; case $rest in *.*) stem=.\${rest%.*}; ext=.\${rest##*.};; esac;;
    *.*) stem=\${name%.*}; ext=.\${name##*.};;
  esac
fi
dest=$dir/$name; n=1
while [ -e "$dest" ] || [ -L "$dest" ]; do
  if [ $n = 1 ]; then s=" copy"; else s=" copy $n"; fi
  dest=$dir/$stem$s$ext; n=$((n+1))
done
cp -R -P -- "$src" "$dest"`;

export const fileMethods = {
  copyFile(target) {
    setShared(CLIPBOARD, { path: target.path, dir: Boolean(target.dir) });
  },

  async pasteFile(target) {
    const clip = shared(CLIPBOARD);
    if (!clip || target.on) return;
    const into = target.dir ? target.path : parentOf(target.path);
    if (clip.dir && (into === clip.path || into.startsWith(`${clip.path}/`))) {
      setShared(FILE_ERROR, "Could not paste: a folder can't go inside itself.");
      return;
    }
    const r = await exec("sh", ["-c", PASTE, "paste", clip.path, into], {}).catch((e) => ({
      code: 1,
      stderr: String(e),
    }));
    setShared(FILE_ERROR, r.code === 0 ? null : `Could not paste: ${r.stderr?.trim() || "it failed"}`);
  },
};
