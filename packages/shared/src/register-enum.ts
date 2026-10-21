/** Language register values (docs/61); kept apart so `business.ts` can use it without an import cycle. */
import { z } from 'zod';

export const LanguageRegister = ['FORMAL', 'STANDARD', 'CASUAL'] as const;
export type LanguageRegister = (typeof LanguageRegister)[number];
export const LanguageRegisterSchema = z.enum(LanguageRegister);

export const isRegister = (v: unknown): v is LanguageRegister =>
  typeof v === 'string' && (LanguageRegister as readonly string[]).includes(v);
/** A stored string as a register, or null when it is not one. */
export const asRegister = (v: unknown): LanguageRegister | null => (isRegister(v) ? v : null);
