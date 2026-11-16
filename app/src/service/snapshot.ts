import type { Library } from '../state/model';
/** Remove device-specific file paths. The sync flow replaces selected videos with cloud identifiers. */
export function portableLibrary(data: Library): Library {
  const remoteOnly = (files?: Record<string, string>) => files ? Object.fromEntries(Object.entries(files).filter(([, uri]) => /^https?:\/\//.test(uri))) : undefined;
  return { ...data, projects: data.projects.map(p => ({ ...p, cached: false, remoteFiles: undefined, job: { ...p.job, files: p.job.config.model === 'demo' ? undefined : remoteOnly(p.remoteFiles ?? p.job.files) } })),
    extras: data.extras && { ...data.extras, motions: data.extras.motions.map(m => ({ ...m, video: undefined })), motifs: data.extras.motifs.map(m => ({ ...m, video: undefined })), finished: (data.extras.finished ?? []).map(m => ({ ...m, video: '' })) } };
}
