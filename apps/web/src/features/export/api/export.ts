import { useMutation } from '@tanstack/react-query';
import type { ExportContentsInput } from '@contenter/shared';
import { api } from '@/lib/api-client';

/** Saves a downloaded blob through a temporary link. */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Asks for the file (POST /contents/export) and saves it. */
export function useExportContents() {
  return useMutation({
    mutationFn: async (input: ExportContentsInput) => {
      const file = await api.download('/contents/export', input);
      saveFile(file.blob, file.fileName);
      return file.fileName;
    },
  });
}
