export interface GitCommitAttachment {
  id: string;
  oid: string;
  subject: string;
  author: string;
  authoredAt: string;
  /** Raw commit message from git `%B` (subject line + optional body). */
  fullMessage: string;
}
