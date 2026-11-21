interface FileBranch {
  folders: Map<string, FileBranch>;
  files: { name: string; path: string }[];
}

function branch(): FileBranch {
  return { folders: new Map(), files: [] };
}

export function buildWorkspaceTree(paths: readonly string[]): FileBranch {
  const root = branch();
  for (const path of paths) {
    const segments = path.split("/");
    const name = segments.pop();
    if (!name) {continue;}
    let current = root;
    for (const segment of segments) {
      let child = current.folders.get(segment);
      if (!child) {
        child = branch();
        current.folders.set(segment, child);
      }
      current = child;
    }
    current.files.push({ name, path });
  }
  return root;
}

export function WorkspaceTree({ tree, active, expanded, onOpen }: {
  tree: FileBranch;
  active?: string;
  expanded: boolean;
  onOpen: (path: string) => void;
}) {
  return <ul className="workspaceTree">
    {[...tree.folders].map(([name, child]) => <li key={name}>
      <details open={expanded || undefined}>
        <summary title={name}>{name}</summary>
        <WorkspaceTree tree={child} active={active} expanded={expanded} onOpen={onOpen} />
      </details>
    </li>)}
    {tree.files.map(file => <li key={file.path}>
      <button type="button" aria-current={file.path === active ? "true" : undefined}
        title={file.path} onClick={() => onOpen(file.path)}>{file.name}</button>
    </li>)}
  </ul>;
}
