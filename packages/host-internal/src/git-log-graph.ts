import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const FIELD_SEP = '\x1f';
const DEFAULT_MAX_COMMITS = 200;

export interface GitCommitRecord {
  oid: string;
  parents: string[];
  subject: string;
  author: string;
  authoredAt: string;
  refs: string[];
}

export interface GitCommitGraphRow {
  commit: GitCommitRecord;
  /** Primary lane index for this commit's node (0-based). */
  lane: number;
  /** Number of lanes active at this row. */
  laneCount: number;
  /** Lane indices with a vertical connector passing through this row (excluding this commit's node lane when only passing). */
  passingLanes: number[];
  /** For merge commits: parent lanes that connect into this commit (excluding primary parent lane). */
  mergeLanes: number[];
  /** Lane index this commit branched from (first commit on a new lane). */
  branchFromLane?: number;
}

export interface GitCommitHistorySnapshot {
  isRepository: boolean;
  commits: GitCommitRecord[];
  rows: GitCommitGraphRow[];
}

export interface ReadGitCommitHistoryOptions {
  maxCount?: number;
}

function renderGitError(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return String(error);
  }
  const stdout = typeof (error as { stdout?: unknown }).stdout === 'string'
    ? (error as { stdout: string }).stdout.trim()
    : '';
  const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
    ? (error as { stderr: string }).stderr.trim()
    : '';
  const message = error instanceof Error ? error.message.trim() : String(error);
  return stderr || stdout || message;
}

async function runGit(
  workspaceRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd: workspaceRoot,
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const message = renderGitError(error);
    throw new Error(`git ${args.join(' ')} failed: ${message}`);
  }
}

export function parseGitLogDecorations(decorations: string): string[] {
  if (!decorations.trim()) {
    return [];
  }
  const refs: string[] = [];
  const parts = decorations.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const headMatch = /^HEAD -> (.+)$/u.exec(trimmed);
    if (headMatch?.[1]) {
      refs.push(headMatch[1].trim());
      continue;
    }
    if (trimmed.startsWith('tag: ')) {
      refs.push(trimmed.slice('tag: '.length).trim());
      continue;
    }
    refs.push(trimmed);
  }
  return refs;
}

export function parseGitLogRecordLine(line: string): GitCommitRecord | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  const fields = trimmed.split(FIELD_SEP);
  if (fields.length < 5) {
    return undefined;
  }
  const [oid, parentsRaw, subject, author, authoredAt, decorations = ''] = fields;
  if (!oid?.trim()) {
    return undefined;
  }
  const parents = parentsRaw?.trim()
    ? parentsRaw.trim().split(/\s+/u).filter(Boolean)
    : [];
  return {
    oid: oid.trim(),
    parents,
    subject: subject?.trim() ?? '',
    author: author?.trim() ?? '',
    authoredAt: authoredAt?.trim() ?? '',
    refs: parseGitLogDecorations(decorations),
  };
}

/**
 * walk first-parent spines; after each merge, emit the merged-in
 * branch subgraph (newest-first) before continuing down the mainline.
 */
export function orderCommitsForGraph(commits: readonly GitCommitRecord[]): GitCommitRecord[] {
  if (commits.length === 0) {
    return [];
  }

  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const logIndex = new Map(commits.map((commit, index) => [commit.oid, index]));
  const added = new Set<string>();
  const ordered: GitCommitRecord[] = [];

  const append = (oid: string): void => {
    if (added.has(oid) || !byOid.has(oid)) {
      return;
    }
    added.add(oid);
    ordered.push(byOid.get(oid)!);
  };

  const appendBranchSubgraph = (startOid: string): void => {
    const reachable = new Set<string>();
    const stack = [startOid];
    while (stack.length > 0) {
      const oid = stack.pop()!;
      if (reachable.has(oid) || !byOid.has(oid)) {
        continue;
      }
      reachable.add(oid);
      const commit = byOid.get(oid)!;
      for (const parent of commit.parents) {
        if (!reachable.has(parent)) {
          stack.push(parent);
        }
      }
    }
    const branchCommits = [...reachable]
      .map((oid) => byOid.get(oid)!)
      .sort((left, right) => (logIndex.get(left.oid) ?? 0) - (logIndex.get(right.oid) ?? 0));
    for (const commit of branchCommits) {
      append(commit.oid);
    }
  };

  const walkFirstParent = (startOid: string): void => {
    let oid: string | undefined = startOid;
    while (oid !== undefined && byOid.has(oid)) {
      if (added.has(oid)) {
        break;
      }
      const commit: GitCommitRecord = byOid.get(oid)!;
      append(oid);
      if (commit.parents.length > 1) {
        for (let parentIndex = 1; parentIndex < commit.parents.length; parentIndex += 1) {
          appendBranchSubgraph(commit.parents[parentIndex]!);
        }
      }
      oid = commit.parents[0];
    }
  };

  walkFirstParent(commits[0]!.oid);
  for (const commit of commits) {
    append(commit.oid);
  }

  return ordered;
}

