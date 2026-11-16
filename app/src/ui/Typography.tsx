import { createContext, useContext } from 'react';
import { Text as NativeText, TextInput as NativeTextInput, type TextInputProps, type TextProps } from 'react-native';

export const fonts = {
  light: 'SpaceGrotesk_300Light',
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
} as const;

const NestedText = createContext(false);
export function Text({ style, ...props }: TextProps) {
  const nested = useContext(NestedText);
  return <NestedText.Provider value><NativeText {...props} style={[!nested && { fontFamily: fonts.medium }, style]} /></NestedText.Provider>;
}

export function TextInput({ style, ...props }: TextInputProps) {
  return <NativeTextInput {...props} style={[{ fontFamily: fonts.medium }, style]} />;
}
