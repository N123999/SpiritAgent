export function buildAiSdkUserImageFilePartFromUrl(url: string): Record<string, unknown> {
  return {
    type: 'file',
    mediaType: 'image/*',
    data: {
      type: 'url',
      url,
    },
  };
}
