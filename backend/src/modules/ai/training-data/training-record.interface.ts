export interface TrainingRecordLabel {
  mitreTechniqueId: string;
  mitreTechniqueName: string;
  mitreTactic: string;
}

export interface TrainingRecord {
  id: string;
  /** 'real' = parsed from an actual downloaded sample; 'synthetic' = hand-authored,
   * modeled on a real dataset's technique/tool taxonomy but not derived from real content. */
  provenance: 'real' | 'synthetic';
  datasetOrigin: string;
  /** The same shape AiService.analyzeLog() classifies — this IS the input a live
   * ingestion path would produce, not a special training-only format. */
  sourceExcerpt: string;
  label: TrainingRecordLabel;
  metadata: Record<string, string>;
  timeline: { timestamp: string; event: string }[];
}
