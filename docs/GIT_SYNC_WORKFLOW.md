# Git Sync Workflow (Safe, Step by Step)

## Daily procedure

1. Go to the repo folder.

```bash
cd "/Users/alvarocassinelli/Library/CloudStorage/GoogleDrive-cassinelli.alvaro@gmail.com/My Drive/AM_LAB/PROJECTS/ALVARO_PROJECTS/CubeCarillon_3dSequencer/CubicMonome_topologicalSequencer"
```

2. Check local state first.

```bash
git status --branch --short
```

Meaning:

- `M file`: modified tracked file.
- `?? file`: untracked file.
- `main...origin/main`: relation between local and remote-tracking branch.

3. Confirm the remote.

```bash
git remote -v
```

Meaning:

- Shows where `origin` fetches from and pushes to.

4. Fetch remote updates without changing local files.

```bash
git fetch origin
```

Meaning:

- Downloads latest commits and refs.
- Does not merge and does not alter your working tree.

5. Check behind/ahead counts.

```bash
git rev-list --left-right --count origin/main...main
```

Meaning:

- First number: commits only on `origin/main` (you are behind).
- Second number: commits only on local `main` (you are ahead).

6. Pull safely.

```bash
git pull --ff-only origin main
```

Meaning:

- `--ff-only` allows only a fast-forward update.
- If history is not linear, Git stops instead of creating a merge commit.

7. Verify result.

```bash
git status --branch --short
git log --oneline --decorate -n 8
```

## Common situations

### Case A: Behind only (example `10 0`)

```bash
git pull --ff-only origin main
```

### Case B: Local edits and pull fails

Option 1 (stash workflow):

```bash
git stash push -u -m "wip before pull"
git pull --ff-only origin main
git stash pop
```

Option 2 (commit workflow):

```bash
git add -A
git commit -m "WIP local changes"
git pull --ff-only origin main
```

### Case C: Ahead only (example `0 3`)

```bash
git push origin main
```

### Case D: Diverged (example `2 3`)

```bash
git fetch origin
git rebase origin/main
```

If conflicts happen:

```bash
git rebase --continue
```

Abort rebase if needed:

```bash
git rebase --abort
```

## Name refresher

- `origin`: default remote nickname (your GitHub repo).
- `main`: your local branch.
- `origin/main`: local reference tracking remote `main` after fetch.
- `HEAD`: your current checked-out branch/commit pointer.
- Working tree: files on disk in your project folder.
- Index (staging area): what will go into next commit after `git add`.
- Fast-forward: local branch pointer moves forward with no merge commit.

## Minimal 5-command routine

```bash
git status --branch --short
git fetch origin
git rev-list --left-right --count origin/main...main
git pull --ff-only origin main
git status --branch --short
```
