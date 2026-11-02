import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(200)
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const numOrNull = z.number().nullable().optional();

export const tradeSchema = z.object({
  date: dateStr,
  symbol: z.string().trim().min(1).max(30),
  dir: z.enum(["buy", "sell"]),
  lots: numOrNull,
  entry: numOrNull,
  exit: numOrNull,
  pnl: numOrNull,
  smartExit: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
  ext: z.string().max(120).optional()
});

export const tradeBatchSchema = z.object({
  trades: z.array(tradeSchema).min(1).max(5000)
});

export const tradeUpdateSchema = tradeSchema.partial();
