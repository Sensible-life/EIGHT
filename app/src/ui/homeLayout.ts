// The design is 402 points wide with 32-point side insets.
export const homeHorizontalInset = (windowWidth: number) => Math.min(windowWidth, 560) * 32 / 402;
