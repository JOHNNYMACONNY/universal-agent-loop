export interface BeginBatchInput {
  sessionId: string;
  batchId: string;
  expectedActionSeq: number;
}

export type BeginBatchResult =
  | { kind: 'ACCEPTED'; actionSeq: number }
  | { kind: 'DUPLICATE'; result: Record<string, unknown> };

export interface CompleteBatchInput {
  sessionId: string;
  batchId: string;
  result: Record<string, unknown>;
}

export interface CompleteBatchResult {
  actionSeqAfter: number;
}
