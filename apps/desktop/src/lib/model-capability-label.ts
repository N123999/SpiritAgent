import type { DesktopModelCapability } from '@/types';
import i18n from '@/lib/i18n';

const modelCapabilityOptions: Array<{
  value: DesktopModelCapability;
  label: string;
  labelKey: string;
}> = [
  { value: 'chat', label: 'Chat', labelKey: 'settings.capabilityChatLabel' },
  { value: 'image', label: 'Image', labelKey: 'settings.capabilityImageLabel' },
  { value: 'video', label: 'Video', labelKey: 'settings.capabilityVideoLabel' },
  {
    value: 'imageGeneration',
    label: 'Image generation',
    labelKey: 'settings.capabilityImageGenerationLabel',
  },
  {
    value: 'videoGeneration',
    label: 'Video generation',
    labelKey: 'settings.capabilityVideoGenerationLabel',
  },
];

export function modelCapabilityLabel(value: DesktopModelCapability): string {
  const option = modelCapabilityOptions.find((item) => item.value === value);
  return option ? i18n.t(option.labelKey, { defaultValue: option.label }) : value;
}
