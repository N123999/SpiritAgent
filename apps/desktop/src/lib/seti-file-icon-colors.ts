export type SetiFileIconColorKey =
  | 'blue'
  | 'grey'
  | 'grey-light'
  | 'green'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'white'
  | 'yellow'
  | 'ignore';

export type SetiFileIconColorMap = Record<SetiFileIconColorKey, string>;

export const SETI_FILE_ICON_COLORS_DARK: SetiFileIconColorMap = {
  blue: '#519aba',
  grey: '#4d5a5e',
  'grey-light': '#6d8086',
  green: '#8dc149',
  orange: '#cc7832',
  pink: '#f55385',
  purple: '#a074c4',
  red: '#cc3e44',
  white: '#d4d7d6',
  yellow: '#e5c07b',
  ignore: '#41535b',
};

export const SETI_FILE_ICON_COLORS_LIGHT: SetiFileIconColorMap = {
  blue: '#498ba7',
  grey: '#455155',
  'grey-light': '#627379',
  green: '#7fae42',
  orange: '#cc6d2e',
  pink: '#dd4b78',
  purple: '#9068b0',
  red: '#b8383d',
  white: '#bfc2c1',
  yellow: '#af8d00',
  ignore: '#3b4b52',
};

export function setiFileIconColorsForTheme(theme: 'dark' | 'light'): SetiFileIconColorMap {
  return theme === 'light' ? SETI_FILE_ICON_COLORS_LIGHT : SETI_FILE_ICON_COLORS_DARK;
}