export function layoutGitCommitGraph(commits: readonly GitCommitRecord[]): GitCommitGraphRow[] {
  if (commits.length === 0) {
    return [];
  }

  const commitOids = new Set(commits.map((entry) => entry.oid));
  const parentInWindow = (oid: string): boolean => commitOids.has(oid);
  const oidToIndex = new Map(commits.map((entry, index) => [entry.oid, index]));

  /** lane index -> next expected commit oid on that lane */
  const lanes: Array<string | null> = [];
  const oidToLane = new Map<string, number>();
  let maxLaneCount = 1;

  const ensureLane = (index: number): void => {
    while (lanes.length <= index) {
      lanes.push(null);
    }
  };

  const trimTrailingEmptyLanes = (): void => {
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
  };

  const findFreeLane = (): number => {
    for (let laneIndex = lanes.length - 1; laneIndex >= 1; laneIndex -= 1) {
      if (lanes[laneIndex] === null) {
        return laneIndex;
      }
    }
    const next = lanes.length;
    lanes.push(null);
    return next;
  };

  /** Lane 0 is the main trunk; only the first commit may occupy it when unassigned. */
  const allocateLaneForUnmappedCommit = (): number => {
    if (lanes.length === 0) {
      lanes.push(null);
      return 0;
    }
    return findFreeLane();
  };

  const rows: GitCommitGraphRow[] = [];

  /** Drop lane reservations whose commit already appeared above (date-order interleaving). */
  const pruneStaleLanes = (throughIndex: number): void => {
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const expected = lanes[laneIndex];
      if (expected == null) {
        continue;
      }
      const expectedAt = oidToIndex.get(expected);
      if (expectedAt !== undefined && expectedAt < throughIndex) {
        lanes[laneIndex] = null;
      }
    }
    trimTrailingEmptyLanes();
  };

  for (let rowIndex = 0; rowIndex < commits.length; rowIndex += 1) {
    const commit = commits[rowIndex]!;
    pruneStaleLanes(rowIndex);

    let lane = lanes.findIndex((expected) => expected === commit.oid);
    let branchFromLane: number | undefined;

    if (lane < 0) {
      lane = allocateLaneForUnmappedCommit();
      if (lane > 0 && rows.length > 0) {
        branchFromLane = 0;
      }
    }

    ensureLane(lane);
    oidToLane.set(commit.oid, lane);

    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      if (laneIndex !== lane && lanes[laneIndex] === commit.oid) {
        lanes[laneIndex] = null;
      }
    }

    const passingLanes: number[] = [];
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      if (laneIndex === lane) {
        continue;
      }
      const expected = lanes[laneIndex];
      if (expected != null && parentInWindow(expected)) {
        passingLanes.push(laneIndex);
      }
    }

    const mergeLanes: number[] = [];
    const parents = commit.parents;

    lanes[lane] = null;

    if (parents.length > 0) {
      const primaryParent = parents[0]!;
      if (parentInWindow(primaryParent)) {
        lanes[lane] = primaryParent;
        oidToLane.set(primaryParent, lane);
      }
    }

    for (let parentIndex = 1; parentIndex < parents.length; parentIndex += 1) {
      const parentOid = parents[parentIndex]!;
      if (!parentInWindow(parentOid)) {
        continue;
      }
      let parentLane = lanes.findIndex((expected) => expected === parentOid);
      if (parentLane < 0) {
        parentLane = findFreeLane();
        ensureLane(parentLane);
        lanes[parentLane] = parentOid;
      }
      if (parentLane !== lane && !mergeLanes.includes(parentLane)) {
        mergeLanes.push(parentLane);
      }
      oidToLane.set(parentOid, parentLane);
    }

    trimTrailingEmptyLanes();
    maxLaneCount = Math.max(maxLaneCount, lanes.length);
    rows.push({
      commit,
      lane,
      laneCount: maxLaneCount,
      passingLanes: [...passingLanes].sort((a, b) => a - b),
      mergeLanes: [...mergeLanes].sort((a, b) => a - b),
      ...(branchFromLane !== undefined ? { branchFromLane } : {}),
    });
  }

  const finalLaneCount = Math.max(1, maxLaneCount);
  return rows.map((row) => ({
    ...row,
    laneCount: finalLaneCount,
  }));
}

export async function readGitCommitHistory(
  repoRoot: string,
  options: ReadGitCommitHistoryOptions = {},
): Promise<GitCommitHistorySnapshot> {
  const maxCount = options.maxCount ?? DEFAULT_MAX_COMMITS;
  try {
    const { stdout: repoFlag } = await runGit(repoRoot, ['rev-parse', '--is-inside-work-tree']);
    if (repoFlag.trim() !== 'true') {
      return { isRepository: false, commits: [], rows: [] };
    }

    const { stdout } = await runGit(repoRoot, [
      'log',
      '--all',
      '--topo-order',
      `-n${String(maxCount)}`,
      `--format=format:%H${FIELD_SEP}%P${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%ai${FIELD_SEP}%D`,
    ]);

    const commits = stdout
      .split(/\r?\n/u)
      .map((line) => parseGitLogRecordLine(line))
      .filter((record): record is GitCommitRecord => record !== undefined);

    const orderedCommits = orderCommitsForGraph(commits);
    const rows = layoutGitCommitGraph(orderedCommits);
    return { isRepository: true, commits: orderedCommits, rows };
  } catch {
    return { isRepository: false, commits: [], rows: [] };
  }
}
