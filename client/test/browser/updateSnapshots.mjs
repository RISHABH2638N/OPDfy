// Deliberate baseline creation/update only. Review PNGs; this never makes a
// failing functional/accessibility case pass or suppresses its exit status.
process.env.QA_UPDATE_SNAPSHOTS='1';process.env.QA_UPDATE_PATIENT_LAYOUT='1';await import('./release.mjs');
